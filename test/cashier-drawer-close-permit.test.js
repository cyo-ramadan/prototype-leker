import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleDrawerClosePermitApi } from '../src/cashier-drawer-close-permit.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-09-19: "kasih tombol kasir bisa permit tutup laci kasir
// sebelumnya karna sudah waktu dia untuk jaga. nanti admin acc kan akhirnya
// di force close. dan kedepan model2 yang diijin2kan admin gini akan
// mempengaruhi penilaiaan kasir tersangkut" -- kasir gantian jaga (B)
// menemukan laci kasir sebelumnya (A) masih OPEN, mengajukan tutup paksa
// dengan hitungan fisiknya sendiri, Admin yang benar-benar meng-ACC/menutup.
// target_cashier_id disimpan permanen di baris permit (migration 0110) untuk
// jadi jejak penilaian A ke depan.

const migrationDir = new URL('../migrations/', import.meta.url);

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    return {
      _statement: statement,
      _args: [],
      async first() { return statement.get() || null; },
      async all() { return { results: statement.all() }; },
      async run() { const result = statement.run(); return { success: true, meta: { changes: result.changes } }; },
      bind(...args) {
        return {
          _statement: statement,
          _args: args,
          async first() { return statement.get(...args) || null; },
          async all() { return { results: statement.all(...args) }; },
          async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; }
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

async function seedCashier(sqlite, storeId, { id, username } = {}) {
  const cashierId = id || `cashier_${crypto.randomUUID()}`;
  const uname = username || cashierId;
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', ?, ?, 1)`)
    .run(cashierId, uname, uname, storeId);
  const token = `token-${cashierId}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), cashierId);
  sqlite.prepare(`
    INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status)
    VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', '2026-09-19T00:00:00.000Z', 'OPEN')
  `).run(`att_${cashierId}`, cashierId, storeId);
  return { token, cashierId };
}

async function storeAdminToken(sqlite, adminId) {
  const token = `admin-${adminId}`;
  sqlite.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, ?, '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), adminId);
  return token;
}

async function openDrawerAs(env, token, opts = {}) {
  const res = await handleCashierDrawerApi(request('/api/cashier/drawer/open', { token, method: 'POST', body: { openingAmount: opts.openingAmount ?? 0 } }), env, '/api/cashier/drawer/open');
  assert.equal(res.status, 201, 'prasyarat: laci berhasil dibuka');
  return (await res.json()).drawer;
}

const cashierCall = (env, pathname, options) => handleDrawerClosePermitApi(request(pathname, options), env, pathname);
const adminCall = (env, pathname, options) => handleDrawerClosePermitApi(request(pathname, options), env, pathname);

test('kasir B ajukan tutup laci A yang masih OPEN, Admin ACC benar-benar menutup laci A', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_permit' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_permit' });
    const drawerA = await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const submitRes = await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST',
      body: { closingAmount: 150000, depositAmount: 50000, closingNote: 'dihitung ulang', reason: 'sudah waktu shift saya' }
    });
    assert.equal(submitRes.status, 201);
    const submitted = await submitRes.json();
    assert.equal(submitted.permit.status, 'PENDING');
    assert.equal(submitted.permit.targetCashierId, cashierA.cashierId);
    assert.equal(submitted.permit.requestedByCashierId, cashierB.cashierId);

    const accRes = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'ACC' }
    });
    assert.equal(accRes.status, 200);
    const acc = await accRes.json();
    assert.equal(acc.permit.status, 'APPROVED');

    const closedDrawer = sqlite.prepare(`SELECT status, closing_amount, deposit_amount FROM cash_drawer_sessions WHERE id = ?`).get(drawerA.id);
    assert.equal(closedDrawer.status, 'CLOSED');
    assert.equal(closedDrawer.closing_amount, 150000);
    assert.equal(closedDrawer.deposit_amount, 50000);

    // B sekarang harus bisa buka laci barunya sendiri.
    const openB = await handleCashierDrawerApi(request('/api/cashier/drawer/open', { token: cashierB.token, method: 'POST', body: {} }), env, '/api/cashier/drawer/open');
    assert.equal(openB.status, 201);
    assert.equal((await openB.json()).drawer.cashierId, cashierB.cashierId);
  } finally {
    sqlite.close();
  }
});

test('setoran hasil force-close tetap atas nama kasir A (target), bukan kasir B (yang mengajukan)', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_deposit' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_deposit' });
    await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    // Tautkan A ke Master Karyawan supaya setoran punya penerima piutang.
    const entity = sqlite.prepare(`SELECT entity_id FROM stores WHERE id = ?`).get(store.id);
    sqlite.prepare(`INSERT INTO employees (id, entity_id, home_store_id, full_name, status) VALUES ('emp_a_deposit', ?, ?, 'Kasir A Deposit', 'ACTIVE')`).run(entity.entity_id, store.id);
    sqlite.prepare(`INSERT INTO employee_account_links (id, employee_id, entity_id, account_type, account_id, store_id, effective_from) VALUES ('link_a_deposit', 'emp_a_deposit', ?, 'CASHIER', ?, ?, '2026-09-19T00:00:00.000Z')`)
      .run(entity.entity_id, cashierA.cashierId, store.id);

    const submitted = await (await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST', body: { closingAmount: 200000, depositAmount: 120000 }
    })).json();

    const accRes = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'ACC' }
    });
    assert.equal(accRes.status, 200);
    const acc = await accRes.json();
    assert.ok(acc.employeeDeposit, 'setoran harus tercipta karena depositAmount > 0');

    const receivable = sqlite.prepare(`SELECT counterparty_id FROM operational_receivables_payables WHERE id = ?`).get(acc.employeeDeposit.id);
    assert.equal(receivable.counterparty_id, 'emp_a_deposit', 'piutang setoran atas nama A (pemegang laci), bukan B yang mengajukan');
  } finally {
    sqlite.close();
  }
});

test('Admin bisa Tolak -- laci tidak berubah, permit jadi REJECTED', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_reject' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_reject' });
    const drawerA = await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const submitted = await (await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST', body: { closingAmount: 90000 }
    })).json();

    const rejectRes = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'REJECT', note: 'Coba hubungi A dulu' }
    });
    assert.equal(rejectRes.status, 200);
    assert.equal((await rejectRes.json()).permit.status, 'REJECTED');

    const drawer = sqlite.prepare(`SELECT status FROM cash_drawer_sessions WHERE id = ?`).get(drawerA.id);
    assert.equal(drawer.status, 'OPEN', 'ditolak tidak boleh mengubah laci sama sekali');
  } finally {
    sqlite.close();
  }
});

// Bos Cyo, 2026-09-19: "ada cs yang ga bisa buka laci gara2 laci cs
// sebelumnya lupa ditutup ... kamu adjust ya harusnya bagaimana mekanisme
// ini" -- Admin yang SUDAH TAHU ada laci nyangkut bisa langsung menutupnya,
// tanpa nunggu kasir pengganti sempat mengajukan permit dulu.
test('Admin tutup laci langsung (tanpa pengajuan kasir lain) -- laci tertutup, permit tercatat APPROVED atas nama pemegang laci sendiri', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_direct' });
    const drawerA = await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const res = await adminCall(env, '/api/admin/drawer/close-permits/direct', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { drawerId: drawerA.id, closingAmount: 175000, note: 'Laci nyangkut dari kemarin' }
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.permit.status, 'APPROVED');
    assert.equal(body.permit.targetCashierId, cashierA.cashierId);
    assert.equal(body.permit.requestedByCashierId, cashierA.cashierId, 'tanpa kasir lain yang mengajukan, requested_by self-referential ke target');
    assert.equal(body.permit.reason, 'DITUTUP_LANGSUNG_ADMIN');

    const closedDrawer = sqlite.prepare(`SELECT status, closing_amount FROM cash_drawer_sessions WHERE id = ?`).get(drawerA.id);
    assert.equal(closedDrawer.status, 'CLOSED');
    assert.equal(closedDrawer.closing_amount, 175000);
  } finally {
    sqlite.close();
  }
});

test('Admin tutup laci langsung ditolak kalau sudah ada pengajuan kasir yang masih PENDING buat laci itu', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_direct_conflict' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_direct_conflict' });
    const drawerA = await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierB.token, method: 'POST', body: { closingAmount: 50000 } });

    const res = await adminCall(env, '/api/admin/drawer/close-permits/direct', {
      token: adminToken, store: 'PENDEM', method: 'POST',
      body: { drawerId: drawerA.id, closingAmount: 999 }
    });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'PERMIT_ALREADY_PENDING');

    const drawer = sqlite.prepare(`SELECT status FROM cash_drawer_sessions WHERE id = ?`).get(drawerA.id);
    assert.equal(drawer.status, 'OPEN', 'ditolak sebelum sempat mengubah apa pun');
  } finally {
    sqlite.close();
  }
});

test('Admin tutup laci langsung ditolak untuk laci gerai lain / yang sudah tidak OPEN', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const storePendem = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const storeMandala = sqlite.prepare(`SELECT id FROM stores WHERE code = 'MANDALA'`).get();
    const cashierMandala = await seedCashier(sqlite, storeMandala.id, { id: 'cashier_mandala_direct' });
    const drawerMandala = await openDrawerAs({ DB: db }, cashierMandala.token);
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const wrongStore = await adminCall(env, '/api/admin/drawer/close-permits/direct', {
      token: pendemAdminToken, store: 'PENDEM', method: 'POST',
      body: { drawerId: drawerMandala.id, closingAmount: 1000 }
    });
    assert.equal(wrongStore.status, 404);
    assert.equal((await wrongStore.json()).code, 'DRAWER_NOT_OPEN');
  } finally {
    sqlite.close();
  }
});

test('pengajuan ditolak: tidak ada laci OPEN, laci milik sendiri, belum presensi, dan sudah ada pending duplikat', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_guard' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_guard' });

    const noDrawer = await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierB.token, method: 'POST', body: { closingAmount: 1000 } });
    assert.equal(noDrawer.status, 409);
    assert.equal((await noDrawer.json()).code, 'DRAWER_NOT_OPEN');

    await openDrawerAs({ DB: db }, cashierA.token);

    const ownDrawer = await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierA.token, method: 'POST', body: { closingAmount: 1000 } });
    assert.equal(ownDrawer.status, 400);
    assert.equal((await ownDrawer.json()).code, 'DRAWER_OWNED_BY_SELF');

    // Kasir C belum presensi masuk sama sekali.
    sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES ('cashier_c_guard', 'cashier_c_guard', 'x', 'C', ?, 1)`).run(store.id);
    const tokenC = 'token-cashier_c_guard';
    sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'cashier_c_guard', '2026-09-19T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(tokenC));
    const noPresensi = await cashierCall(env, '/api/cashier/drawer/close-permits', { token: tokenC, method: 'POST', body: { closingAmount: 1000 } });
    assert.equal(noPresensi.status, 403);
    assert.equal((await noPresensi.json()).code, 'PRESENSI_REQUIRED');

    const first = await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierB.token, method: 'POST', body: { closingAmount: 1000 } });
    assert.equal(first.status, 201);
    const dupe = await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierB.token, method: 'POST', body: { closingAmount: 2000 } });
    assert.equal(dupe.status, 409);
    assert.equal((await dupe.json()).code, 'PERMIT_ALREADY_PENDING');
  } finally {
    sqlite.close();
  }
});

