import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import vm from 'node:vm';
import worker, { assetRoute } from '../src/index.js';
import { handleEntityCustomerPortalApi } from '../src/entity-customer-portal.js';
import { handleCustomerFeedbackApi } from '../src/customer-feedback.js';
import { hashCredential } from '../src/owner-auth.js';

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

function request(pathname, { method = 'GET', token, body } = {}) {
  return new Request(`https://example.test${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

test('Entity customer endpoint returns only active stores from the requested Entity', async () => {
  const sqlite = migratedDatabase();
  try {
    sqlite.prepare("UPDATE stores SET is_active = 0 WHERE code = 'MANDALA'").run();
    const env = { DB: new D1Database(sqlite) };
    const response = await handleEntityCustomerPortalApi(
      request('/api/entity-customer/KPM/stores'),
      env,
      '/api/entity-customer/KPM/stores'
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.entity.id, 'ENT-KPM');
    assert.equal(payload.entity.code, 'KPM');
    assert.deepEqual(payload.stores.map(store => store.code).sort(), ['KANTOR', 'PENDEM']);
    assert.ok(payload.stores.every(store => store.id !== 'store_001'));

    const missing = await handleEntityCustomerPortalApi(
      request('/api/entity-customer/TIDAK-ADA/stores'),
      env,
      '/api/entity-customer/TIDAK-ADA/stores'
    );
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'ENTITY_NOT_FOUND');

    const malformed = await handleEntityCustomerPortalApi(
      request('/api/entity-customer/KPM!/stores'),
      env,
      '/api/entity-customer/KPM!/stores'
    );
    assert.equal(malformed.status, 404);
    assert.equal((await malformed.json()).code, 'ENTITY_NOT_FOUND');
  } finally {
    sqlite.close();
  }
});

test('Entity selection keeps PENDEM in the URL and scopes subsequent menu requests to PENDEM', async () => {
  const entityScript = readFileSync(new URL('../public/entity-customer.js', import.meta.url), 'utf8');
  const storeContextScript = readFileSync(new URL('../public/store-context.js', import.meta.url), 'utf8');

  class FakeStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(String(key)) ?? null; }
    setItem(key, value) { this.values.set(String(key), String(value)); }
    removeItem(key) { this.values.delete(String(key)); }
  }

  const localStorage = new FakeStorage();
  const landingLocation = {
    pathname: '/e/KPM/customer',
    origin: 'https://example.test',
    assigned: '',
    assign(href) { this.assigned = href; this.pathname = href; }
  };
  const landingWindow = {};
  const landingContext = vm.createContext({
    window: landingWindow,
    location: landingLocation,
    localStorage,
    document: { readyState: 'loading', addEventListener() {} },
    encodeURIComponent,
    decodeURIComponent
  });
  vm.runInContext(entityScript, landingContext);

  const selectedHref = landingWindow.LEKER_ENTITY_CUSTOMER_PORTAL.selectStore('PENDEM');
  assert.equal(selectedHref, '/s/PENDEM/customer');
  assert.equal(landingLocation.assigned, '/s/PENDEM/customer');
  assert.equal(localStorage.getItem('lekerCustomerStoreCode'), 'PENDEM');

  let fetchedUrl = '';
  const customerLocation = { pathname: selectedHref, origin: 'https://example.test' };
  const customerWindow = {
    location: customerLocation,
    localStorage,
    sessionStorage: new FakeStorage(),
    async fetch(input) {
      fetchedUrl = input instanceof Request ? input.url : String(input);
      return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
    }
  };
  const customerContext = vm.createContext({
    window: customerWindow,
    location: customerLocation,
    localStorage,
    sessionStorage: customerWindow.sessionStorage,
    Storage: FakeStorage,
    document: { addEventListener() {}, querySelectorAll() { return []; } },
    Request,
    Response,
    URL
  });
  vm.runInContext(storeContextScript, customerContext);
  assert.equal(customerWindow.LEKER_STORE_CODE, 'PENDEM');

  await customerWindow.fetch('/api/menu');
  const menuUrl = new URL(fetchedUrl);
  assert.equal(menuUrl.pathname, '/api/menu');
  assert.equal(menuUrl.searchParams.get('store'), 'PENDEM');
  assert.match(entityScript, /selectStore\(link\.dataset\.entityStoreCode\)/);
});

test('feedback submitted after the PENDEM portal flow is persisted against PENDEM, not the default store', async () => {
  const sqlite = migratedDatabase();
  try {
    const db = new D1Database(sqlite);
    const token = 'entity-customer-portal-pendem-token';
    const tokenHash = await hashCredential(token);
    sqlite.prepare(`
      INSERT INTO customer_sessions (token_hash, customer_id, created_at, expires_at)
      VALUES (?, 'customer_pendem_pilot', '2026-09-07T00:00:00.000Z', '2099-01-01T00:00:00.000Z')
    `).run(tokenHash);

    const response = await handleCustomerFeedbackApi(
      request('/api/customer/feedback?store=PENDEM', {
        method: 'POST',
        token,
        body: { category: 'SERVICE', issues: ['SERVICE_TOO_SLOW'], manualNote: '' }
      }),
      { DB: db },
      '/api/customer/feedback'
    );
    assert.equal(response.status, 201, await response.text());

    const persisted = sqlite.prepare(`
      SELECT store_id, customer_id
      FROM customer_feedback_reports
      ORDER BY created_at DESC
      LIMIT 1
    `).get();
    assert.deepEqual({ ...persisted }, {
      store_id: 'store_pendem',
      customer_id: 'customer_pendem_pilot'
    });
  } finally {
    sqlite.close();
  }
});

test('scoped customer and Entity routes serve canonical assets without redirecting away their context', async () => {
  assert.equal(assetRoute('/s/PENDEM/customer'), '/customer');
  assert.equal(assetRoute('/e/KPM/customer'), '/entity-customer');

  const seen = [];
  const env = {
    ASSETS: {
      fetch(assetRequest) {
        const pathname = new URL(assetRequest.url).pathname;
        seen.push(pathname);
        const body = pathname === '/customer' || pathname === '/customer.html'
          ? 'asset:customer-shell'
          : `asset:${pathname}`;
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }
  };

  const scoped = await worker.fetch(request('/s/PENDEM/customer'), env);
  const bare = await worker.fetch(request('/customer'), env);
  const entity = await worker.fetch(request('/e/KPM/customer'), env);

  assert.equal(scoped.status, 200);
  assert.equal(scoped.headers.get('location'), null);
  assert.equal(await scoped.text(), await bare.text());
  assert.equal(await entity.text(), 'asset:/entity-customer');
  assert.deepEqual(seen, ['/customer', '/customer.html', '/entity-customer']);
});
