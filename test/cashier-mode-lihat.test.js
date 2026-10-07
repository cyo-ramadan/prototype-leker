import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-05: "ketika diposisi admin atau entity admin kemudian buka halaman kasir, biarkan
// bisa mengakses semua fungsional kasir/cs (biar admin tau apa saja yang bisa dilakukan cs dan memberi
// arahan ketika ada masalah) tapi selalu ditolak apabila entry data dan edit data di halaman cs.
// misalkan dia masukin barang penjualan bisa. tapi ketika klik masukkan transaksi ditolak."
//
// Baca: token manajemen boleh GET semua route baca kasir. Tulis: setiap route tulis /api/cashier/*
// dijawab 403 CASHIER_READ_ONLY_MODE dan TIDAK ada baris yang bertambah.

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
  batch(statements) { return statements.map(statement => statement.run()); }
}
function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}
async function seedOwnerToken(db) {
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_lihat', 'owner_lihat', 'x', 'Bos Lihat')`).run();
  const token = 'owner-lihat-token';
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_lihat', '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token));
  return token;
}
async function seedCashierToken(db) {
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES ('cashier_lihat', 'kasir_lihat', 'x', 'Kasir Asli', 'store_001', 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
  `).run();
  const token = 'token-kasir-lihat';
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, 'cashier_lihat', '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential(token));
  return token;
}
function call(pathname, { token, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  url.searchParams.set('store', 'G001');
  return new Request(url, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
}

// Semua route tulis /api/cashier/* yang tertulis di src (kecuali login/logout), dibaca dari kode
// supaya route tulis baru otomatis ikut diuji.
function writeRoutesInSource() {
  const routes = new Map();
  const files = readdirSync(new URL('../src/', import.meta.url)).filter(name => name.endsWith('.js'));
  for (const file of files) {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    for (const line of source.split('\n')) {
      const method = line.match(/method\s*===\s*'(POST|PATCH|PUT|DELETE)'/)?.[1]
        || (line.match(/method\s*!==\s*'(POST|PATCH|PUT|DELETE)'/)?.[1]);
      const path = line.match(/pathname\s*(?:===|!==)\s*'(\/api\/cashier\/[^']+)'/)?.[1];
      if (method && path && !/^\/api\/cashier\/(login|logout)$/.test(path)) routes.set(`${method} ${path}`, { method, path });
    }
  }
  // Route dengan parameter di path (regex), tidak terbaca pola di atas.
  routes.set('PATCH /api/cashier/orders/x/status', { method: 'PATCH', path: '/api/cashier/orders/x/status' });
  routes.set('POST /api/cashier/reset', { method: 'POST', path: '/api/cashier/reset' });
  return [...routes.values()];
}

const TABEL_DIPANTAU = ['sales', 'sale_items', 'purchases', 'purchase_items', 'expenses', 'cash_drawer_sessions', 'stock_movements',
  'production_runs', 'approval_requests', 'drawer_close_permits', 'inventory_stock_balances'];
function counts(db) {
  const out = {};
  for (const table of TABEL_DIPANTAU) {
    try { out[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } catch { out[table] = -1; }
  }
  return out;
}

test('setiap route TULIS /api/cashier/* ditolak 403 CASHIER_READ_ONLY_MODE untuk Owner dan tidak ada baris yang bertambah', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    const routes = writeRoutesInSource();
    assert.ok(routes.length >= 10, `inventaris route tulis terlalu sedikit (${routes.length}) -- pola pembacaan rusak?`);
    assert.ok(routes.some(r => r.path === '/api/cashier/sales') && routes.some(r => r.path === '/api/cashier/purchases'));
    const before = counts(db);
    for (const { method, path } of routes) {
      const response = await worker.fetch(call(path, { token, method, body: { items: [{ productId: 1, quantity: 1 }], openingAmount: 1000, totalAmount: 1000 } }), env);
      assert.equal(response.status, 403, `${method} ${path} harus 403 di Mode Lihat, dapat ${response.status}`);
      const body = await response.json();
      assert.equal(body.code, 'CASHIER_READ_ONLY_MODE', `${method} ${path}`);
      assert.match(body.error, /^Mode Lihat: Anda masuk sebagai Owner, bukan kasir\. Data tidak disimpan\.$/);
    }
    assert.deepEqual(counts(db), before, 'tidak boleh ada baris yang bertambah/berubah dari Mode Lihat');
  } finally {
    db.close();
  }
});

test('Owner boleh MEMBACA layar kasir (menu, laci, pesanan, pemasok, pencarian pelanggan) -- tidak lagi 401', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    const env = { DB: new D1Database(db) };
    for (const path of ['/api/cashier/me', '/api/cashier/workspace', '/api/cashier/drawer', '/api/cashier/orders', '/api/cashier/suppliers', '/api/cashier/customers/search?q=a']) {
      const response = await worker.fetch(call(path, { token }), env);
      assert.notEqual(response.status, 401, `${path} harus bisa dibaca oleh Mode Lihat`);
      assert.notEqual(response.status, 403, `${path}`);
      assert.ok(response.status < 500, `${path} status ${response.status}`);
    }
    const workspace = await (await worker.fetch(call('/api/cashier/workspace', { token }), env)).json();
    assert.equal(workspace.readOnly, true);
    assert.equal(workspace.canWrite, false, 'server tetap canWrite=false; tampilan yang menganggap boleh coba');
  } finally {
    db.close();
  }
});

test('kasir sungguhan tidak terpengaruh: tulis tidak pernah dijawab CASHIER_READ_ONLY_MODE, dan readOnly tetap false', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedCashierToken(db);
    const env = { DB: new D1Database(db) };
    const me = await (await worker.fetch(call('/api/cashier/me', { token }), env)).json();
    assert.equal(me.readOnly, false);
    const response = await worker.fetch(call('/api/cashier/sales', { token, method: 'POST', body: { items: [] } }), env);
    const body = await response.json().catch(() => ({}));
    assert.notEqual(body.code, 'CASHIER_READ_ONLY_MODE');
    assert.notEqual(response.status, 401);
  } finally {
    db.close();
  }
});

test('tanpa token apa pun: tulis tetap 401 login kasir (bukan Mode Lihat), baca tetap 401', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const write = await worker.fetch(call('/api/cashier/sales', { method: 'POST', body: { items: [] } }), env);
    assert.equal(write.status, 401);
    assert.notEqual((await write.json()).code, 'CASHIER_READ_ONLY_MODE');
    assert.equal((await worker.fetch(call('/api/cashier/menu'), env)).status, 401);
  } finally {
    db.close();
  }
});

test('tampilan Mode Lihat: tombol tidak dimatikan di tengah alur, tulisan jelas, versi script dibump', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const workspace = read('public/cashier-workspace.js');
  assert.match(workspace, /state\.canWrite = Boolean\(payload\.canWrite\) \|\| state\.readOnly/);
  const cashier = read('public/cashier.js');
  assert.match(cashier, /el\('openDrawerBtn'\)\.disabled = false;/);
  assert.match(cashier, /MODE LIHAT/);
  assert.doesNotMatch(cashier, /disabled = Boolean\(state\.readOnly\)/);
  const html = read('public/cashier.html');
  assert.match(html, /cashier\.js\?v=20261006-mode-lihat-kembali-v1/);
  assert.match(html, /cashier-workspace\.js\?v=20261006-mode-lihat-kembali-v2/);
});
