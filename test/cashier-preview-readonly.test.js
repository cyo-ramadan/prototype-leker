import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker, { assetRoute } from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// 2026-09-17, Bos Cyo: "kalo mau liat kasir harus login kasir dulu ya...
// ini ditambahin juga ya biar bisa liat halaman kasir (read only) aja" --
// Owner/Admin Gerai/Entity Admin sekarang bisa membaca menu + status laci
// satu gerai lewat GET /api/admin/cashier-preview (src/admin-multistore.js),
// TANPA pernah login sebagai kasir sungguhan dan TANPA mendapat akses tulis
// apa pun ke endpoint kasir yang sudah ada.

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
  const ownerId = 'owner_cashier_preview_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_cp_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-cashier-preview-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

async function seedEntityAdminToken(db, { entityId = 'ENT-GALEH', username = 'entityadmin.cashierpreview' } = {}) {
  const id = 'entity_admin_cashier_preview_test';
  const passwordHash = await hashCredential('rahasia123');
  db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES (?, ?, ?, ?, 'Entity Admin Test', 1)`).run(id, entityId, username, passwordHash);
  const token = `entity-admin-cashier-preview-token-${entityId}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, id);
  return token;
}

function seedProduct(db, storeId, { id, name, price, category = 'Minuman' }) {
  db.prepare(`
    INSERT INTO products (id, store_id, name, price, purchase_price, category, is_active, display_order)
    VALUES (?, ?, ?, ?, 0, ?, 1, 1)
  `).run(id, storeId, name, price, category);
}

function request(pathname, { token, store, method = 'GET' } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test('assetRoute maps /s/:code/cashier-preview to the canonical extensionless page', () => {
  assert.equal(assetRoute('/s/G001/cashier-preview'), '/cashier-preview');
  assert.equal(assetRoute('/s/DERMO/cashier-preview'), '/cashier-preview');
});

test('Owner can read cashier-preview for any store without a cashier session', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    seedProduct(db, 'store_001', { id: 90001, name: 'Es Teh Preview', price: 5000 });
    const env = { DB: new D1Database(db) };

    const response = await worker.fetch(request('/api/admin/cashier-preview', { token, store: 'G001' }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.store.code, 'G001');
    assert.ok(body.products.some(p => p.name === 'Es Teh Preview'));
    assert.equal(body.drawer, null, 'no drawer open yet');
  } finally {
    db.close();
  }
});

test('Entity Admin can read cashier-preview for a store under its own entity', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedEntityAdminToken(db);
    seedProduct(db, 'store_ikan01', { id: 90002, name: 'Ikan Preview', price: 15000 });
    const env = { DB: new D1Database(db) };

    const response = await worker.fetch(request('/api/admin/cashier-preview', { token, store: 'IKAN01' }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.products.some(p => p.name === 'Ikan Preview'));
  } finally {
    db.close();
  }
});

test('Entity Admin is rejected from cashier-preview for a store outside its own entity -- same scope pagar as the rest of Admin Gerai', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedEntityAdminToken(db);
    const env = { DB: new D1Database(db) };

    const response = await worker.fetch(request('/api/admin/cashier-preview', { token, store: 'G001' }), env);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');
  } finally {
    db.close();
  }
});

test('cashier-preview is unreachable without any valid management or cashier credential', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const response = await worker.fetch(request('/api/admin/cashier-preview', { store: 'G001' }), env);
    assert.equal(response.status, 401);
  } finally {
    db.close();
  }
});

test('the write-side cashier endpoints are untouched by this feature -- still gated exclusively by requireCashier', async () => {
  const [salesSource, purchaseSource, expenseSource, drawerSource] = await Promise.all([
    'src/cashier-sales-tracking.js', 'src/cashier-purchase.js', 'src/cashier-operational-expense.js', 'src/cashier-drawer.js'
  ].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')));

  for (const [source, name] of [
    [salesSource, 'cashier-sales-tracking.js'],
    [purchaseSource, 'cashier-purchase.js'],
    [expenseSource, 'cashier-operational-expense.js']
  ]) {
    assert.match(source, /requireCashier/, `${name} must still gate writes with requireCashier`);
    assert.doesNotMatch(source, /requireManagement/, `${name} must not have gained a management bypass`);
  }
  assert.match(drawerSource, /requireDrawerOwner|requireCashier/, 'cashier-drawer.js must still gate on the real cashier/drawer owner');
  assert.doesNotMatch(drawerSource, /requireManagement/, 'cashier-drawer.js must not have gained a management bypass');
});

test('admin-multistore.js cashier-preview route never creates a cashier session or touches cashier_sessions', async () => {
  const source = readFileSync(new URL('../src/admin-multistore.js', import.meta.url), 'utf8');
  assert.match(source, /\/api\/admin\/cashier-preview/);
  assert.doesNotMatch(source, /cashier_sessions/);
  assert.doesNotMatch(source, /requireCashier/);
});

test('staff-entry-guard.js gates cashier-preview behind a management token, and branch-admin.html links to it', async () => {
  const [guard, html] = await Promise.all([
    readFileSync(new URL('../public/staff-entry-guard.js', import.meta.url), 'utf8'),
    readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8')
  ]);
  assert.match(guard, /isCashierPreview/);
  assert.match(html, /data-store-page="cashier-preview"/);
});
