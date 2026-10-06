import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-06:
// - "tombol karyawan entity admin ... cek saldo piutang/setoran dari karyawan tersebut, terlihat jika
//   satu karyawan tadi tertaut dengan 2 atau lebih akun kerja dan beda gerai ... tombol filter untuk
//   memilih misal hanya dari akun terpilih ... mekanisme yang sama untuk hutang gajinya."
// - "Entity admin ketika buka portal staf dari kasir bisa melihat seluruh portal staf dari username
//   akun tersebut dan ada pilihan filternya"
// - "ketika aku masukke halaman kasir lewat entity admin, aku ga bisa balik lagi ke entity admin"

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

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES ('ea_kpm', 'ENT-KPM', 'ea.kpm', 'x', 'EA KPM', 1)`).run();
  db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, 'ea_kpm', '2026-10-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('ea-kpm'));
  const other = db.prepare(`SELECT id, code FROM stores WHERE entity_id = 'ENT-KPM' AND id <> 'store_pendem' AND is_active = 1 ORDER BY code LIMIT 1`).get();
  db.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_sari', 'ENT-KPM', 'store_pendem', 'Sari', 'ACTIVE')`).run();
  for (const [id, store, username] of [['kasir_sari_p', 'store_pendem', 'sari.pendem'], ['kasir_sari_o', other.id, 'sari.other']]) {
    db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES (?, ?, 'x', 'Sari', ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(id, username, store);
    db.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES (?, 'emp_sari', 'ENT-KPM', 'CASHIER', ?, ?, '2026-10-01T00:00:00.000Z')`).run(`link_${id}`, id, store);
    db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at) VALUES (?, ?, ?, 0, 'CLOSED', '2026-10-04T01:00:00.000Z')`).run(`drawer_${id}`, store, id);
  }
  const seedReceivable = (id, store, drawer, amount, holder = 'emp_sari') => db.prepare(`
    INSERT INTO operational_receivables_payables (id, store_id, entity_id, source_type, balance_type, source_id, counterparty_id, counterparty_name_snapshot, counterparty_type, description, original_amount, transaction_date, created_at)
    VALUES (?, ?, 'ENT-KPM', 'EMPLOYEE_DEPOSIT', 'RECEIVABLE', ?, ?, 'Sari', 'EMPLOYEE', 'Setoran laci', ?, '2026-10-04', '2026-10-04T10:00:00.000Z')
  `).run(id, store, drawer, holder, amount * 1_000_000);
  seedReceivable('orp_p', 'store_pendem', 'drawer_kasir_sari_p', 100000);
  // Setoran lama sebelum akun ditautkan: atas nama akun kasir (`cashier:<id>`), tetap milik Sari.
  seedReceivable('orp_o', other.id, 'drawer_kasir_sari_o', 50000, 'cashier:kasir_sari_o');
  db.prepare(`
    INSERT INTO operational_receivable_payable_payments (id, receivable_payable_id, store_id, entity_id, amount, approval_status, proof_reference, submitted_by, reviewed_by, reviewed_at, created_at)
    VALUES ('pay_p', 'orp_p', 'store_pendem', 'ENT-KPM', 40000000000, 'approved', 'Foto bukti transfer', 'kasir', 'admin', '2026-10-05T02:00:00.000Z', '2026-10-05T01:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO payroll_ledger_entries (id, employee_id, account_type, account_id, store_id, business_date, entry_type, hutang_gaji_delta_scaled, beban_gaji_delta_scaled, source_type, source_id, description)
    VALUES ('acc_1', NULL, 'CASHIER', 'kasir_sari_p', 'store_pendem', '2026-10-04', 'ACCRUAL', 70000000000, 70000000000, 'ATTENDANCE', 'att_1', 'Presensi'),
           ('acc_2', NULL, 'CASHIER', 'kasir_sari_o', ?, '2026-10-05', 'ACCRUAL', 30000000000, 30000000000, 'ATTENDANCE', 'att_2', 'Presensi'),
           ('pay_1', 'emp_sari', NULL, NULL, 'store_pendem', '2026-10-06', 'PAYMENT', -60000000000, 0, 'BEA_OPERASIONAL', 'admpay_x', 'Pelunasan')
  `).run(other.id);
  return { db, env: { DB: new D1Database(db) }, other };
}

