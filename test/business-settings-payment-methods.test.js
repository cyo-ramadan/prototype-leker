import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handleBusinessSettingsApi } from '../src/business-settings.js';
import { handleAccountingSettingsApi } from '../src/accounting-settings.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const businessSource = readFileSync(new URL('../src/business-settings.js', import.meta.url), 'utf8');
const accountingSource = readFileSync(new URL('../src/accounting-settings.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = args => ({
        _statement: statement,
        _args: args,
        async first() { return statement.get(...args) || null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { return statement.run(...args); }
      });
      return {
        bind(...args) { return bound(args); },
        async first() { return statement.get() || null; },
        async all() { return { results: statement.all() }; },
        async run() { return statement.run(); }
      };
    },
    async batch(bound) {
      return bound.map(item => ({ results: item._statement.all(...item._args) }));
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

async function call(handler, sqlite, method, path, body) {
  const url = `http://local${path}?store=G001`;
  const request = new Request(url, {
    method,
    headers: { 'x-admin-pin': '123456', 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return handler(request, { DB: d1(sqlite) }, new URL(url).pathname);
}

function bankContext(sqlite) {
  return sqlite.prepare(`
    SELECT p.id, a.id AS account_id
    FROM payment_methods p
    JOIN chart_of_accounts a ON a.store_id = p.store_id AND a.code = '1101'
    WHERE p.store_id = 'store_001' AND p.code = 'BANK'
  `).get();
}

function paymentState(sqlite) {
  return sqlite.prepare(`
    SELECT id, code, name, account_id, is_active, is_default
    FROM payment_methods
    WHERE store_id = 'store_001'
    ORDER BY id
  `).all();
}

test('Business and deprecated Accounting payment routes produce identical database effects', async () => {
  const businessDb = freshDatabase();
  const accountingDb = freshDatabase();
  try {
    const business = bankContext(businessDb);
    const accounting = bankContext(accountingDb);
    assert.ok(business?.id && business.account_id);
    assert.deepEqual(accounting, business);

    const payload = {
      name: 'Transfer Bank Utama',
      accountId: business.account_id,
      isActive: true,
      isDefault: true
    };
    const businessResponse = await call(
      handleBusinessSettingsApi,
      businessDb,
      'PATCH',
      `/api/admin/settings/business/payment-methods/${encodeURIComponent(business.id)}`,
      payload
    );
    const accountingResponse = await call(
      handleAccountingSettingsApi,
      accountingDb,
      'PATCH',
      `/api/admin/settings/accounting/payment-methods/${encodeURIComponent(accounting.id)}`,
      payload
    );

    assert.equal(businessResponse.status, 200);
    assert.equal(accountingResponse.status, 200);
    assert.deepEqual(paymentState(businessDb), paymentState(accountingDb));
    assert.equal(paymentState(businessDb).find(row => row.id === business.id)?.is_default, 1);
  } finally {
    businessDb.close();
    accountingDb.close();
  }
});

test('Business Settings owns the reachable writer while Accounting keeps one deprecated alias', () => {
  assert.match(businessSource, /export async function savePaymentMethod/);
  assert.match(businessSource, /\/api\/admin\/settings\/business\/payment-methods/);
  assert.match(accountingSource, /import \{ savePaymentMethod \} from '\.\/business-settings\.js'/);
  assert.match(accountingSource, /Deprecated compatibility alias/);
  assert.doesNotMatch(accountingSource, /(?:async )?function savePaymentMethod\(/);

  const businessDispatch = indexSource.indexOf('const businessSettingsResponse = await handleBusinessSettingsApi');
  const accountingDispatch = indexSource.indexOf('const accountingSettingsResponse = await handleAccountingSettingsApi');
  const genericAdminDispatch = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(businessDispatch >= 0 && businessDispatch < accountingDispatch);
  assert.ok(accountingDispatch < genericAdminDispatch);
  assert.match(packageSource, /node --check src\/business-settings\.js/);
});
