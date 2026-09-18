import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleAdminCashierApi } from '../src/cashier-auth.js';
import { handleEmployeeMasterApi } from '../src/employee-master.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-18: "hana kamu salah naruh, harus nya detil itu tadi
// kamu taruh di user kasir/staf. bukan malah di nama orangnya ... tombol
// karyawan itu yang aku maksudkan nama orang, sedangkan yang ada di master
// kasir itu adalah employed atau pekerjaannya."
//
// Koreksi dari test/employee-link-shift-detail.test.js (migration 0103,
// sekarang usang): detail jabatan (gaji per jam, jam kerja, jenis pekerjaan)
// menempel ke AKUN kasir (account_job_details, migration 0104), bukan ke
// tautan person-ke-akun. "Karyawan" murni identitas orang.

const migrationDir = new URL('../migrations/', import.meta.url);
const employeeAdminUi = readFileSync(new URL('../public/admin-employees.js', import.meta.url), 'utf8');
const cashierAdminUi = readFileSync(new URL('../public/admin-cashiers.js', import.meta.url), 'utf8');

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() {
            const result = statement.run(...args);
            return { ...result, success: true, meta: { changes: result.changes } };
          }
        };
      }
    };
  }
  return {
    prepare: prepared,
    async batch(boundStatements) {
      sqlite.exec('BEGIN');
      try {
        const results = boundStatements.map(item => item._statement.run(...item._args));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function request(pathname, { token, method = 'GET', body, store } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

const cashierCall = (env, pathname, options) => handleAdminCashierApi(request(pathname, options), env, pathname);
const employeeCall = (env, pathname, options) => handleEmployeeMasterApi(request(pathname, options), env, pathname);

async function storeAdminToken(sqlite, adminId) {
  const token = `emp-admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-18T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

test('detail jabatan (gaji/jam/jenis pekerjaan) tersimpan saat membuat kasir baru, dan terbaca balik lewat GET', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const created = await (await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_shift1', password: 'rahasia1', employeeName: 'Slot Shift 1', jobType: 'Kasir Shift Pagi', hourlyWage: 15000, shiftStart: '08:00', shiftEnd: '16:00' }
    })).json();
    assert.ok(created.id);

    // Tersimpan sebagai scaled integer (CLAUDE.md invariant #1), bukan float.
    const row = sqlite.prepare(`SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM account_job_details WHERE account_type = 'CASHIER' AND account_id = ?`).get(created.id);
    assert.equal(row.hourly_wage_scaled, 15000 * 1_000_000);
    assert.equal(row.shift_start, '08:00');
    assert.equal(row.shift_end, '16:00');
    assert.equal(row.job_type, 'Kasir Shift Pagi');

    const list = await (await cashierCall(env, '/api/admin/cashiers', { token, store: 'PENDEM' })).json();
    const cashier = list.cashiers.find(c => c.id === created.id);
    assert.equal(cashier.hourlyWage, 15000, 'kembali ke rupiah biasa di response, bukan angka scaled mentah');
    assert.equal(cashier.shiftStart, '08:00');
    assert.equal(cashier.shiftEnd, '16:00');
    assert.equal(cashier.jobType, 'Kasir Shift Pagi');
  } finally { sqlite.close(); }
});

test('kasir baru tanpa detail jabatan sah -- default kosong/nol', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const created = await (await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_polos', password: 'rahasia1', employeeName: 'Kasir Polos' }
    })).json();

    const row = sqlite.prepare(`SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM account_job_details WHERE account_type = 'CASHIER' AND account_id = ?`).get(created.id);
    assert.equal(row.hourly_wage_scaled, 0);
    assert.equal(row.shift_start, '');
    assert.equal(row.job_type, '');
  } finally { sqlite.close(); }
});

test('detail jabatan bisa diedit lewat PATCH tanpa mengubah identitas akun', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await (await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_shift1', password: 'rahasia1', employeeName: 'Slot Shift 1' }
    })).json();

    const patched = await cashierCall(env, `/api/admin/cashiers/${created.id}`, {
      token, store: 'PENDEM', method: 'PATCH',
      body: { jobType: 'Kasir Shift Sore', hourlyWage: 17500, shiftStart: '14:00', shiftEnd: '22:00' }
    });
    assert.equal(patched.status, 200);

    const row = sqlite.prepare(`SELECT hourly_wage_scaled, shift_start, job_type FROM account_job_details WHERE account_type = 'CASHIER' AND account_id = ?`).get(created.id);
    assert.equal(row.hourly_wage_scaled, 17500 * 1_000_000);
    assert.equal(row.shift_start, '14:00');
    assert.equal(row.job_type, 'Kasir Shift Sore');

    const account = sqlite.prepare('SELECT username, employee_name FROM cashiers WHERE id = ?').get(created.id);
    assert.equal(account.username, 'kasir_shift1');
    assert.equal(account.employee_name, 'Slot Shift 1');
  } finally { sqlite.close(); }
});

test('PATCH detail sebagian -- field yang tidak dikirim tidak ikut berubah', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const created = await (await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_shift1', password: 'rahasia1', employeeName: 'Slot Shift 1', jobType: 'Kasir', hourlyWage: 15000, shiftStart: '08:00', shiftEnd: '16:00' }
    })).json();

    // Cuma ganti gaji -- jam dan jenis pekerjaan tidak dikirim sama sekali.
    await cashierCall(env, `/api/admin/cashiers/${created.id}`, { token, store: 'PENDEM', method: 'PATCH', body: { hourlyWage: 20000 } });

    const row = sqlite.prepare(`SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM account_job_details WHERE account_type = 'CASHIER' AND account_id = ?`).get(created.id);
    assert.equal(row.hourly_wage_scaled, 20000 * 1_000_000);
    assert.equal(row.shift_start, '08:00', 'jam mulai yang tidak dikirim harus tetap seperti sebelumnya');
    assert.equal(row.shift_end, '16:00');
    assert.equal(row.job_type, 'Kasir');
  } finally { sqlite.close(); }
});

test('detail jabatan ditolak kalau format jam salah atau gaji negatif/kelewat besar', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const badTime = await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_a', password: 'rahasia1', employeeName: 'A', shiftStart: '25:99' }
    });
    assert.equal(badTime.status, 400);

    const badWage = await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_b', password: 'rahasia1', employeeName: 'B', hourlyWage: -5000 }
    });
    assert.equal(badWage.status, 400);

    const tooBig = await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_c', password: 'rahasia1', employeeName: 'C', hourlyWage: 999_999_999 }
    });
    assert.equal(tooBig.status, 400);

    // Ketiganya ditolak -- pastikan tidak ada akun kasir nyangkut setengah jalan.
    const count = sqlite.prepare(`SELECT COUNT(*) AS n FROM cashiers WHERE username IN ('kasir_a','kasir_b','kasir_c')`).get();
    assert.equal(count.n, 0);
  } finally { sqlite.close(); }
});

test('detail jabatan menempel ke AKUN, bertahan walau akun dioper ke karyawan lain -- sifat jabatan, bukan sifat orang', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const created = await (await cashierCall(env, '/api/admin/cashiers', {
      token, store: 'PENDEM', method: 'POST',
      body: { username: 'kasir_shift1', password: 'rahasia1', employeeName: 'Slot Shift 1', jobType: 'Kasir Shift Pagi', hourlyWage: 15000, shiftStart: '08:00', shiftEnd: '16:00' }
    })).json();

    const ani = await (await employeeCall(env, '/api/admin/employees', { token, store: 'PENDEM', method: 'POST', body: { fullName: 'Ani' } })).json();
    await employeeCall(env, `/api/admin/employees/${ani.id}/links`, { token, store: 'PENDEM', method: 'POST', body: { accountType: 'CASHIER', accountId: created.id } });

    // Ani pindah -- akun ini dioper ke Budi. Tautan lama ditutup, ditautkan
    // baru ke karyawan lain. Detail jabatan pada akun TIDAK ikut berubah.
    const linkId = sqlite.prepare(`SELECT id FROM employee_account_links WHERE account_id = ? AND effective_to IS NULL`).get(created.id).id;
    await employeeCall(env, `/api/admin/employee-links/${linkId}`, { token, store: 'PENDEM', method: 'DELETE', body: {} });
    const budi = await (await employeeCall(env, '/api/admin/employees', { token, store: 'PENDEM', method: 'POST', body: { fullName: 'Budi' } })).json();
    await employeeCall(env, `/api/admin/employees/${budi.id}/links`, { token, store: 'PENDEM', method: 'POST', body: { accountType: 'CASHIER', accountId: created.id } });

    const row = sqlite.prepare(`SELECT hourly_wage_scaled, shift_start, job_type FROM account_job_details WHERE account_type = 'CASHIER' AND account_id = ?`).get(created.id);
    assert.equal(row.hourly_wage_scaled, 15000 * 1_000_000, 'gaji jabatan tidak ikut ter-reset waktu pemegangnya berganti');
    assert.equal(row.shift_start, '08:00');
    assert.equal(row.job_type, 'Kasir Shift Pagi');
  } finally { sqlite.close(); }
});

test('UI Master Kasir menyediakan input detail jabatan, dan tab Karyawan tidak lagi punya input detail shift', () => {
  assert.match(cashierAdminUi, /cashierJobType/);
  assert.match(cashierAdminUi, /cashierHourlyWage/);
  assert.match(cashierAdminUi, /cashierShiftStart/);
  assert.match(cashierAdminUi, /cashierShiftEnd/);

  assert.doesNotMatch(employeeAdminUi, /data-new-link-job|data-new-link-wage|data-detail-edit|data-detail-save|hourlyWage|shiftStart|shiftEnd|jobType/, 'tab Karyawan murni identitas orang, tidak boleh lagi punya input detail jabatan');
});

// Bos Cyo, 2026-09-18: "harusnya sih yang menautkan di satu sisi aja ...
// jadi pilih satu yang ditautkan saja". Tidak berubah dari koreksi ini --
// satu-satunya endpoint create link tetap di employee-master.js, dari sisi
// Karyawan. Yang berubah cuma pindahnya detail jabatan.
test('form Tambah Kasir tidak jadi jalur tautkan kedua -- cuma label tampilan, menautkan tetap dari tab Karyawan', () => {
  assert.doesNotMatch(cashierAdminUi, /employee-links|employee_account_links|Tautkan/i, 'Tambah Kasir tidak boleh punya mekanisme tautkan sendiri');
  assert.match(cashierAdminUi, /Cuma label tampilan akun ini/);
});
