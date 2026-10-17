import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { recordSessionAccrual, scheduleMap } from '../src/staff-attendance.js';
import { dispatchAdminAccountingFact } from '../src/accounting-admin-bridge.js';
import { evaluateDueApresiasi } from '../src/dana-apresiasi.js';

// Revisi jam presensi oleh CS (Bos Cyo, 2026-10-17): CS mengajukan, Owner/Admin ACC / edit lalu ACC /
// tolak. ACC = jam diganti, gaji lama dibatalkan + jurnal dibalik, gaji revisi dicatat + dijurnal,
// potongan dana apresiasi dinilai ulang.

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) {
    this.db.exec('BEGIN');
    try { const out = statements.map(s => s.run()); this.db.exec('COMMIT'); return out; } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

const DATE = '2026-10-16';
const at = hhmm => new Date(`${DATE}T${hhmm}:00+07:00`).toISOString();

async function setup({ schedule = false } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_rv', 'owner_rv', 'x', 'Bos')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_rv', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-rv'));
  db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, created_at) VALUES ('rika', 'rika', 'x', 'Rika', 'store_pendem', '2026-10-16 00:00:00')`).run();
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'rika', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('kasir-rika'));
  db.prepare(`INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type) VALUES ('CASHIER', 'rika', 6000000000, 'CS', 'JAM')`).run();
  if (schedule) {
    for (let day = 0; day < 7; day += 1) db.prepare(`INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end) VALUES ('CASHIER', 'rika', ?, 0, '09:00', '18:00')`).run(day);
    const entityId = db.prepare(`SELECT entity_id FROM stores WHERE id = 'store_pendem'`).get().entity_id;
    db.prepare(`INSERT INTO apresiasi_settings (entity_id, store_id, enabled, mulai_tanggal) VALUES (?, '', 1, '2026-10-16')`).run(entityId);
  }
  return { db, env: { DB: new D1Database(db) } };
}

// Sesi selesai yang sudah dicatat gajinya dan dijurnal (seperti presensi pulang biasa).
async function closedSession(db, env, from, to) {
  db.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at) VALUES ('att_rika', 'rika', 'store_pendem', 'in', x'00', 'image/jpeg', ?, 'CLOSED', ?)`).run(at(from), at(to));
  const schedule = scheduleMap(db.prepare(`SELECT * FROM account_shift_schedule WHERE account_id = 'rika'`).all());
  await recordSessionAccrual(env.DB, { accountId: 'rika', storeId: 'store_pendem', checkInAt: at(from), checkOutAt: at(to), attendanceId: 'att_rika', scheduleByDay: schedule });
  const entry = db.prepare(`SELECT id FROM payroll_ledger_entries WHERE source_id = 'att_rika'`).get();
  await dispatchAdminAccountingFact(env.DB, 'GAJI_PRESENSI', entry.id);
}

const staff = (env, body) => worker.fetch(new Request('https://example.test/api/staff/attendance-revisions', {
  method: 'POST', headers: { Authorization: 'Bearer kasir-rika', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}), env);
const decide = (env, id, body) => worker.fetch(new Request(`https://example.test/api/admin/attendance-revisions/${id}?store=PENDEM`, {
  method: 'PATCH', headers: { Authorization: 'Bearer owner-rv', 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}), env);

// Utang Gaji atas nama akun kasir Rika menurut buku, rupiah.
const bukuRika = db => Number(db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN side = 'CREDIT' THEN amount_scaled ELSE -amount_scaled END), 0) AS n
  FROM accounting_party_entries WHERE account_code = '2102' AND employee_id = 'cashier:rika'
`).get().n) / 1_000_000;

test('revisi jam masuk sesi yang sudah selesai: ACC = gaji lama dibalik, gaji revisi dijurnal', async () => {
  const { db, env } = await setup();
  await closedSession(db, env, '09:30', '18:00');
  assert.equal(bukuRika(db), 51000); // 8,5 jam x 6.000
  const res = await staff(env, { attendanceId: 'att_rika', checkIn: '08:59', checkOut: '18:00', reason: 'lupa absen, datang 08:59' });
  assert.equal(res.status, 201, await res.clone().text());
  const { permit } = await res.json();
  assert.equal(permit.status, 'PENDING');

  const acc = await decide(env, permit.id, { decision: 'ACC', note: 'ok' });
  assert.equal(acc.status, 200, await acc.clone().text());
  const session = db.prepare(`SELECT created_at, original_created_at, revision_permit_id FROM staff_attendance WHERE id = 'att_rika'`).get();
  assert.equal(session.created_at, at('08:59'));
  assert.equal(session.original_created_at, at('09:30'));
  const ledger = db.prepare(`SELECT source_id, voided_at, hutang_gaji_delta_scaled / 1000000 AS rp FROM payroll_ledger_entries ORDER BY created_at`).all();
  assert.equal(ledger.length, 2);
  assert.ok(ledger.find(row => row.source_id === 'att_rika').voided_at);
  assert.equal(ledger.find(row => row.source_id.startsWith('att_rika#rev-')).rp, 54100); // 9 jam 1 menit
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounting_bridge_deliveries WHERE fact_type = 'GAJI_PRESENSI_VOID' AND status = 'POSTED'`).get().n, 1);
  assert.equal(bukuRika(db), 54100);
  const reversal = db.prepare(`SELECT business_date FROM accounting_journal_headers WHERE source_system = 'LEKER_ADMIN_VOID'`).get();
  assert.equal(reversal.business_date, DATE);
});

