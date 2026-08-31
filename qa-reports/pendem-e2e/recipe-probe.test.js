import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE_URL = 'https://prototype-leker-v2.daily-napkin.workers.dev';
const TARGET_BRANCH = 'karen15/pendem-transaction-cycle-qa';
const pilotMigrationPath = fileURLToPath(new URL('../../migrations/0054_kantor_pendem_mandala_pilot_accounts.sql', import.meta.url));

function credential() {
  const migration = readFileSync(pilotMigrationPath, 'utf8');
  const match = migration.match(/Pendem: kasir_pendem \/ ([^\s]+)/);
  assert.ok(match, 'Pendem cashier pilot credential must remain discoverable from migration 0054');
  return { username: 'kasir_pendem', password: match[1] };
}

async function call(path, { method = 'GET', token = null, body } = {}) {
  const headers = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
  return { ok: response.ok, status: response.status, payload };
}

test('probe live Pendem production recipe graph', {
  skip: process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_HEAD_REF === TARGET_BRANCH
    ? false
    : 'live recipe probe only runs on the dedicated Pendem QA PR'
}, async () => {
  const login = await call('/api/cashier/login', { method: 'POST', body: credential() });
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.payload)}`);
  assert.ok(login.payload?.token, 'login must return token');

  const options = await call('/api/cashier/production/options', { token: login.payload.token });
  assert.equal(options.status, 200, `production options failed: ${JSON.stringify(options.payload)}`);

  const products = Array.isArray(options.payload?.products) ? options.payload.products : [];
  const simplified = products.map(product => ({
    productName: product.productName,
    recipeId: product.recipeId,
    outputQuantityPerBatch: product.outputQuantityPerBatch,
    components: (product.recipes?.[0]?.components || []).map(component => ({
      productName: component.productName,
      quantity: component.quantity,
      unitSymbol: component.unitSymbol
    }))
  }));

  console.log('PENDEM_PRODUCTION_OPTIONS=' + JSON.stringify(simplified));

  const larutan = simplified.filter(product => /Larutan (Gula|Teh Poci Vanilla)/i.test(product.productName || ''));
  console.log('PENDEM_LARUTAN_RECIPES=' + JSON.stringify(larutan));
});