const get = (env, path, token = 'ea-kpm') => worker.fetch(new Request(`https://example.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), env);

test('Riwayat Setoran karyawan: semua akun tertaut lintas gerai + filter per akun', async () => {
  const { db, env } = await setup();
  try {
    const all = await (await get(env, '/api/entity-admin/employees/emp_sari/ledger?kind=setoran')).json();
    assert.equal(all.accounts.length, 2);
    assert.equal(all.balanceRupiah, 110000, '100.000 + 50.000 - 40.000');
    assert.equal(all.entries.length, 3);
    assert.equal(all.entries[0].label, 'Transfer setoran', 'terbaru di atas');

    const onlyOther = await (await get(env, '/api/entity-admin/employees/emp_sari/ledger?kind=setoran&account=kasir_sari_o')).json();
    assert.equal(onlyOther.balanceRupiah, 50000);
    assert.deepEqual(onlyOther.entries.map(entry => entry.accountUsername), ['sari.other']);

    const gaji = await (await get(env, '/api/entity-admin/employees/emp_sari/ledger?kind=gaji')).json();
    assert.equal(gaji.balanceRupiah, 40000, '70.000 + 30.000 - 60.000');
    const gajiPendem = await (await get(env, '/api/entity-admin/employees/emp_sari/ledger?kind=gaji&account=kasir_sari_p')).json();
    assert.equal(gajiPendem.balanceRupiah, 70000);

    assert.equal((await get(env, '/api/entity-admin/employees/emp_sari/ledger?kind=setoran', 'salah')).status, 401);
    db.prepare(`INSERT INTO employees (id, entity_id, full_name, status) VALUES ('emp_luar', 'ENT-GALEH', 'Orang Luar', 'ACTIVE')`).run();
    assert.equal((await get(env, '/api/entity-admin/employees/emp_luar/ledger?kind=setoran')).status, 404, 'karyawan entity lain tidak bisa dibuka');
  } finally { db.close(); }
});

test('Portal Staf Mode Lihat: Entity Admin membaca portal akun pilihan, tidak bisa menulis, tidak bisa keluar gerai', async () => {
  const { db, env, other } = await setup();
  try {
    const accounts = await (await get(env, '/api/staff/viewer-accounts?store=PENDEM')).json();
    assert.ok(accounts.accounts.some(row => row.username === 'sari.pendem'));
    assert.ok(accounts.accounts.some(row => row.username === 'sari.other' && row.storeCode === other.code), 'Entity Admin melihat akun semua gerai entity');

    const portal = await get(env, '/api/staff/portal?store=PENDEM&account=kasir_sari_p');
    assert.equal(portal.status, 200, await portal.clone().text());
    assert.equal((await portal.json()).staff.username, 'sari.pendem');
    const deposits = await (await get(env, '/api/cashier/employee-deposits?store=PENDEM&account=kasir_sari_p')).json();
    assert.ok(Array.isArray(deposits.items));

    // Akun gerai lain tidak bisa dibaca lewat ?store= gerai ini.
    const salahGerai = await get(env, '/api/staff/portal?store=PENDEM&account=kasir_sari_o');
    assert.notEqual(salahGerai.status, 200);

    // Menulis tetap ditolak.
    const tulis = await worker.fetch(new Request('https://example.test/api/staff/daily-tasks/complete?store=PENDEM&account=kasir_sari_p', {
      method: 'POST', headers: { Authorization: 'Bearer ea-kpm', 'Content-Type': 'application/json' }, body: JSON.stringify({ templateId: 'x' })
    }), env);
    assert.equal(tulis.status, 403);
    assert.equal((await tulis.json()).code, 'CASHIER_READ_ONLY_MODE');
  } finally { db.close(); }
});

test('Halaman kasir & Portal Staf Mode Lihat punya tombol kembali dan pilihan akun', () => {
  const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
  const cashierHtml = read('cashier.html');
  assert.match(cashierHtml, /id="backToEntityAdmin"/);
  assert.match(cashierHtml, /id="backToBranchAdmin"/);
  assert.match(read('cashier.js'), /function renderViewerNavigation/);
  // cashier-workspace.js MENIMPA openDashboard milik cashier.js -- tombol kembali harus dipasang dari
  // override-nya (bug 2026-10-06: dipasang hanya di versi lama, jadi tidak pernah muncul).
  assert.match(read('cashier-workspace.js'), /renderViewerNavigation\(cashier\)/);
  assert.doesNotMatch(read('staff.js'), /attendanceToggleBtn'\)\.classList\.add\('hidden'\)/, 'Portal Staf Mode Lihat menampilkan semua tombol seperti karyawan');
  assert.match(read('cashier.js'), /\/staff\?readonly=1&store=/);
  const staff = read('staff.js');
  assert.match(staff, /\/api\/staff\/viewer-accounts/);
  assert.match(staff, /staffViewerAccount/);
  assert.match(read('staff-entry-guard.js'), /\(isCashier \|\| isStaffPortal\) && new URLSearchParams/);
  assert.match(read('entity-admin.js'), /data-employee-ledger="setoran"/);
  assert.match(read('entity-admin.js'), /data-employee-ledger="gaji"/);
  assert.match(read('entity-admin.js'), /data-shared-ledger-toggle/);
});
