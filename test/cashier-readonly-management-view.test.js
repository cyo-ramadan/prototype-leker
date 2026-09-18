import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// 2026-09-17, Bos Cyo: "harusnya liat persis banget halaman kasir, tapi
// dia ga bisa write, bukan bikin ui sendiri" -- correcting an earlier
// attempt that built a separate lightweight page. Owner/Admin Gerai/Entity
// Admin now open the REAL public/cashier.html via a new "Lihat Kasir
// (Read-only)" link (?readonly=1 explicit), authenticated with their own
// bearer token instead of a cashier session. canWrite is always forced
// false server-side for this path; the write endpoints (sales/purchases/
// expenses/drawer/production) are completely untouched and still only
// accept a genuine cashier_sessions token.

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
  const ownerId = 'owner_cashier_ro_test';
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES (?, 'owner_ro_test', 'x', 'Test Owner')`).run(ownerId);
  const token = 'owner-cashier-ro-token';
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, ownerId);
  return token;
}

async function seedCashierToken(db, { storeId = 'store_001', username = 'kasir_ro_test' } = {}) {
  const id = 'cashier_ro_test';
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', 'Kasir Asli', ?, 1, '2026-09-04T00:00:00.000Z', '2026-09-04T00:00:00.000Z')
  `).run(id, username, storeId);
  const token = `token-${username}`;
  const tokenHash = await hashCredential(token);
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-09-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, id);
  return { id, token };
}

