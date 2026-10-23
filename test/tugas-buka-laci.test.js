import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleTugasBukaLaciApi } from '../src/tugas-buka-laci.js';
import { handleStaffDailyTaskApi } from '../src/staff-daily-task.js';
import { buildDrawerReport } from '../src/drawer-report.js';
import { hashCredential } from '../src/owner-auth.js';
import { resolveTenantId, setTenantPolicySetting, TUGAS_BUKA_LACI_KEY, usesTugasBukaLaciSkin } from '../src/tenant-policy.js';

// Bos Cyo, 2026-10-23: "setiap cs mau buka laci maka dia wajib stok opname ... ditambah lagi cek
// uang laci saat itu juga sama aset, untuk saat ini asetnya cuma appron." Keputusan: laci dibuka
// dulu, Tugas Buka Laci wajib, transaksi ditahan sampai selesai; saklar tenant bawaan aktif.

const migrationDir = new URL('../migrations/', import.meta.url);
const STORE = 'store_001';

function d1(sqlite) {
  function prepared(sql) {
    const statement = sqlite.prepare(sql);
    const bound = args => ({
      _statement: statement,
      _args: args,
      async first() { return statement.get(...args) || null; },
      async all() { return { results: statement.all(...args) }; },
      async run() { const result = statement.run(...args); return { success: true, meta: { changes: result.changes } }; }
    });
    return { ...bound([]), bind: (...args) => bound(args) };
  }
  return {
    prepare: prepared,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(item => {
          const result = item._statement.run(...item._args);
          return { success: true, meta: { changes: result.changes } };
        });
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

function request(pathname, { token, method = 'GET', body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function seedCashier(sqlite, username = 'kasir_tbl') {
  const id = `cashier_${username}`;
  sqlite.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active) VALUES (?, ?, 'x', 'Kasir Tugas', ?, 1)`).run(id, username, STORE);
  const token = `token-${username}`;
  sqlite.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-10-23T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token), id);
  sqlite.prepare(`INSERT INTO staff_attendance (id, user_id, store_id, attendance_type, photo_blob, photo_type, created_at, status) VALUES (?, ?, ?, 'in', x'00', 'image/jpeg', '2026-10-23T00:00:00.000Z', 'OPEN')`).run(`att_${id}`, id, STORE);
  return { id, token };
}

// Dua bahan + satu barang jadi ber-stok; barang jadi tidak boleh masuk daftar opname.
function seedProducts(sqlite) {
  const products = sqlite.prepare('SELECT id FROM products WHERE store_id = ? AND base_unit_id IS NOT NULL ORDER BY id LIMIT 3').all(STORE);
  assert.equal(products.length, 3, 'fixture store must have three trackable products');
  sqlite.prepare('UPDATE products SET is_active = 0 WHERE store_id = ?').run(STORE);
  const [bahan, setengah, jadi] = products.map(row => Number(row.id));
  const type = code => sqlite.prepare('SELECT id FROM item_types WHERE store_id = ? AND code = ?').get(STORE, code).id;
  for (const [productId, code, qty] of [[bahan, 'RAW_MATERIAL', 10], [setengah, 'SEMI_FINISHED', 20], [jadi, 'FINISHED_GOOD', 5]]) {
    sqlite.prepare('UPDATE products SET is_active = 1, stock_tracking_enabled = 1, average_cost = 1000000, item_type_id = ? WHERE store_id = ? AND id = ?').run(type(code), STORE, productId);
    sqlite.prepare('INSERT OR REPLACE INTO inventory_stock_balances (store_id, product_id, quantity, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(STORE, productId, qty);
  }
  return { bahan, setengah, jadi };
}

async function openDrawer(env, cashier, openingAmount = 100000) {
  const response = await handleCashierDrawerApi(request('/api/cashier/drawer/open', { token: cashier.token, method: 'POST', body: { openingAmount } }), env, '/api/cashier/drawer/open');
  assert.equal(response.status, 201);
  return (await response.json()).drawer;
}

const tugas = (env, cashier, part, body) => handleTugasBukaLaciApi(
  request(`/api/cashier/drawer/opening-check${part ? `/${part}` : ''}`, { token: cashier.token, method: part ? 'POST' : 'GET', body }),
  env, `/api/cashier/drawer/opening-check${part ? `/${part}` : ''}`
);
const otherIncome = (env, cashier) => handleCashierDrawerApi(
  request('/api/cashier/other-income', { token: cashier.token, method: 'POST', body: {} }), env, '/api/cashier/other-income'
);

test('buka laci membuat Tugas Buka Laci PENDING dan transaksi laci ditahan sampai tiga bagian selesai', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const ids = seedProducts(sqlite);
    const cashier = await seedCashier(sqlite);
    const drawer = await openDrawer(env, cashier);
    assert.equal(drawer.openingCheckStatus, 'PENDING');

    const blocked = await otherIncome(env, cashier);
    assert.equal(blocked.status, 423);
    assert.equal((await blocked.json()).code, 'OPENING_CHECK_REQUIRED');

    const state = await (await tugas(env, cashier)).json();
    assert.equal(state.required, true);
    assert.deepEqual(state.stockItems.map(item => item.productId).sort(), [ids.bahan, ids.setengah].sort(), 'hanya Bahan + Bahan Setengah Jadi');
    assert.deepEqual(state.assets.map(item => item.name), ['Apron']);

    const incomplete = await tugas(env, cashier, 'stock', { items: [{ productId: ids.bahan, quantity: 8 }] });
    assert.equal(incomplete.status, 400);
    assert.equal((await incomplete.json()).code, 'OPENING_STOCK_INCOMPLETE');

    const stock = await tugas(env, cashier, 'stock', { items: [{ productId: ids.bahan, quantity: 8 }, { productId: ids.setengah, quantity: 20 }] });
    assert.equal(stock.status, 200);
    const stockBody = await stock.json();
    assert.equal(stockBody.diffCount, 1);
    assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock_balances WHERE store_id = ? AND product_id = ?').get(STORE, ids.bahan).quantity, 8, 'selisih langsung jadi Penyesuaian Stok');
    assert.equal((await tugas(env, cashier, 'stock', { items: [] })).status, 409, 'stok opname tidak bisa diulang');
    assert.equal((await otherIncome(env, cashier)).status, 423, 'masih ditahan sebelum uang & aset');

    const cash = await (await tugas(env, cashier, 'cash', { countedAmount: 90000 })).json();
    assert.deepEqual([cash.systemAmount, cash.countedAmount, cash.difference], [100000, 90000, -10000]);
    assert.equal(sqlite.prepare("SELECT opening_amount FROM cash_drawer_sessions WHERE id = ?").get(drawer.id).opening_amount, 100000, 'saldo awal tetap dari sistem');
    assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM management_notifications WHERE kind = 'TUGAS_BUKA_LACI_UANG'").get().n > 0, 'admin dikabari selisih uang');

    const assetId = state.assets[0].id;
    const assets = await (await tugas(env, cashier, 'assets', { items: [{ id: assetId, present: false, note: 'dicuci' }] })).json();
    assert.deepEqual(assets.missing, ['Apron']);
    assert.ok(sqlite.prepare("SELECT COUNT(*) AS n FROM management_notifications WHERE kind = 'TUGAS_BUKA_LACI_ASET'").get().n > 0, 'admin dikabari aset tidak ada');

    assert.equal(sqlite.prepare('SELECT opening_check_status FROM cash_drawer_sessions WHERE id = ?').get(drawer.id).opening_check_status, 'DONE');
    assert.notEqual((await otherIncome(env, cashier)).status, 423, 'laci dilepas sesudah tugas selesai');

    const report = await buildDrawerReport(env.DB, STORE, drawer.id);
    assert.equal(report.openingCheck.cash.difference, -10000);
    assert.equal(report.openingCheck.assets.missingCount, 1);
    assert.equal(report.openingCheck.stock.lines[0].difference, -2);
  } finally {
    sqlite.close();
  }
});

test('saklar tenant mati = laci langsung bisa dipakai seperti sebelumnya', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    const store = sqlite.prepare('SELECT entity_id FROM stores WHERE id = ?').get(STORE);
    const tenantId = await resolveTenantId(env.DB, store.entity_id);
    assert.ok(tenantId, 'fixture store must belong to a tenant');
    await setTenantPolicySetting(env.DB, tenantId, TUGAS_BUKA_LACI_KEY, false);
    const cashier = await seedCashier(sqlite, 'kasir_tbl_off');
    const drawer = await openDrawer(env, cashier);
    assert.equal(drawer.openingCheckStatus, '');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM drawer_opening_checks').get().n, 0);
    assert.notEqual((await otherIncome(env, cashier)).status, 423);
    assert.equal((await (await tugas(env, cashier)).json()).required, false);
  } finally {
    sqlite.close();
  }
});

test('skin dengan layar sendiri (Warung, Jaga Sendiri, Racik, Percetakan) tidak ditahan', () => {
  for (const skin of ['0', 'A', 'B', 'C', 'H', 'I']) assert.equal(usesTugasBukaLaciSkin(skin), true, skin);
  for (const skin of ['D', 'E', 'F', 'G']) assert.equal(usesTugasBukaLaciSkin(skin), false, skin);
});

test('aset Apron terisi untuk gerai lama, tidak ikut checklist Daily Task, dan Tugas Buka Laci tampil di Daily Task', async () => {
  const sqlite = freshDatabase();
  try {
    const env = { DB: d1(sqlite) };
    assert.equal(sqlite.prepare("SELECT title FROM daily_task_templates WHERE store_id = ? AND kind = 'ASSET'").get(STORE).title, 'Apron');
    seedProducts(sqlite);
    const cashier = await seedCashier(sqlite, 'kasir_tbl_daily');
    await openDrawer(env, cashier);
    const response = await handleStaffDailyTaskApi(request('/api/staff/daily-tasks', { token: cashier.token }), env, '/api/staff/daily-tasks');
    const body = await response.json();
    assert.equal(body.tasks.some(task => task.title === 'Apron'), false, 'aset tidak tampil sebagai tugas biasa');
    assert.equal(body.openingCheck.drawerOpen, true);
    assert.equal(body.openingCheck.completedAt, null);
  } finally {
    sqlite.close();
  }
});

test('UI: kasir memuat wizard, Portal Staf menautkan ke kasir, admin bisa memilih jenis Aset', () => {
  const cashierHtml = readFileSync(new URL('../public/cashier.html', import.meta.url), 'utf8');
  const wizard = readFileSync(new URL('../public/cashier-tugas-buka-laci.js', import.meta.url), 'utf8');
  const staffJs = readFileSync(new URL('../public/staff.js', import.meta.url), 'utf8');
  const adminJs = readFileSync(new URL('../public/admin-daily-task.js', import.meta.url), 'utf8');
  assert.match(cashierHtml, /cashier-tugas-buka-laci\.js\?v=/);
  assert.match(wizard, /\/api\/cashier\/drawer\/opening-check\/stock/);
  assert.match(wizard, /cashier:workspace-applied/);
  assert.match(staffJs, /\/cashier#tugas-buka-laci/);
  assert.match(adminJs, /value="ASSET"/);
});
