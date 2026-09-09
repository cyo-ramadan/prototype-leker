import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleCustomerMembershipApi } from '../src/customer-membership.js';
import { handleEntityAdminApi, handleStoreAdminApi, hashCredential } from '../src/owner-auth.js';

const migrationDir = new URL('../migrations/', import.meta.url);

class D1Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
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

function request(pathname, { store, token, method = 'GET', body } = {}) {
  const url = new URL(`https://example.test${pathname}`);
  if (store) url.searchParams.set('store', store);
  return new Request(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function seedStoreAdmin(db, storeCode = 'IKAN01') {
  const store = db.prepare('SELECT id, entity_id FROM stores WHERE code = ?').get(storeCode);
  assert.ok(store?.id, `Store ${storeCode} wajib tersedia`);
  assert.ok(store?.entity_id, `Store ${storeCode} wajib memiliki Entity`);
  const username = `wa.admin.${storeCode.toLowerCase()}`;
  const password = 'waadmin123';
  const id = `store_admin_wa_${storeCode.toLowerCase()}`;
  db.prepare(`
    INSERT INTO store_admins (id, store_id, username, password_hash, display_name, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(id, store.id, username, await hashCredential(password), `WA Admin ${storeCode}`);
  return { id, storeCode, entityId: store.entity_id, username, password };
}

async function loginStoreAdmin(env, seed) {
  const pathname = '/api/store-admin/login';
  const response = await handleStoreAdminApi(request(pathname, {
    method: 'POST',
    body: { username: seed.username, password: seed.password }
  }), env, pathname);
  assert.equal(response.status, 200);
  return (await response.json()).token;
}

async function seedAndLoginEntityAdmin(db, env, entityId) {
  const id = `entity_admin_wa_${entityId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
  const username = `${id}.login`;
  const password = 'entitywa123';
  db.prepare(`
    INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
    VALUES (?, ?, ?, ?, 'Entity WA Admin', 1)
  `).run(id, entityId, username, await hashCredential(password));
  const pathname = '/api/entity-admin/login';
  const response = await handleEntityAdminApi(request(pathname, {
    method: 'POST',
    body: { username, password }
  }), env, pathname);
  assert.equal(response.status, 200);
  return { id, token: (await response.json()).token };
}

test('Store Admin and Entity Admin edit the same Store WhatsApp membership setting', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const storeAdmin = await seedStoreAdmin(db);
    const storeToken = await loginStoreAdmin(env, storeAdmin);
    const pathname = '/api/admin/customer-membership-settings';

    const storeSave = await handleCustomerMembershipApi(request(pathname, {
      store: storeAdmin.storeCode,
      token: storeToken,
      method: 'PATCH',
      body: { registrationWhatsAppNumber: '0812-3456-7890' }
    }), env, pathname);
    assert.equal(storeSave.status, 200);
    const storePayload = await storeSave.json();
    assert.equal(storePayload.settings.registrationWhatsAppNumber, '6281234567890');
    assert.equal(storePayload.settings.updatedByRole, 'ADMIN');
    assert.equal(storePayload.settings.updatedById, storeAdmin.id);

    const entityAdmin = await seedAndLoginEntityAdmin(db, env, storeAdmin.entityId);
    const entityRead = await handleCustomerMembershipApi(request(pathname, {
      store: storeAdmin.storeCode,
      token: entityAdmin.token
    }), env, pathname);
    assert.equal(entityRead.status, 200);
    assert.equal((await entityRead.json()).settings.registrationWhatsAppNumber, '6281234567890');

    const entitySave = await handleCustomerMembershipApi(request(pathname, {
      store: storeAdmin.storeCode,
      token: entityAdmin.token,
      method: 'PATCH',
      body: { registrationWhatsAppNumber: '+62 811 2222 3333' }
    }), env, pathname);
    assert.equal(entitySave.status, 200);
    const entityPayload = await entitySave.json();
    assert.equal(entityPayload.settings.registrationWhatsAppNumber, '6281122223333');
    assert.equal(entityPayload.settings.updatedByRole, 'ENTITY_ADMIN');
    assert.equal(entityPayload.settings.updatedById, entityAdmin.id);

    const storeRead = await handleCustomerMembershipApi(request(pathname, {
      store: storeAdmin.storeCode,
      token: storeToken
    }), env, pathname);
    assert.equal((await storeRead.json()).settings.registrationWhatsAppNumber, '6281122223333');
  } finally {
    db.close();
  }
});

test('Entity Admin cannot edit WhatsApp setting outside its Entity', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const storeAdmin = await seedStoreAdmin(db, 'IKAN01');
    const entityAdmin = await seedAndLoginEntityAdmin(db, env, storeAdmin.entityId);
    const outside = db.prepare('SELECT code FROM stores WHERE entity_id <> ? AND is_active = 1 ORDER BY code LIMIT 1').get(storeAdmin.entityId);
    assert.ok(outside?.code, 'Fixture membutuhkan Store aktif di Entity lain');
    const pathname = '/api/admin/customer-membership-settings';
    const response = await handleCustomerMembershipApi(request(pathname, {
      store: outside.code,
      token: entityAdmin.token,
      method: 'PATCH',
      body: { registrationWhatsAppNumber: '081299999999' }
    }), env, pathname);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ENTITY_ADMIN_STORE_SCOPE_MISMATCH');
  } finally {
    db.close();
  }
});

