import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleEmployeeMasterApi } from '../src/employee-master.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-04, Bos Cyo: Master Karyawan memisahkan "orang" dari "akun login".
// Satu orang boleh memegang beberapa username di gerai berbeda (CS backup),
// satu username cuma boleh dipegang satu orang pada satu waktu, dan riwayat
// siapa memegang apa tidak boleh hilang saat username dioper ke pengganti --
// itu yang bikin gaji/setoran lama tetap menempel ke orang yang benar.

const migrationDir = new URL('../migrations/', import.meta.url);
const adminUi = readFileSync(new URL('../public/admin-employees.js', import.meta.url), 'utf8');
const branchAdminHtml = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');

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

async function storeAdminToken(sqlite, adminId) {
  const token = `emp-admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function ownerToken(sqlite) {
  const owner = sqlite.prepare('SELECT id FROM owner_accounts ORDER BY id LIMIT 1').get();
  const token = 'emp-owner-token';
  sqlite.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), owner.id);
  return token;
}

const call = (env, pathname, options) => handleEmployeeMasterApi(request(pathname, options), env, pathname);

async function createEmployee(env, token, store, payload) {
  const response = await call(env, '/api/admin/employees', { token, store, method: 'POST', body: payload });
  const json = await response.json();
  return { status: response.status, ...json };
}

test('Admin Gerai membuat karyawan: tercatat milik entity gerainya, dengan gerai perekrut', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const created = await createEmployee(env, token, 'PENDEM', { fullName: 'Mita Wulandari', phone: '0812' });
    assert.equal(created.status, 201);

    const row = sqlite.prepare('SELECT * FROM employees WHERE id = ?').get(created.id);
    assert.equal(row.full_name, 'Mita Wulandari');
    assert.equal(row.entity_id, 'ENT-KPM');
    assert.equal(row.home_store_id, 'store_pendem');
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.created_by_role, 'ADMIN');
  } finally { sqlite.close(); }
});

test('satu username hanya boleh dipegang satu karyawan; setelah dilepas boleh dioper, riwayat lama tetap tersimpan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const mita = await createEmployee(env, token, 'PENDEM', { fullName: 'Mita Wulandari' });
    const dina = await createEmployee(env, token, 'PENDEM', { fullName: 'Dina Nuraini' });

    const linked = await call(env, `/api/admin/employees/${mita.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    });
    assert.equal(linked.status, 201);

    // Username yang sudah dipegang tidak ditawarkan lagi sebagai pilihan.
    const listBody = await (await call(env, '/api/admin/employees', { token, store: 'PENDEM' })).json();
    assert.ok(!listBody.linkableAccounts.some(account => account.accountId === 'cashier_pendem_pilot'));
    const mitaRow = listBody.employees.find(employee => employee.id === mita.id);
    assert.equal(mitaRow.links.length, 1);
    assert.equal(mitaRow.links[0].username, 'kasir_pendem');

    // Dan tidak bisa dirampas karyawan lain selagi masih aktif.
    const stolen = await call(env, `/api/admin/employees/${dina.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    });
    assert.equal(stolen.status, 409);
    assert.equal((await stolen.json()).code, 'ACCOUNT_ALREADY_HELD');

    // Lepas dari Mita, oper ke Dina.
    const linkId = mitaRow.links[0].id;
    const released = await call(env, `/api/admin/employee-links/${linkId}`, {
      token, store: 'PENDEM', method: 'DELETE', body: { reason: 'resign' }
    });
    assert.equal(released.status, 200);

    const relinked = await call(env, `/api/admin/employees/${dina.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    });
    assert.equal(relinked.status, 201);

    // Inti dari desain ini: periode lama Mita masih ada sebagai riwayat, bukan
    // ditimpa -- supaya gaji/setoran yang dulu tercatat di username itu tetap
    // bisa ditelusuri ke Mita, bukan pindah diam-diam ke Dina.
    const history = sqlite.prepare(`
      SELECT employee_id, effective_to, ended_reason FROM employee_account_links
      WHERE account_id = 'cashier_pendem_pilot' ORDER BY effective_from
    `).all();
    assert.equal(history.length, 2);
    assert.equal(history[0].employee_id, mita.id);
    assert.ok(history[0].effective_to, 'periode Mita ditutup, bukan dihapus');
    assert.equal(history[0].ended_reason, 'resign');
    assert.equal(history[1].employee_id, dina.id);
    assert.equal(history[1].effective_to, null);
  } finally { sqlite.close(); }
});

