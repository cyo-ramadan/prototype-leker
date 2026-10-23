import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';
import { nilaiShift, dendaTier, APRESIASI_DEFAULTS, evaluateDueApresiasi, setPengganti, saveSettings, createPenyesuaian, durasiLabel, reevaluate, setBerhenti } from '../src/dana-apresiasi.js';
import { buildEmployeeLedger } from '../src/employee-ledger-view.js';

// Dana Apresiasi Backup & Denda Ketidakhadiran CS (Bos Cyo, 2026-10-15, ADR-058).

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

const STORE = 'store_pendem';
const DATE = '2026-10-20';
const at = hhmm => new Date(`${DATE}T${hhmm}:00+07:00`).toISOString();
const NOW = new Date(`${DATE}T20:00:00+07:00`);

async function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  const entityId = sqlite.prepare('SELECT entity_id FROM stores WHERE id = ?').get(STORE).entity_id;
  const cashier = (id, name, backup) => {
    sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, is_entity_backup, created_at) VALUES (?, ?, 'x', ?, ?, 1, ?, '2026-10-20 00:00:00')`)
      .run(id, id, name, STORE, backup ? 1 : 0);
    sqlite.prepare(`INSERT INTO account_job_details (account_type, account_id, hourly_wage_scaled, job_type, payment_type) VALUES ('CASHIER', ?, ?, 'CS', 'JAM')`)
      .run(id, (backup ? 5600 : 5600) * 1_000_000);
  };
  cashier('rika', 'Rika', false);
  cashier('avinda', 'Avinda', true);
  for (let day = 0; day < 7; day += 1) {
    sqlite.prepare(`INSERT INTO account_shift_schedule (account_type, account_id, day_of_week, is_day_off, shift_start, shift_end) VALUES ('CASHIER', 'rika', ?, 0, '09:00', '18:00')`).run(day);
  }
  sqlite.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_apr', ?, 'ea_apr', 'x', 'EA', 1)`).run(entityId);
  sqlite.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_apr', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-apr'));
  // "Mulai dihitung" dipilih Entity Admin (bawaan aplikasi 1 Nov) -- di tes mulai 16 Okt.
  sqlite.prepare(`INSERT INTO apresiasi_settings (entity_id, store_id, enabled, mulai_tanggal) VALUES (?, '', 1, '2026-10-16')`).run(entityId);
  const env = { DB: new D1Database(sqlite) };
  return { sqlite, db: env.DB, env, entityId };
}

function session(sqlite, id, userId, from, to) {
  sqlite.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status, check_out_at) VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', ?, 'CLOSED', ?)`)
    .run(id, userId, STORE, at(from), at(to));
}

const entries = (sqlite, { voided = false } = {}) => sqlite.prepare(`
  SELECT account_id, kind, minutes, amount_scaled / 1000000 AS rupiah, description, voided_at FROM apresiasi_entries
  WHERE ${voided ? 'voided_at IS NOT NULL' : 'voided_at IS NULL'} ORDER BY kind
`).all();

const saldo2105 = sqlite => Number(sqlite.prepare(`
  SELECT COALESCE(SUM(CASE WHEN l.side = 'CREDIT' THEN l.amount_scaled ELSE -l.amount_scaled END), 0) AS n
  FROM accounting_journal_lines l JOIN chart_of_accounts a ON a.id = l.account_id WHERE a.code = '2105'
`).get().n);

