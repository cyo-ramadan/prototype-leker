import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCashierDrawerApi } from '../src/cashier-drawer.js';
import { handleWarungUntungApi } from '../src/warung-untung.js';
import { hashCredential } from '../src/owner-auth.js';
import { UI_SKIN_KEY, setTenantPolicySetting, isOwnerOperatedChoice } from '../src/tenant-policy.js';
import { resolveUiProfile } from '../src/ui-profile.js';

// Skin E "Jaga Sendiri" (Bos Cyo 2026-10-02: "yang kusus ga ada karyawan
// dibuat skin e") -- DESAIN-SKIN-E-JAGA-SENDIRI.md. Satu-satunya skin yang
// mengubah aturan server, jadi diuji ke DB sungguhan, bukan cuma teks sumber.

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

async function seedCashier(db, storeId, username) {
  const id = `cashier_test_${username}`;
  db.prepare(`
    INSERT INTO cashiers (id, username, password_hash, employee_name, store_id, is_active, created_at, updated_at)
    VALUES (?, ?, 'x', ?, ?, 1, '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')
  `).run(id, username, username, storeId);
  const token = `token-${username}`;
  db.prepare(`INSERT INTO cashier_sessions (token_hash, cashier_id, created_at, expires_at) VALUES (?, ?, '2026-10-02T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`)
    .run(await hashCredential(token), id);
  return { id, token };
}

function tenantOf(db, storeId) {
  return db.prepare(`
    SELECT et.tenant_id FROM stores s JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL WHERE s.id = ?
  `).get(storeId).tenant_id;
}

const req = (pathname, token, method = 'GET', body) => new Request(`https://example.test${pathname}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  body: body ? JSON.stringify(body) : undefined
});

test('skin E: pemilik buka warung tanpa absen; tenant lain tetap wajib absen', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const cashier = await seedCashier(db, 'store_001', 'busri');
    const open = () => handleCashierDrawerApi(req('/api/cashier/drawer/open', cashier.token, 'POST', { openingAmount: 50000 }), env, '/api/cashier/drawer/open');

    const blocked = await open();
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).code, 'PRESENSI_REQUIRED');

    await setTenantPolicySetting(env.DB, tenantOf(db, 'store_001'), UI_SKIN_KEY, 'E', { role: 'OWNER', id: 'test' });
    const opened = await open();
    assert.equal(opened.status, 201);
    assert.equal((await opened.json()).canWrite, true);
  } finally {
    db.close();
  }
});

test('skin E: tab Untung hanya untuk login kasir di tenant Jaga Sendiri', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const cashier = await seedCashier(db, 'store_001', 'busri2');
    const untung = () => handleWarungUntungApi(req('/api/cashier/warung/untung', cashier.token), env, '/api/cashier/warung/untung');

    const refused = await untung();
    assert.equal(refused.status, 403);
    assert.equal((await refused.json()).code, 'OWNER_OPERATED_ONLY');

    await setTenantPolicySetting(env.DB, tenantOf(db, 'store_001'), UI_SKIN_KEY, 'E', { role: 'OWNER', id: 'test' });
    const ok = await untung();
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.equal(payload.week.days.length, 7);
    assert.equal(typeof payload.today.netProfit, 'number');
    assert.ok(Array.isArray(payload.topProducts));

    const anonymous = await handleWarungUntungApi(req('/api/cashier/warung/untung', 'bukan-token'), env, '/api/cashier/warung/untung');
    assert.equal(anonymous.status, 401);
  } finally {
    db.close();
  }
});

test('skin E dipetakan ke data-skin "e"; hanya pilihan E yang dianggap jaga sendiri', async () => {
  for (const choice of ['0', 'A', 'B', 'C', 'D']) assert.equal(isOwnerOperatedChoice(choice), false);
  assert.equal(isOwnerOperatedChoice('E'), true);
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    await setTenantPolicySetting(env.DB, 'TEN-LAB-TAMPILAN', UI_SKIN_KEY, 'E', { role: 'OWNER', id: 'test' });
    assert.equal((await resolveUiProfile(env.DB, { storeCode: 'LAB01' })).skin, 'e');
  } finally {
    db.close();
  }
});

test('Mode Warung skin E: Buka/Tutup warung, tab Untung, dan palet pastel ada di halaman', () => {
  const html = readFileSync(new URL('../public/warung.html', import.meta.url), 'utf8');
  for (const id of ['wOpenBtn', 'wCloseSheet', 'wUntung', 'wTabs', 'wCloseShop']) assert.match(html, new RegExp(`id="${id}"`));
  const js = readFileSync(new URL('../public/warung.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/cashier\/warung\/untung/);
  assert.match(js, /ownerOperated/);
  const css = readFileSync(new URL('../public/warung.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-skin="e"\]/);
});

test('warung.html: setiap id unik (id ganda pernah membuat daftar "paling laku" menimpa bilah atas)', () => {
  const html = readFileSync(new URL('../public/warung.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  const dupes = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(dupes, []);
});
