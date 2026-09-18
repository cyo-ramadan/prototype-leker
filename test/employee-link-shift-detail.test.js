import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEmployeeMasterApi } from '../src/employee-master.js';

// Bos Cyo, 2026-09-18: "kasi kolom gaji per jam, dan jam kerjanya (dari dan
// sampai), jenis pekerjaan... satu nama bisa ditautkan di beberapa akun ya.
// misal ani dia di gerai dermo kerja sebagai shift 1, tapi juga jadi shift 3
// dimana memiliki jam kerja yang beda tergantung ngisi detilnya."
//
// Detail shift (migration 0103) sengaja nempel ke TAUTAN (employee_account_
// links), bukan ke karyawan -- supaya tiap penugasan (shift 1, shift 3) bisa
// beda gaji/jam/jenis pekerjaan sendiri-sendiri, walau orangnya sama.
//
// Bos Cyo juga minta "tautkan" cuma satu arah (dari sisi Karyawan) -- itu
// sudah begitu sejak migration 0072 (satu-satunya endpoint create link:
// POST /api/admin/employees/:id/links), tidak ada perubahan arah di sini.

const migrationDir = new URL('../migrations/', import.meta.url);
const adminUi = readFileSync(new URL('../public/admin-employees.js', import.meta.url), 'utf8');
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
  return { prepare: prepared };
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

const call = (env, pathname, options) => handleEmployeeMasterApi(request(pathname, options), env, pathname);

async function storeAdminToken(sqlite, adminId) {
  const { hashCredential } = await import('../src/owner-auth.js');
  const token = `emp-admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-18T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function createEmployee(env, token, store, payload) {
  const response = await call(env, '/api/admin/employees', { token, store, method: 'POST', body: payload });
  return { status: response.status, ...(await response.json()) };
}

test('detail shift (gaji/jam/jenis pekerjaan) tersimpan saat menautkan, dan terbaca balik lewat GET', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });

    const linked = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot', jobType: 'Kasir Shift Pagi', hourlyWage: 15000, shiftStart: '08:00', shiftEnd: '16:00' }
    });
    assert.equal(linked.status, 201);

    // Tersimpan sebagai scaled integer (CLAUDE.md invariant #1), bukan float.
    const row = sqlite.prepare('SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM employee_account_links WHERE employee_id = ?').get(ani.id);
    assert.equal(row.hourly_wage_scaled, 15000 * 1_000_000);
    assert.equal(row.shift_start, '08:00');
    assert.equal(row.shift_end, '16:00');
    assert.equal(row.job_type, 'Kasir Shift Pagi');

    const list = await (await call(env, '/api/admin/employees', { token, store: 'PENDEM' })).json();
    const aniLink = list.employees.find(e => e.id === ani.id).links[0];
    assert.equal(aniLink.hourlyWage, 15000, 'kembali ke rupiah biasa di response, bukan angka scaled mentah');
    assert.equal(aniLink.shiftStart, '08:00');
    assert.equal(aniLink.shiftEnd, '16:00');
    assert.equal(aniLink.jobType, 'Kasir Shift Pagi');
  } finally { sqlite.close(); }
});

test('menautkan tanpa detail sah -- detail boleh diisi belakangan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });

    const linked = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    });
    assert.equal(linked.status, 201);
    const row = sqlite.prepare('SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM employee_account_links WHERE employee_id = ?').get(ani.id);
    assert.equal(row.hourly_wage_scaled, 0);
    assert.equal(row.shift_start, '');
    assert.equal(row.job_type, '');
  } finally { sqlite.close(); }
});

test('detail shift pada tautan aktif bisa diedit lewat PATCH tanpa menutup tautan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });
    const linkId = (await (await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST', body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    })).json()).id;

    const patched = await call(env, `/api/admin/employee-links/${linkId}`, {
      token, store: 'PENDEM', method: 'PATCH',
      body: { jobType: 'Kasir Shift Sore', hourlyWage: 17500, shiftStart: '14:00', shiftEnd: '22:00' }
    });
    assert.equal(patched.status, 200);

    const row = sqlite.prepare('SELECT hourly_wage_scaled, shift_start, shift_end, job_type, employee_id, account_id, effective_to FROM employee_account_links WHERE id = ?').get(linkId);
    assert.equal(row.hourly_wage_scaled, 17500 * 1_000_000);
    assert.equal(row.shift_start, '14:00');
    assert.equal(row.job_type, 'Kasir Shift Sore');
    // Identitas tautan tidak boleh ikut berubah -- yang diedit cuma detailnya.
    assert.equal(row.employee_id, ani.id);
    assert.equal(row.account_id, 'cashier_pendem_pilot');
    assert.equal(row.effective_to, null, 'PATCH detail tidak boleh menutup tautan');
  } finally { sqlite.close(); }
});

test('PATCH detail sebagian -- field yang tidak dikirim tidak ikut berubah', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });
    const linkId = (await (await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot', jobType: 'Kasir', hourlyWage: 15000, shiftStart: '08:00', shiftEnd: '16:00' }
    })).json()).id;

    // Cuma ganti gaji -- jam dan jenis pekerjaan tidak dikirim sama sekali.
    await call(env, `/api/admin/employee-links/${linkId}`, { token, store: 'PENDEM', method: 'PATCH', body: { hourlyWage: 20000 } });

    const row = sqlite.prepare('SELECT hourly_wage_scaled, shift_start, shift_end, job_type FROM employee_account_links WHERE id = ?').get(linkId);
    assert.equal(row.hourly_wage_scaled, 20000 * 1_000_000);
    assert.equal(row.shift_start, '08:00', 'jam mulai yang tidak dikirim harus tetap seperti sebelumnya');
    assert.equal(row.shift_end, '16:00');
    assert.equal(row.job_type, 'Kasir');
  } finally { sqlite.close(); }
});

test('detail shift ditolak kalau format jam salah atau gaji negatif', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });

    const badTime = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot', shiftStart: '25:99' }
    });
    assert.equal(badTime.status, 400);

    const badWage = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot', hourlyWage: -5000 }
    });
    assert.equal(badWage.status, 400);

    // Dua-duanya ditolak -- pastikan tidak ada tautan nyangkut setengah jalan.
    const links = sqlite.prepare('SELECT COUNT(*) AS n FROM employee_account_links WHERE employee_id = ?').get(ani.id);
    assert.equal(links.n, 0);
  } finally { sqlite.close(); }
});

test('tautan yang sudah dilepas tidak bisa diedit detailnya lagi', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });
    const linkId = (await (await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST', body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    })).json()).id;
    await call(env, `/api/admin/employee-links/${linkId}`, { token, store: 'PENDEM', method: 'DELETE', body: {} });

    const patched = await call(env, `/api/admin/employee-links/${linkId}`, {
      token, store: 'PENDEM', method: 'PATCH', body: { hourlyWage: 20000 }
    });
    assert.equal(patched.status, 409);
    assert.equal((await patched.json()).code, 'LINK_ALREADY_CLOSED');
  } finally { sqlite.close(); }
});

test('satu karyawan boleh punya dua tautan aktif sekaligus, tiap tautan detail shift-nya berdiri sendiri (Ani shift 1 vs shift 3)', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    // Akun kedua di gerai yang sama -- persis skenario "shift 1 dan shift 3
    // di gerai Dermo yang sama" yang diminta Bos Cyo.
    sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
      VALUES ('cashier_pendem_shift3', 'kasir_pendem_shift3', 'x', 'Kasir Shift 3', 'store_pendem', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();

    const ani = await createEmployee(env, token, 'PENDEM', { fullName: 'Ani' });

    const shift1 = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot', jobType: 'Kasir Shift 1', shiftStart: '07:00', shiftEnd: '15:00', hourlyWage: 15000 }
    });
    assert.equal(shift1.status, 201);

    const shift3 = await call(env, `/api/admin/employees/${ani.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_shift3', jobType: 'Kasir Shift 3', shiftStart: '23:00', shiftEnd: '07:00', hourlyWage: 20000 }
    });
    assert.equal(shift3.status, 201);

    const list = await (await call(env, '/api/admin/employees', { token, store: 'PENDEM' })).json();
    const links = list.employees.find(e => e.id === ani.id).links;
    assert.equal(links.length, 2, 'dua tautan aktif hidup berdampingan untuk satu karyawan yang sama');

    const byAccount = Object.fromEntries(links.map(link => [link.accountId, link]));
    assert.equal(byAccount.cashier_pendem_pilot.jobType, 'Kasir Shift 1');
    assert.equal(byAccount.cashier_pendem_pilot.shiftStart, '07:00');
    assert.equal(byAccount.cashier_pendem_pilot.hourlyWage, 15000);
    assert.equal(byAccount.cashier_pendem_shift3.jobType, 'Kasir Shift 3');
    assert.equal(byAccount.cashier_pendem_shift3.shiftStart, '23:00');
    assert.equal(byAccount.cashier_pendem_shift3.hourlyWage, 20000, 'gaji per jam berbeda per tautan, bukan ikut satu employee yang sama');
  } finally { sqlite.close(); }
});