test('nilaiShift: jam backup, jam kosong, dan jenis denda', () => {
  const h = hours => hours * 3_600_000;
  const base = { accountId: 'A', shiftStart: h(9), shiftEnd: h(18) };
  assert.equal(nilaiShift({ ...base, own: [[h(9), h(18)]] }).kosongMinutes, 0);
  const kosong = nilaiShift(base);
  assert.equal(kosong.kosongMinutes, 540);
  assert.equal(dendaTier(kosong.kosongMinutes, APRESIASI_DEFAULTS), 'PENUH');
  const telat = nilaiShift({ ...base, own: [[h(9.5), h(18)]] });
  assert.equal(telat.kosongMinutes, 30);
  assert.equal(dendaTier(telat.kosongMinutes, APRESIASI_DEFAULTS), '', 'telat 30 menit tanpa denda, hanya potongan per jam');
  const backupPenuh = nilaiShift({ ...base, others: [{ accountId: 'B', start: h(8), end: h(19) }] });
  assert.deepEqual(backupPenuh.backups, [{ accountId: 'B', minutes: 540 }]);
  assert.equal(backupPenuh.kosongMinutes, 0);
  // Denda bertingkat (2026-10-17): < 3 jam tanpa denda, 3-4 jam ringan, > 4 jam berat; OFF = tanpa denda.
  assert.deepEqual([179, 180, 240, 241].map(m => dendaTier(m, APRESIASI_DEFAULTS)), ['', 'SEBAGIAN', 'SEBAGIAN', 'PENUH']);
  assert.equal(dendaTier(600, { ...APRESIASI_DEFAULTS, dendaEnabled: false }), '');
  assert.equal(dendaTier(100, { ...APRESIASI_DEFAULTS, dendaRinganMenit: 60, dendaBeratMenit: 90 }), 'PENUH');
  const bukanPengganti = nilaiShift({ ...base, others: [{ accountId: 'B', start: h(9), end: h(18), replaces: '' }] });
  assert.equal(bukanPengganti.kosongMinutes, 540);
  assert.equal(durasiLabel(270), '4 jam 30 menit');
});

test('CS asli tidak masuk, backup jaga sebagian: potongan ke backup lewat penampung, sisa kosong + denda sebagian', async () => {
  const { sqlite, db, env } = await setup();
  session(sqlite, 'att_avinda', 'avinda', '09:00', '14:00');
  const result = await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.equal(result.evaluated, 1);
  const rows = entries(sqlite);
  const byKind = Object.fromEntries(rows.map(row => [row.kind, row]));
  assert.equal(byKind.POTONG_BACKUP.rupiah, -12000);
  assert.equal(byKind.POTONG_BACKUP.account_id, 'rika');
  assert.match(byKind.POTONG_BACKUP.description, /^Potongan apresiasi · digantikan Avinda 20 Okt · 5 jam x Rp2\.400/);
  assert.equal(byKind.FEE_BACKUP.rupiah, 12000);
  assert.equal(byKind.FEE_BACKUP.account_id, 'avinda');
  assert.match(byKind.FEE_BACKUP.description, /^Apresiasi backup · gantikan Rika 20 Okt · 5 jam x Rp2\.400/);
  assert.equal(byKind.POTONG_KOSONG.rupiah, -9600);
  assert.equal(byKind.DENDA.rupiah, -10000);
  assert.match(byKind.DENDA.description, /^Denda gerai kosong · shift 20 Okt · kosong 4 jam/);
  // Penilaian sekali saja.
  assert.equal((await evaluateDueApresiasi(db, STORE, { now: NOW })).evaluated, 0);
  // Jurnal: penampung 2105 saldo 0, Utang Gaji per nama ikut.
  const posted = sqlite.prepare(`SELECT COUNT(*) AS n FROM accounting_bridge_deliveries WHERE fact_type = 'APRESIASI' AND status = 'POSTED'`).get().n;
  assert.equal(posted, 4);
  assert.equal(saldo2105(sqlite), 0);
  // Riwayat Gaji Portal Staf backup memuat fee-nya.
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'avinda', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('kasir-avinda'));
  const portal = await (await worker.fetch(new Request('https://example.test/api/staff/portal', { headers: { Authorization: 'Bearer kasir-avinda' } }), env)).json();
  assert.deepEqual(portal.apresiasiEntries.map(row => [row.kind, row.amountRupiah]), [['FEE_BACKUP', 12000]]);
});