test('setoran tidak boleh lebih besar dari saldo akhir laci', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_invalid' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_invalid' });
    await openDrawerAs({ DB: db }, cashierA.token);

    const res = await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST', body: { closingAmount: 50000, depositAmount: 60000 }
    });
    assert.equal(res.status, 400);
  } finally {
    sqlite.close();
  }
});

test('ACC ditolak otomatis kalau laci sasaran ternyata sudah tidak OPEN lagi (mis. A sempat login sendiri dan tutup)', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const store = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const cashierA = await seedCashier(sqlite, store.id, { id: 'cashier_a_stale' });
    const cashierB = await seedCashier(sqlite, store.id, { id: 'cashier_b_stale' });
    const drawerA = await openDrawerAs({ DB: db }, cashierA.token);
    const adminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const submitted = await (await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST', body: { closingAmount: 100000 }
    })).json();

    // A ternyata sempat login sendiri dan menutup lacinya sebelum Admin sempat ACC.
    await handleCashierDrawerApi(request('/api/cashier/drawer/close', { token: cashierA.token, method: 'POST', body: { closingAmount: 100000, depositAmount: 0 } }), env, '/api/cashier/drawer/close');
    assert.equal(sqlite.prepare(`SELECT status FROM cash_drawer_sessions WHERE id = ?`).get(drawerA.id).status, 'CLOSED');

    const accRes = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: adminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'ACC' }
    });
    assert.equal(accRes.status, 409);
    assert.equal((await accRes.json()).code, 'DRAWER_ALREADY_CLOSED');
    assert.equal(sqlite.prepare(`SELECT status FROM drawer_close_permits WHERE id = ?`).get(submitted.permit.id).status, 'REJECTED');
  } finally {
    sqlite.close();
  }
});