test('gerai lain satu entity bisa melihat dan menautkan karyawan itu ke username-nya sendiri, tapi tidak boleh mengubah datanya', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const pendemToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mandalaToken = await storeAdminToken(sqlite, 'admin_mandala_pilot');

    const mita = await createEmployee(env, pendemToken, 'PENDEM', { fullName: 'Mita Wulandari' });

    const mandalaList = await (await call(env, '/api/admin/employees', { token: mandalaToken, store: 'MANDALA' })).json();
    const seen = mandalaList.employees.find(employee => employee.id === mita.id);
    assert.ok(seen, 'gerai tetangga satu entity tetap melihat karyawan ini');
    assert.equal(seen.ownedByThisStore, false);
    assert.equal(seen.homeStoreCode, 'PENDEM', 'ada penanda ini rekrutan gerai mana');

    // Kasus CS backup: Mandala boleh menautkan Mita ke username Mandala.
    const backup = await call(env, `/api/admin/employees/${mita.id}/links`, {
      token: mandalaToken, store: 'MANDALA', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_mandala_pilot' }
    });
    assert.equal(backup.status, 201);

    // Tapi data dirinya tetap milik gerai perekrut.
    const edit = await call(env, `/api/admin/employees/${mita.id}`, {
      token: mandalaToken, store: 'MANDALA', method: 'PATCH', body: { fullName: 'Diganti Paksa' }
    });
    assert.equal(edit.status, 403);
    assert.equal((await edit.json()).code, 'EMPLOYEE_NOT_OWNED_BY_STORE');
  } finally { sqlite.close(); }
});

test('username milik gerai lain tidak bisa ditautkan dari gerai ini', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mita = await createEmployee(env, token, 'PENDEM', { fullName: 'Mita Wulandari' });

    const wrongStore = await call(env, `/api/admin/employees/${mita.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_mandala_pilot' }
    });
    assert.equal(wrongStore.status, 404);
    assert.equal((await wrongStore.json()).code, 'ACCOUNT_OUT_OF_SCOPE');
  } finally { sqlite.close(); }
});

test('karyawan yang masih memegang username tidak bisa dinonaktifkan', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const token = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const mita = await createEmployee(env, token, 'PENDEM', { fullName: 'Mita Wulandari' });
    await call(env, `/api/admin/employees/${mita.id}/links`, {
      token, store: 'PENDEM', method: 'POST',
      body: { accountType: 'CASHIER', accountId: 'cashier_pendem_pilot' }
    });

    const blocked = await call(env, `/api/admin/employees/${mita.id}`, { token, store: 'PENDEM', method: 'DELETE' });
    assert.equal(blocked.status, 409);
    assert.equal((await blocked.json()).code, 'EMPLOYEE_STILL_LINKED');
  } finally { sqlite.close(); }
});

test('karyawan tingkat Entity (tanpa gerai, mis. OB kantor) hanya boleh dibuat Owner/Entity Admin', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const owner = await ownerToken(sqlite);

    const byStoreAdmin = await createEmployee(env, adminToken, 'PENDEM', { fullName: 'OB Kantor', scope: 'ENTITY' });
    assert.equal(byStoreAdmin.status, 403);
    assert.equal(byStoreAdmin.code, 'ENTITY_LEVEL_FORBIDDEN');

    const byOwner = await createEmployee(env, owner, 'PENDEM', { fullName: 'OB Kantor', scope: 'ENTITY' });
    assert.equal(byOwner.status, 201);
    const row = sqlite.prepare('SELECT home_store_id, entity_id FROM employees WHERE id = ?').get(byOwner.id);
    assert.equal(row.home_store_id, null, 'karyawan entity tidak menempel gerai mana pun');
    assert.equal(row.entity_id, 'ENT-KPM');
  } finally { sqlite.close(); }
});

test('panel Karyawan terpasang di workspace Admin Gerai, bukan di kasir', () => {
  assert.match(branchAdminHtml, /admin-employees\.js/);
  assert.match(adminUi, /data-tab="employees"/);
  assert.match(adminUi, /\/api\/admin\/employees/);
  const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
  assert.doesNotMatch(cashierHtml, /admin-employees\.js/, 'entry karyawan bukan urusan layar kasir');
});