test('koreksi pengganti dinilai ulang: revisi lama dibatalkan + dibalik, jadi kosong penuh', async () => {
  const { sqlite, db } = await setup();
  session(sqlite, 'att_avinda', 'avinda', '09:00', '14:00');
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  const koreksi = await setPengganti(db, { attendanceId: 'att_avinda', replacesAccountId: '', actor: { role: 'ENTITY_ADMIN', id: 'ea' }, now: NOW });
  assert.equal(koreksi.reevaluated, 1);
  const rows = entries(sqlite);
  assert.deepEqual(rows.map(row => [row.kind, row.rupiah]), [['DENDA', -20000], ['POTONG_KOSONG', -21600]]);
  assert.equal(entries(sqlite, { voided: true }).length, 4);
  const reversed = sqlite.prepare(`SELECT COUNT(*) AS n FROM accounting_bridge_deliveries WHERE fact_type = 'APRESIASI_VOID' AND status = 'POSTED'`).get().n;
  assert.equal(reversed, 4);
  assert.equal(saldo2105(sqlite), 0);
});

test('telat 30 menit tanpa backup = apresiasi 30 menit saja (di bawah batas denda); saklar OFF = tidak dinilai', async () => {
  const { sqlite, db, entityId } = await setup();
  session(sqlite, 'att_rika', 'rika', '09:30', '18:00');
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.deepEqual(entries(sqlite).map(row => [row.kind, row.rupiah]), [['POTONG_KOSONG', -1200]]);

  const off = await setup();
  await saveSettings(off.db, { entityId: off.entityId, input: { enabled: false } });
  assert.equal((await evaluateDueApresiasi(off.db, STORE, { now: NOW })).disabled, true);
  assert.equal(entries(off.sqlite).length, 0);
  // Override per gerai menyalakan lagi -> mulai dihitung hari dinyalakan (bukan ke belakang).
  await saveSettings(off.db, { entityId: off.entityId, storeId: STORE, input: { enabled: true } });
  const row = off.sqlite.prepare(`SELECT enabled, enabled_since FROM apresiasi_settings WHERE store_id = ?`).get(STORE);
  assert.equal(row.enabled, 1);
  assert.ok(row.enabled_since);
  assert.ok(entityId);
});

test('penyesuaian Entity Admin (alasan syar\'i) bawaan membalik penuh dan tampil di riwayat', async () => {
  const { sqlite, db, env, entityId } = await setup();
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  const denda = sqlite.prepare(`SELECT id FROM apresiasi_entries WHERE kind = 'DENDA'`).get();
  const res = await worker.fetch(new Request('https://example.test/api/entity-admin/dana-apresiasi/penyesuaian', {
    method: 'POST', headers: { Authorization: 'Bearer ea-apr', 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId: denda.id, note: 'Sakit, surat dokter' })
  }), env);
  assert.equal(res.status, 201, await res.clone().text());
  const adj = sqlite.prepare(`SELECT amount_scaled / 1000000 AS rupiah, description FROM apresiasi_entries WHERE kind = 'PENYESUAIAN'`).get();
  assert.equal(adj.rupiah, 20000);
  assert.match(adj.description, /^Penyesuaian denda 20 Okt · Sakit, surat dokter/);
  // Nominal bisa diubah.
  const kosong = sqlite.prepare(`SELECT id FROM apresiasi_entries WHERE kind = 'POTONG_KOSONG'`).get();
  assert.equal((await createPenyesuaian(db, { entityId, entryId: kosong.id, amountRupiah: 5000, note: 'separuh' })).ok, true);

  const rekap = await (await worker.fetch(new Request(`https://example.test/api/entity-admin/dana-apresiasi/rekap?from=${DATE}&to=${DATE}`, {
    headers: { Authorization: 'Bearer ea-apr' }
  }), env)).json();
  assert.equal(rekap.totals.dendaRupiah, 20000);
  assert.equal(rekap.totals.penyesuaianRupiah, 25000);
  assert.equal(rekap.totals.selisihRupiah, 0);
  const settings = await (await worker.fetch(new Request('https://example.test/api/entity-admin/dana-apresiasi/settings', {
    headers: { Authorization: 'Bearer ea-apr' }
  }), env)).json();
  const pendem = settings.stores.find(store => store.storeId === STORE);
  assert.equal(pendem.accounts.find(account => account.id === 'avinda').status, 'FREELANCE');
  assert.equal(pendem.effective.enabled, true);
  assert.equal(pendem.effective.since, '2026-10-16');
  // Tanpa tanggal pilihan = bawaan aplikasi; sebelum fitur ada ditolak.
  assert.equal((await saveSettings(db, { entityId, input: { enabled: true, mulaiTanggal: '2026-10-01' } })).ok, false);
  await saveSettings(db, { entityId, input: { enabled: true } });
  assert.equal((await (await worker.fetch(new Request('https://example.test/api/entity-admin/dana-apresiasi/settings', {
    headers: { Authorization: 'Bearer ea-apr' }
  }), env)).json()).entity.since, '2026-10-18');
});

