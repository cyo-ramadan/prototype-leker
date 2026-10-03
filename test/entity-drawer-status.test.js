import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hashCredential } from '../src/owner-auth.js';

// Bos Cyo, 2026-10-03: tombol cek gerai mana yang lacinya sedang dibuka, status
// open/close + jam terkini, dan kasir yang membukanya. KANTOR/PENDEM/MANDALA satu entity.

const migrationDir = new URL('../migrations/', import.meta.url);
class D1Statement {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new D1Statement(this.db, this.sql, params); }
  first() { return this.db.prepare(this.sql).get(...this.params) ?? null; }
  all() { return { results: this.db.prepare(this.sql).all(...this.params) }; }
  run() { const r = this.db.prepare(this.sql).run(...this.params); return { success: true, meta: { changes: Number(r.changes || 0) } }; }
}
class D1Database {
  constructor(db) { this.db = db; }
  prepare(sql) { return new D1Statement(this.db, sql); }
  batch(statements) { return statements.map(s => s.run()); }
}
async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(n => /^\d{4}_.+\.sql$/.test(n)).sort()) db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  db.prepare(`INSERT INTO owner_accounts (id, username, password_hash, display_name) VALUES ('owner_drw', 'owner_drw', 'x', 'Owner')`).run();
  db.prepare(`INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at) VALUES (?, 'owner_drw', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('owner-drw'));
  db.prepare(`INSERT INTO store_admins (id, store_id, username, password_hash, display_name) VALUES ('adm_drw', 'store_pendem', 'adm_drw', 'x', 'Admin Pendem')`).run();
  db.prepare(`INSERT INTO store_admin_sessions (token_hash, admin_id, created_at, expires_at) VALUES (?, 'adm_drw', '2026-09-17T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`).run(await hashCredential('admin-drw'));
  const cashier = (id, name, store) => db.prepare(`INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at) VALUES (?, ?, 'x', ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(id, id, name, store);
  cashier('kasir_a', 'Rina CS', 'store_kantor'); cashier('kasir_b', 'Budi CS', 'store_kantor'); cashier('kasir_c', 'Sari CS', 'store_pendem');
  const drawer = (id, cashierId, store, status, openedAt, closedAt) => db.prepare(`INSERT INTO cash_drawer_sessions (id, store_id, cashier_id, opening_amount, status, opened_at, closed_at) VALUES (?, ?, ?, 0, ?, ?, ?)`).run(id, store, cashierId, status, openedAt, closedAt);
  drawer('d1', 'kasir_a', 'store_kantor', 'CLOSED', '2026-10-01T01:00:00.000Z', '2026-10-01T09:00:00.000Z'); // lama
  drawer('d2', 'kasir_b', 'store_kantor', 'OPEN', '2026-10-03T01:05:00.000Z', null);                       // KANTOR buka sekarang
  drawer('d3', 'kasir_c', 'store_pendem', 'CLOSED', '2026-10-02T01:00:00.000Z', '2026-10-02T10:30:00.000Z'); // PENDEM tutup
  return { db, d1: new D1Database(db) };
}
const call = (ctx, { token = 'owner-drw', store = 'KANTOR' } = {}) => {
  const url = new URL('https://example.test/api/admin/entity-drawer-status');
  if (store) url.searchParams.set('store', store);
  return worker.fetch(new Request(url, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { DB: ctx.d1 });
};

test('status laci: OPEN dengan jam buka dan kasir pembuka; CLOSED dengan jam tutup dan kasir terakhir; gerai tanpa laci = NEVER', async () => {
  const ctx = await setup();
  try {
    const res = await call(ctx);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scope, 'ENTITY');
    assert.equal(body.openCount, 1);
    const by = Object.fromEntries(body.stores.map(s => [s.code, s]));
    assert.deepEqual([by.KANTOR.status, by.KANTOR.since, by.KANTOR.openedBy], ['OPEN', '2026-10-03T01:05:00.000Z', 'Budi CS']);
    assert.deepEqual([by.PENDEM.status, by.PENDEM.since, by.PENDEM.lastOpenedBy], ['CLOSED', '2026-10-02T10:30:00.000Z', 'Sari CS']);
    assert.equal(by.MANDALA.status, 'NEVER');
    assert.ok(!('IKAN01' in by), 'gerai entity lain tidak ikut');
  } finally { ctx.db.close(); }
});

test('pagar akses: tanpa login 401; Admin Gerai hanya gerainya sendiri', async () => {
  const ctx = await setup();
  try {
    assert.equal((await call(ctx, { token: null })).status, 401);
    const own = await (await call(ctx, { token: 'admin-drw', store: 'PENDEM' })).json();
    assert.equal(own.scope, 'STORE');
    assert.deepEqual(own.stores.map(s => s.code), ['PENDEM']);
  } finally { ctx.db.close(); }
});

test('UI: tab Status Laci terpasang, masuk grup menu, tombol cek manual tanpa polling', () => {
  const html = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/entity-drawer-status.js', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../public/nav-groups.js', import.meta.url), 'utf8');
  assert.match(html, /data-entity-tab="drawerstatus"/);
  assert.match(html, /id="entityDrawerList"/);
  assert.match(html, /id="entityDrawerRefresh"/);
  assert.match(html, /entity-drawer-status\.js\?v=20261003-status-laci-v1/);
  assert.match(nav, /'stores', 'drawerstatus'/);
  assert.doesNotMatch(js, /setInterval/);
  assert.match(js, /openedBy/);
});