test('permit gerai lain tidak bisa diputuskan Admin gerai ini, dan pengajuan yang sudah diputuskan tidak bisa diputuskan ulang', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const storePendem = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const storeMandala = sqlite.prepare(`SELECT id FROM stores WHERE code = 'MANDALA'`).get();
    const cashierA = await seedCashier(sqlite, storePendem.id, { id: 'cashier_a_scope' });
    const cashierB = await seedCashier(sqlite, storePendem.id, { id: 'cashier_b_scope' });
    await openDrawerAs({ DB: db }, cashierA.token);
    const mandalaAdminToken = await storeAdminToken(sqlite, 'admin_mandala_pilot');
    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');

    const submitted = await (await cashierCall(env, '/api/cashier/drawer/close-permits', {
      token: cashierB.token, method: 'POST', body: { closingAmount: 10000 }
    })).json();

    const wrongStore = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: mandalaAdminToken, store: 'MANDALA', method: 'PATCH', body: { decision: 'ACC' }
    });
    assert.equal(wrongStore.status, 403);
    assert.equal((await wrongStore.json()).code, 'PERMIT_STORE_SCOPE_MISMATCH');

    const firstDecision = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: pendemAdminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'ACC' }
    });
    assert.equal(firstDecision.status, 200);

    const secondDecision = await adminCall(env, `/api/admin/drawer/close-permits/${submitted.permit.id}`, {
      token: pendemAdminToken, store: 'PENDEM', method: 'PATCH', body: { decision: 'REJECT' }
    });
    assert.equal(secondDecision.status, 409);
  } finally {
    sqlite.close();
  }
});