// --- Laporan admin 22 Okt 2026 (Indah, Ade, Adenia): tombol penyelesaian + bug presensi basi ---------

test('presensi lupa ditutup sejak hari lain tidak lagi "menggantikan" CS asli (Ade Dermo / bilget Pendem)', async () => {
  const { sqlite, db } = await setup();
  sqlite.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status) VALUES ('att_basi', 'avinda', ?, 'in', x'00', 'image/jpeg', '2026-10-10T05:00:00.000Z', 'OPEN')`).run(STORE);
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  const rows = entries(sqlite);
  assert.equal(rows.some(row => row.kind === 'FEE_BACKUP'), false, 'akun dengan presensi basi tidak dapat fee backup');
  assert.equal(rows.find(row => row.kind === 'POTONG_KOSONG')?.rupiah, -21600);
});

test('nilai ulang dengan jadwal sekarang: jadwal salah dibetulkan -> potongan dibatalkan, ada pratinjau', async () => {
  const { sqlite, db } = await setup();
  session(sqlite, 'att_rika', 'rika', '13:00', '18:00');
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.ok(entries(sqlite).length > 0, 'telat 4 jam menurut jadwal 09:00 tercatat');
  sqlite.prepare(`UPDATE account_shift_schedule SET shift_start = '13:00' WHERE account_id = 'rika'`).run();
  const id = sqlite.prepare(`SELECT id FROM apresiasi_evaluations WHERE account_id = 'rika'`).get().id;
  const pratinjau = await reevaluate(db, id, { jadwalSekarang: true, dryRun: true, now: NOW });
  assert.equal(pratinjau.changed, true);
  assert.equal(pratinjau.shift, '13:00-18:00');
  assert.deepEqual(pratinjau.baru, []);
  assert.ok(entries(sqlite).length > 0, 'pratinjau tidak menulis apa pun');
  const hasil = await reevaluate(db, id, { jadwalSekarang: true, actor: { role: 'ENTITY_ADMIN', id: 'ea_apr' }, reason: 'Jadwal dibetulkan', now: NOW });
  assert.equal(hasil.changed, true);
  assert.deepEqual(entries(sqlite), []);
  assert.equal(saldo2105(sqlite), 0);
});

test('CS berhenti per tanggal (Indah): potongan & denda sejak tanggal itu dibatalkan, shift sesudahnya tidak dinilai', async () => {
  const { sqlite, db } = await setup();
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.ok(entries(sqlite).some(row => row.kind === 'DENDA'), 'tidak masuk sama sekali = potongan + denda');
  const result = await setBerhenti(db, { accountId: 'rika', tanggal: DATE, actor: { role: 'ENTITY_ADMIN', id: 'ea_apr' }, now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.reevaluated, 1);
  assert.deepEqual(entries(sqlite), []);
  assert.equal(sqlite.prepare(`SELECT berhenti_tanggal FROM cashier_cs_status WHERE account_id = 'rika'`).get().berhenti_tanggal, DATE);
  const besok = new Date(`2026-10-21T20:00:00+07:00`);
  await evaluateDueApresiasi(db, STORE, { now: besok });
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM apresiasi_evaluations WHERE account_id = 'rika' AND business_date = '2026-10-21'`).get().n, 0);
});