test('registration returns a manual WhatsApp URL without exposing the password', async () => {
  const db = migratedDatabase();
  try {
    const env = { DB: new D1Database(db) };
    const storeAdmin = await seedStoreAdmin(db);
    const storeToken = await loginStoreAdmin(env, storeAdmin);
    const settingsPath = '/api/admin/customer-membership-settings';
    await handleCustomerMembershipApi(request(settingsPath, {
      store: storeAdmin.storeCode,
      token: storeToken,
      method: 'PATCH',
      body: { registrationWhatsAppNumber: '0812 0000 1111' }
    }), env, settingsPath);

    const pathname = '/api/customer/register';
    const password = 'supersecret123';
    const response = await handleCustomerMembershipApi(request(pathname, {
      store: storeAdmin.storeCode,
      method: 'POST',
      body: {
        customerName: 'Customer WhatsApp',
        phone: '0813 7777 8888',
        email: 'customer@example.test',
        username: 'customer.whatsapp',
        password
      }
    }), env, pathname);
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.request.status, 'PENDING');
    assert.equal(payload.verification.channel, 'WHATSAPP_MANUAL');
    assert.equal(payload.verification.requiresAdminApproval, true);
    assert.equal(payload.verification.sendConfirmed, false);
    assert.equal(payload.verification.whatsappNumber, '6281200001111');

    const whatsapp = new URL(payload.verification.whatsappUrl);
    assert.equal(whatsapp.hostname, 'wa.me');
    assert.equal(whatsapp.pathname, '/6281200001111');
    const message = whatsapp.searchParams.get('text');
    assert.match(message, /Customer WhatsApp/);
    assert.match(message, /customer\.whatsapp/);
    assert.match(message, /Kode pendaftaran:/);
    assert.doesNotMatch(message, new RegExp(password));

    const saved = db.prepare(`
      SELECT status, password_hash
      FROM customer_registration_requests
      WHERE username = 'customer.whatsapp'
    `).get();
    assert.equal(saved.status, 'PENDING');
    assert.notEqual(saved.password_hash, password);
  } finally {
    db.close();
  }
});

test('customer, Store Admin, and Entity Admin UIs expose the manual WhatsApp flow', () => {
  const customerUi = readFileSync(new URL('../public/customer-login.js', import.meta.url), 'utf8');
  const adminUi = readFileSync(new URL('../public/admin-customers.js', import.meta.url), 'utf8');
  const entityUi = readFileSync(new URL('../public/entity-admin.html', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../migrations/0082_customer_membership_whatsapp_settings.sql', import.meta.url), 'utf8');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_membership_settings/);
  assert.match(customerUi, /SIMPAN & VERIFIKASI VIA WHATSAPP/);
  assert.match(customerUi, /window\.location\.assign\(whatsappUrl\)/);
  assert.match(adminUi, /WhatsApp pendaftaran member/);
  assert.match(adminUi, /\/api\/admin\/customer-membership-settings/);
  assert.match(entityUi, /data-entity-tab="customers"/);
  assert.match(entityUi, /WhatsApp pendaftaran member per gerai/);
  assert.match(entityUi, /customer-membership-settings\?store=/);
});