test('Admin GET hanya melihat permit gerainya sendiri, default filter PENDING', async () => {
  const sqlite = freshDatabase();
  try {
    const db = d1(sqlite);
    const env = { DB: db };
    const storePendem = sqlite.prepare(`SELECT id FROM stores WHERE code = 'PENDEM'`).get();
    const storeMandala = sqlite.prepare(`SELECT id FROM stores WHERE code = 'MANDALA'`).get();
    const cashierAPendem = await seedCashier(sqlite, storePendem.id, { id: 'cashier_a_list_pendem' });
    const cashierBPendem = await seedCashier(sqlite, storePendem.id, { id: 'cashier_b_list_pendem' });
    const cashierAMandala = await seedCashier(sqlite, storeMandala.id, { id: 'cashier_a_list_mandala' });
    const cashierBMandala = await seedCashier(sqlite, storeMandala.id, { id: 'cashier_b_list_mandala' });
    await openDrawerAs({ DB: db }, cashierAPendem.token);
    await openDrawerAs({ DB: db }, cashierAMandala.token);
    await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierBPendem.token, method: 'POST', body: { closingAmount: 1000 } });
    await cashierCall(env, '/api/cashier/drawer/close-permits', { token: cashierBMandala.token, method: 'POST', body: { closingAmount: 2000 } });

    const pendemAdminToken = await storeAdminToken(sqlite, 'admin_pendem_pilot');
    const listRes = await adminCall(env, '/api/admin/drawer/close-permits', { token: pendemAdminToken, store: 'PENDEM' });
    const permits = (await listRes.json()).permits;
    assert.equal(permits.length, 1);
    assert.equal(permits[0].targetCashierId, cashierAPendem.cashierId);
  } finally {
    sqlite.close();
  }
});