test('owner mengedit jam lalu ACC; tolak wajib alasan; satu pengajuan menunggu per sesi', async () => {
  const { db, env } = await setup();
  await closedSession(db, env, '09:30', '18:00');
  const { permit } = await (await staff(env, { attendanceId: 'att_rika', checkIn: '08:00', checkOut: '18:00', reason: 'datang lebih awal' })).json();
  assert.equal((await staff(env, { attendanceId: 'att_rika', checkIn: '08:10', checkOut: '18:00', reason: 'datang lebih awal' })).status, 409);
  assert.equal((await decide(env, permit.id, { decision: 'REJECT' })).status, 400);
  const acc = await (await decide(env, permit.id, { decision: 'ACC', checkIn: '09:15', checkOut: '18:00', note: 'sesuai CCTV 09:15' })).json();
  assert.equal(acc.permit.editedByApprover, true);
  assert.equal(acc.permit.approvedCheckInAt, at('09:15'));
  assert.equal(bukuRika(db), 52500); // 8 jam 45 menit
});

test('lupa presensi: ACC membuat sesi baru dan gajinya; ditolak tidak mengubah apa pun', async () => {
  const { db, env } = await setup();
  const res = await staff(env, { businessDate: DATE, checkIn: '10:00', checkOut: '14:00', reason: 'HP mati, lupa presensi' });
  assert.equal(res.status, 201, await res.clone().text());
  const { permit } = await res.json();
  await decide(env, permit.id, { decision: 'ACC' });
  const session = db.prepare(`SELECT created_at, check_out_at, status, revision_permit_id FROM staff_attendance WHERE user_id = 'rika'`).get();
  assert.equal(session.status, 'CLOSED');
  assert.equal(session.created_at, at('10:00'));
  assert.equal(bukuRika(db), 24000);

  const other = await setup();
  const ditolak = await (await staff(other.env, { businessDate: DATE, checkIn: '10:00', checkOut: '14:00', reason: 'HP mati, lupa presensi' })).json();
  const tolak = await (await decide(other.env, ditolak.permit.id, { decision: 'REJECT', note: 'tidak ada bukti' })).json();
  assert.equal(tolak.permit.status, 'REJECTED');
  assert.equal(other.db.prepare(`SELECT COUNT(*) AS n FROM staff_attendance`).get().n, 0);
});

test('revisi telat yang di-ACC menghapus potongan apresiasi & denda shift itu (dinilai ulang + dibalik)', async () => {
  const { db, env } = await setup({ schedule: true });
  await closedSession(db, env, '09:30', '18:00');
  await evaluateDueApresiasi(env.DB, 'store_pendem', { now: new Date(`${DATE}T20:00:00+07:00`) });
  const aktif = () => db.prepare(`SELECT kind, amount_scaled / 1000000 AS rp FROM apresiasi_entries WHERE business_date = ? AND voided_at IS NULL ORDER BY kind`).all(DATE);
  assert.deepEqual(aktif().map(row => [row.kind, row.rp]), [['DENDA', -10000], ['POTONG_KOSONG', -1200]]);
  const { permit } = await (await staff(env, { attendanceId: 'att_rika', checkIn: '09:00', checkOut: '18:00', reason: 'web error waktu presensi' })).json();
  await decide(env, permit.id, { decision: 'ACC' });
  assert.deepEqual(aktif(), []);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM accounting_bridge_deliveries WHERE fact_type = 'APRESIASI_VOID' AND status = 'POSTED'`).get().n, 2);
});