test('UI Karyawan menyediakan input detail shift saat menautkan dan saat mengubah tautan yang sudah ada', () => {
  assert.match(adminUi, /data-new-link-job=/);
  assert.match(adminUi, /data-new-link-wage=/);
  assert.match(adminUi, /data-new-link-start=/);
  assert.match(adminUi, /data-new-link-end=/);
  assert.match(adminUi, /data-detail-edit=/);
  assert.match(adminUi, /data-detail-save=/);
  assert.match(adminUi, /jobType, hourlyWage, shiftStart, shiftEnd/);
  assert.match(adminUi, /method: 'PATCH'/);
});

// Bos Cyo, 2026-09-18: "harusnya sih yang menautkan di satu sisi aja ...
// jadi pilih satu yang ditautkan saja". Sudah begitu sejak awal (satu-satunya
// endpoint create link ada di employee-master.js, dipanggil dari sisi
// Karyawan) -- yang diperjelas di sini cuma labelnya, supaya field "Nama
// karyawan" di Tambah Kasir tidak lagi terkesan seperti jalur tautkan kedua.
test('form Tambah Kasir tidak lagi terkesan sebagai jalur tautkan kedua -- cuma label tampilan', () => {
  assert.doesNotMatch(cashierAdminUi, /employee-links|employee_account_links|Tautkan/i, 'Tambah Kasir tidak boleh punya mekanisme tautkan sendiri');
  assert.match(cashierAdminUi, /Cuma label tampilan akun ini/);
});