function request(pathname, { token, store, method = 'GET' } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

test('Owner can read /api/cashier/me and /api/cashier/workspace read-only, without any cashier session', async () => {
  const db = migratedDatabase();
  try {
    const token = await seedOwnerToken(db);
    db.prepare(`INSERT INTO products (id, store_id, name, price, purchase_price, category, is_active, display_order) VALUES (90101, 'store_001', 'Es Teh RO', 5000, 0, 'Minuman', 1, 1)`).run();
    const env = { DB: new D1Database(db) };

    const meResponse = await worker.fetch(request('/api/cashier/me', { token, store: 'G001' }), env);
    assert.equal(meResponse.status, 200);
    const meBody = await meResponse.json();
    assert.equal(meBody.readOnly, true);
    assert.equal(meBody.attendanceStatus, 'in', 'presensi gate must be bypassed for a read-only viewer');
    assert.equal(meBody.cashier.store.code, 'G001');

    const workspaceResponse = await worker.fetch(request('/api/cashier/workspace', { token, store: 'G001' }), env);
    assert.equal(workspaceResponse.status, 200);
    const workspaceBody = await workspaceResponse.json();
    assert.equal(workspaceBody.readOnly, true);
    assert.equal(workspaceBody.canWrite, false);
    assert.ok(workspaceBody.products.some(p => p.name === 'Es Teh RO'));
  } finally {
    db.close();
  }
});

test('a real cashier session is completely unaffected -- still gets canWrite from its own drawer ownership, readOnly stays false', async () => {
  const db = migratedDatabase();
  try {
    const { id: cashierId, token } = await seedCashierToken(db);
    const env = { DB: new D1Database(db) };

    const meResponse = await worker.fetch(request('/api/cashier/me', { token }), env);
    assert.equal(meResponse.status, 200);
    const meBody = await meResponse.json();
    assert.equal(meBody.readOnly, false);
    assert.equal(meBody.cashier.id, cashierId);

    const workspaceResponse = await worker.fetch(request('/api/cashier/workspace', { token }), env);
    assert.equal(workspaceResponse.status, 200);
    const workspaceBody = await workspaceResponse.json();
    assert.equal(workspaceBody.readOnly, false);
    assert.equal(workspaceBody.canWrite, false, 'no drawer opened yet, so still false, but for a DIFFERENT reason than read-only');
  } finally {
    db.close();
  }
});

test('a store code outside an Entity Admin\'s own entity is rejected from the read-only cashier view too -- same scope pagar as the rest of Admin Gerai', async () => {
  const db = migratedDatabase();
  try {
    const id = 'entity_admin_cashier_ro_test';
    const passwordHash = await hashCredential('rahasia123');
    db.prepare(`INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active) VALUES (?, 'ENT-GALEH', 'entityadmin.cashierro', ?, 'Entity Admin Test', 1)`).run(id, passwordHash);
    const token = 'entity-admin-cashier-ro-token';
    const tokenHash = await hashCredential(token);
    db.prepare(`INSERT INTO entity_admin_sessions (token_hash, entity_admin_id, created_at, expires_at) VALUES (?, ?, '2026-08-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(tokenHash, id);
    const env = { DB: new D1Database(db) };

    const response = await worker.fetch(request('/api/cashier/me', { token, store: 'G001' }), env);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');
  } finally {
    db.close();
  }
});

test('the write-side cashier endpoints are completely untouched -- still gated exclusively by requireCashier', async () => {
  const [salesSource, purchaseSource, expenseSource, drawerSource] = await Promise.all([
    'src/cashier-sales-tracking.js', 'src/cashier-purchase.js', 'src/cashier-operational-expense.js', 'src/cashier-drawer.js'
  ].map(path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')));

  for (const [source, name] of [
    [salesSource, 'cashier-sales-tracking.js'],
    [purchaseSource, 'cashier-purchase.js'],
    [expenseSource, 'cashier-operational-expense.js']
  ]) {
    assert.match(source, /requireCashier\b/, `${name} must still gate writes with requireCashier`);
    assert.doesNotMatch(source, /requireManagement/, `${name} must not have gained a management bypass`);
  }
  assert.doesNotMatch(drawerSource, /requireManagement/, 'cashier-drawer.js must not have gained a management bypass');
});

test('staff-entry-guard.js only widens the /cashier gate for the explicit ?readonly=1 case -- bare /cashier stays exactly lekerCashierToken-only', async () => {
  const guard = await read('public/staff-entry-guard.js');
  assert.match(guard, /isReadOnlyPreview/);
  assert.match(guard, /readonly.*=== '1'/);
  // 2026-09-18: penyimpanannya pindah ke localStorage (sesi kasir tidak lagi
  // hilang saat tab ditutup); gerbangnya sendiri tidak dilonggarkan sedikit pun.
  assert.match(guard, /Boolean\(localStorage\.getItem\('lekerCashierToken'\)\)\s*\n\s*\|\|\s*\(isReadOnlyPreview/);
});

test('staff-auth-fetch.js and public/cashier.js only fall back to a management token when ?readonly=1 is present', async () => {
  const [fetchSource, cashierSource] = await Promise.all([
    read('public/staff-auth-fetch.js'), read('public/cashier.js')
  ]);
  assert.match(fetchSource, /isReadOnlyPreview/);
  assert.match(cashierSource, /readOnlyPreviewIntent/);
  for (const source of [fetchSource, cashierSource]) {
    assert.match(source, /lekerOwnerToken/);
    assert.match(source, /lekerEntityAdminToken/);
    assert.match(source, /lekerAdminToken/);
  }
});

test('the read-only link in branch-admin.html carries ?readonly=1 and triggers the same-tab handoff used elsewhere', async () => {
  const [html, branchOwnerAuth] = await Promise.all([
    read('public/branch-admin.html'), read('public/branch-owner-auth.js')
  ]);
  assert.match(html, /id="cashierReadOnlyLink"/);
  assert.match(html, /href="\/cashier\?readonly=1"/);
  assert.match(branchOwnerAuth, /cashierReadOnlyLink.*lekerPrepareStaffHandoff/s);
});

test('public/cashier-workspace.js exposes state.readOnly distinctly from state.canWrite', async () => {
  const source = await read('public/cashier-workspace.js');
  assert.match(source, /state\.readOnly = Boolean\(payload\.readOnly\)/);
});

test('openDrawerBtn (no drawer open) is disabled by state.readOnly, not state.canWrite -- a real cashier who has not opened a drawer yet is also canWrite=false and must stay able to click it', async () => {
  const source = await read('public/cashier.js');
  assert.match(source, /el\('openDrawerBtn'\)\.disabled = Boolean\(state\.readOnly\)/);
});