test('riwayat gaji: baris akun yang tertaut sebentar di masa lalu tidak ikut (zahra tes -> Ade)', async () => {
  const { sqlite, db, entityId } = await setup();
  sqlite.prepare(`INSERT INTO employees (id, entity_id, full_name) VALUES ('emp_ade', ?, 'Ade')`).run(entityId);
  sqlite.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from, effective_to) VALUES ('lnk1', 'emp_ade', ?, 'CASHIER', 'avinda', ?, '2026-09-18T04:35:42.926Z', '2026-09-18T04:36:30.020Z')`).run(entityId, STORE);
  session(sqlite, 'att_avinda', 'avinda', '09:00', '14:00');
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.ok(entries(sqlite).some(row => row.kind === 'FEE_BACKUP' && row.account_id === 'avinda'));
  const ledger = await buildEmployeeLedger(db, { employeeId: 'emp_ade', entityId, kind: 'gaji' });
  assert.ok(ledger.accounts.some(account => account.accountId === 'avinda'), 'akun pernah tertaut tetap dibaca, jadi tes ini benar-benar menguji batas masa tautan');
  assert.equal((ledger.entries || []).some(row => String(row.kind).startsWith('APRESIASI')), false);
});

test('resign karyawan: akun kasir nonaktif & logout, tautan ditutup, potongan sejak tanggal itu dibatalkan', async () => {
  const { sqlite, db, entityId } = await setup();
  const { resignEmployee } = await import('../src/employee-master.js');
  sqlite.prepare(`INSERT INTO employees (id, entity_id, full_name) VALUES ('emp_rika', ?, 'Rika')`).run(entityId);
  sqlite.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES ('lnk_rika', 'emp_rika', ?, 'CASHIER', 'rika', ?, '2026-10-01T00:00:00.000Z')`).run(entityId, STORE);
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES ('tok_rika', 'rika', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run();
  await evaluateDueApresiasi(db, STORE, { now: NOW });
  assert.ok(entries(sqlite).some(row => row.account_id === 'rika'));
  const employee = sqlite.prepare(`SELECT * FROM employees WHERE id = 'emp_rika'`).get();
  const result = await resignEmployee(db, { employee, tanggal: DATE, alasan: 'Resign', actor: { role: 'ENTITY_ADMIN', id: 'ea_apr' }, now: NOW });
  assert.equal(result.ok, true);
  assert.deepEqual(result.accountsDeactivated, ['rika']);
  assert.equal(result.reevaluated, 1);
  assert.deepEqual(entries(sqlite), []);
  assert.deepEqual({ ...sqlite.prepare(`SELECT status, berhenti_tanggal, berhenti_alasan FROM employees WHERE id = 'emp_rika'`).get() }, { status: 'INACTIVE', berhenti_tanggal: DATE, berhenti_alasan: 'Resign' });
  assert.equal(sqlite.prepare(`SELECT is_active FROM cashiers WHERE id = 'rika'`).get().is_active, 0);
  assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM cashier_sessions WHERE cashier_id = 'rika'`).get().n, 0);
  assert.ok(sqlite.prepare(`SELECT effective_to FROM employee_account_links WHERE id = 'lnk_rika'`).get().effective_to);
});

test('resign ditolak bila akunnya masih memegang laci terbuka', async () => {
  const { sqlite, db, entityId } = await setup();
  const { resignEmployee } = await import('../src/employee-master.js');
  sqlite.prepare(`INSERT INTO employees (id, entity_id, full_name) VALUES ('emp_rika', ?, 'Rika')`).run(entityId);
  sqlite.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES ('lnk_rika', 'emp_rika', ?, 'CASHIER', 'rika', ?, '2026-10-01T00:00:00.000Z')`).run(entityId, STORE);
  sqlite.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES ('drw_rika', ?, 'rika', 0, 'OPEN', '2026-10-20T02:00:00.000Z')`).run(STORE);
  const employee = sqlite.prepare(`SELECT * FROM employees WHERE id = 'emp_rika'`).get();
  const result = await resignEmployee(db, { employee, tanggal: DATE, actor: { role: 'ENTITY_ADMIN', id: 'ea_apr' }, now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'DRAWER_STILL_OPEN');
  assert.equal(sqlite.prepare(`SELECT status FROM employees WHERE id = 'emp_rika'`).get().status, 'ACTIVE');
});
