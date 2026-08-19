import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { getAccountingSettingsBootstrap } from '../src/accounting-settings.js';

const migrationDir = new URL('../migrations/', import.meta.url);
const STORE = 'store_001';
const SALE_CATEGORY = 'txcat_store_001_sale';

// Minimal D1 shape. batch() resolves each statement to a { results } envelope,
// matching what D1 returns for the SELECT batches this module issues.
function d1(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            _statement: statement,
            _args: args,
            async first() { return statement.get(...args) || null; },
            async all() { return { results: statement.all(...args) }; },
            async run() { return statement.run(...args); }
          };
        }
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

// Migration 0040 seeds a sale composition. These tests reason about a rule set
// they state themselves, so each one starts from an empty category instead of
// layering its rules on top of the default.
function clearSaleRules(sqlite) {
  sqlite.exec(`DELETE FROM journal_rules WHERE transaction_category_id = '${SALE_CATEGORY}';`);
}

function seedSaleRules(sqlite) {
  clearSaleRules(sqlite);
  sqlite.exec(`
    INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, is_active, sort_order)
    VALUES
      ('jr_t_pay','${STORE}','${SALE_CATEGORY}','Pembayaran Penjualan','DEBIT','payment_method',1,1),
      ('jr_t_rev','${STORE}','${SALE_CATEGORY}','Pendapatan','CREDIT','item_category_revenue',1,2),
      ('jr_t_cogs','${STORE}','${SALE_CATEGORY}','HPP','DEBIT','item_category_cogs',1,3),
      ('jr_t_inv','${STORE}','${SALE_CATEGORY}','Persediaan Keluar','CREDIT','item_category_inventory',1,4);
  `);
}

async function category(sqlite, code) {
  const bootstrap = await getAccountingSettingsBootstrap(d1(sqlite), { id: STORE, code: 'G001' });
  return bootstrap.transactionCategories.find(row => row.code === code) || null;
}

test('a category with no rules is incomplete and names the missing sides', async () => {
  const sqlite = freshDatabase();
  clearSaleRules(sqlite);
  const sale = await category(sqlite, 'sale');
  assert.ok(sale, 'the sale category exists in the migrated fixture');
  assert.equal(sale.completeness, 'INCOMPLETE');
  assert.deepEqual(sale.blockers.map(blocker => blocker.code), ['NO_ACTIVE_DEBIT_CREDIT']);
});

test('both sides present is not enough to call a category complete', async () => {
  const sqlite = freshDatabase();
  seedSaleRules(sqlite);
  // Reproduces the state that stranded eleven sales: rules complete, products
  // with no Jenis Barang. Migration 0040 has since given every product one, so
  // the test recreates the condition rather than assuming the fixture still
  // carries it.
  sqlite.exec(`UPDATE products SET product_kind_id = NULL WHERE store_id = '${STORE}';`);
  const sale = await category(sqlite, 'sale');

  assert.ok(sale.debitCount >= 1 && sale.creditCount >= 1);
  // This is the production shape exactly: the rules are complete and the old
  // check reported COMPLETE, while every sale still failed closed because the
  // things those rules resolve through were not ready.
  assert.equal(sale.completeness, 'INCOMPLETE', 'a category that cannot post must not read COMPLETE');

  const codes = sale.blockers.map(blocker => blocker.code).sort();
  assert.deepEqual(codes, ['PAYMENT_METHOD_UNMAPPED', 'PRODUCT_WITHOUT_KIND']);
  assert.match(sale.blockers.find(b => b.code === 'PAYMENT_METHOD_UNMAPPED').detail, /NON_CASH/);
  assert.match(sale.blockers.find(b => b.code === 'PRODUCT_WITHOUT_KIND').detail, /Jenis Barang/);
});

test('clearing every blocker is what makes a category complete', async () => {
  const sqlite = freshDatabase();
  seedSaleRules(sqlite);
  sqlite.exec(`
    UPDATE payment_methods SET account_id = 'coa_store_001_1101'
      WHERE store_id = '${STORE}' AND is_active = 1 AND (account_id IS NULL OR account_id = '');
    UPDATE products SET product_kind_id = 'product_kind_store_001_raw_material'
      WHERE store_id = '${STORE}' AND is_active = 1;
  `);

  const sale = await category(sqlite, 'sale');
  assert.deepEqual(sale.blockers, [], `expected no blockers, got ${JSON.stringify(sale.blockers)}`);
  assert.equal(sale.completeness, 'COMPLETE', 'the check must be able to go green, not only red');
});

test('blockers follow the source types a category actually uses', async () => {
  const sqlite = freshDatabase();
  seedSaleRules(sqlite);
  // cash_flow_in resolves through fixed accounts, never through Jenis Barang,
  // so kindless products must not be reported against it.
  const cashFlow = await category(sqlite, 'cash_flow_in');
  assert.ok(cashFlow);
  assert.ok(
    !cashFlow.blockers.some(blocker => blocker.code === 'PRODUCT_WITHOUT_KIND'),
    `cash_flow_in must not inherit an item blocker, got ${JSON.stringify(cashFlow.blockers)}`
  );
});
