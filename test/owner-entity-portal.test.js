import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleOwnerEntityApi } from '../src/owner-entity-approvals.js';
import { handleEntityAccountingApi } from '../src/entity-accounting.js';
import { handleOwnerApi, hashCredential } from '../src/owner-auth.js';
import { setTenantPolicySetting, UI_SKIN_KEY } from '../src/tenant-policy.js';

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
function request(path, token) {
  return new Request('https://example.test' + path, { headers: token ? { authorization: 'Bearer ' + token } : {} });
}

test('Owner portal and legacy Entity features share one H-only, entity-scoped context', async () => {
  const sql = migratedDatabase();
  try {
    const db = new D1Database(sql);
    const env = { DB: db };
    const row = sql.prepare(`
      SELECT s.entity_id, et.tenant_id
      FROM stores s
      JOIN entity_tenancy et ON et.entity_id = s.entity_id AND et.effective_to IS NULL
      WHERE s.code = 'G001'
    `).get();
    const token = 'owner-entity-portal-test';
    sql.prepare(`
      INSERT INTO owner_sessions (token_hash, owner_id, created_at, expires_at)
      VALUES (?, 'owner_primary', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
    `).run(await hashCredential(token));

    const contextPath = '/api/management/owner-entity/context?entity=' + encodeURIComponent(row.entity_id);
    assert.equal((await handleOwnerEntityApi(request(contextPath, token), env, '/api/management/owner-entity/context')).status, 403);

    await setTenantPolicySetting(db, row.tenant_id, UI_SKIN_KEY, 'H', { role: 'OWNER', id: 'owner_primary' });
    const ownerEntities = await handleOwnerApi(request('/api/owner/entities', token), env, '/api/owner/entities');
    assert.equal((await ownerEntities.json()).entities.find(entity => entity.id === row.entity_id).uiSkin, 'H');

    const contextResponse = await handleOwnerEntityApi(request(contextPath, token), env, '/api/management/owner-entity/context');
    assert.equal(contextResponse.status, 200, await contextResponse.clone().text());
    const context = await contextResponse.json();
    assert.equal(context.ownerMode, true);
    assert.equal(context.entityAdmin.entityId, row.entity_id);
    assert.ok(context.stores.length >= 1);
    assert.ok(context.stores.every(store => store.entityId === row.entity_id));

    const accountsPath = '/api/entity-admin/accounts?entity=' + encodeURIComponent(row.entity_id);
    const accounts = await handleEntityAccountingApi(request(accountsPath, token), env, '/api/entity-admin/accounts');
    assert.equal(accounts.status, 200, await accounts.clone().text());
    assert.ok(Array.isArray((await accounts.json()).accounts));

    const anchor = context.stores[0].code;
    const inboxPath = '/api/management/owner-entity/approvals?status=pending&store=' + encodeURIComponent(anchor);
    const inbox = await handleOwnerEntityApi(request(inboxPath, token), env, '/api/management/owner-entity/approvals');
    assert.equal(inbox.status, 200, await inbox.clone().text());
    const inboxBody = await inbox.json();
    assert.deepEqual(inboxBody.errors, []);
    assert.ok(inboxBody.items.every(item => context.stores.some(store => store.code === item.storeCode)));

    await setTenantPolicySetting(db, row.tenant_id, UI_SKIN_KEY, '0', { role: 'OWNER', id: 'owner_primary' });
    const resetEntities = await handleOwnerApi(request('/api/owner/entities', token), env, '/api/owner/entities');
    assert.equal((await resetEntities.json()).entities.find(entity => entity.id === row.entity_id).uiSkin, '0');
    assert.equal((await handleEntityAccountingApi(request(accountsPath, token), env, '/api/entity-admin/accounts')).status, 403);
    assert.equal((await handleOwnerEntityApi(request(contextPath, token), env, '/api/management/owner-entity/context')).status, 403);
  } finally {
    sql.close();
  }
});

test('Skin H is a standalone skin definition and does not inherit another skin', () => {
  const policy = readFileSync(new URL('../src/tenant-policy.js', import.meta.url), 'utf8');
  const generator = readFileSync(new URL('../scripts/generate-skin-css.py', import.meta.url), 'utf8');
  const hStart = generator.indexOf("SKINS['h'] = dict");
  const hEnd = generator.indexOf('import sys', hStart);
  const hDefinition = generator.slice(hStart, hEnd);

  assert.match(policy, /{ value: 'H', label: 'H · Owner Kelola Sendiri' }/);
  assert.ok(hStart >= 0 && hEnd > hStart);
  assert.equal(hDefinition.includes("**SKINS["), false);
  assert.ok(hDefinition.includes("background-image:url('/owner-beach-h-v1.png')"));
});

test('Skin H UI exposes the simple entity portal, Office cashier, and no legacy settings entry', () => {
  const owner = readFileSync(new URL('../public/owner.js', import.meta.url), 'utf8');
  const entity = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  const portal = readFileSync(new URL('../public/owner-entity-portal.js', import.meta.url), 'utf8');
  const office = readFileSync(new URL('../public/owner-office-cashier.js', import.meta.url), 'utf8');

  assert.match(owner, /entity\.uiSkin === 'H'/);
  assert.match(owner, /\/entity-admin\?entity=/);
  assert.match(entity, /owner-entity-approvals\.js/);
  assert.match(entity, /owner-office-cashier\.js/);
  assert.match(entity, /owner-entity-portal\.js/);
  assert.match(portal, /ADMIN · SELURUH GERAI/);
  assert.match(portal, /KASIR ANDA/);
  assert.match(portal, /\['customers','Pengaturan pelanggan'\]/);
  assert.doesNotMatch(portal, /\['settings','Akun & notifikasi'\]/);
  assert.match(office, /event\.origin!==ORIGIN/);
  assert.match(office, /ownerOfficeEmbed=1/);
});
