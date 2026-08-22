import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const CONFIG_MIGRATION = '0040_single_product_kind_and_sale_rules.sql';

const migrations = () => readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
const read = file => readFileSync(new URL(file, migrationDir), 'utf8');

function database({ includeConfig = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of migrations()) {
    if (!includeConfig && file === CONFIG_MIGRATION) continue;
    sqlite.exec(read(file));
  }
  return sqlite;
}

const applyConfig = sqlite => sqlite.exec(read(CONFIG_MIGRATION));

// Every store that has an active `sale` category and the rules it needs to
// produce at least one Debit and one Credit line.
const storesThatCannotPostSales = sqlite => sqlite.prepare(`
  SELECT c.store_id FROM transaction_categories c
  WHERE c.code = 'sale' AND c.is_active = 1
    AND (
      (SELECT COUNT(*) FROM journal_rules r
       WHERE r.transaction_category_id = c.id AND r.is_active = 1 AND r.side = 'DEBIT') = 0
      OR (SELECT COUNT(*) FROM journal_rules r
          WHERE r.transaction_category_id = c.id AND r.is_active = 1 AND r.side = 'CREDIT') = 0
    )
  ORDER BY c.store_id
`).all().map(row => row.store_id);

const productsThatCannotResolveAccounts = sqlite => sqlite.prepare(`
  SELECT COUNT(*) AS n FROM products p
  WHERE p.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM item_categories c
      WHERE c.store_id = p.store_id AND c.product_kind_id = p.product_kind_id AND c.is_active = 1
    )
`).get().n;

const tableRows = (sqlite, tables) =>
  tables.map(table => JSON.stringify(sqlite.prepare(`SELECT * FROM "${table}"`).all()));

const CONFIG_TABLES = ['product_kinds', 'item_categories', 'journal_rules', 'products'];

test('without this migration no store in a fresh database can post a sale', () => {
  const sqlite = database({ includeConfig: false });

  // This is the gap the eleven stranded sales fell into. The seed migrations
  // wire up purchase, operational, cash flow and every warehouse category, but
  // never once wire up `sale` — so a brand new deployment could not post a
  // single sale either, and nothing failed to say so.
  assert.deepEqual(storesThatCannotPostSales(sqlite), ['store_001', 'store_002']);
  assert.ok(productsThatCannotResolveAccounts(sqlite) > 0, 'seeded products carry no Jenis Barang');
});

test('after this migration every store can post a sale', () => {
  const sqlite = database();

  assert.deepEqual(storesThatCannotPostSales(sqlite), []);
  assert.equal(productsThatCannotResolveAccounts(sqlite), 0);

  const rules = sqlite.prepare(`
    SELECT r.side, r.source_type FROM journal_rules r
    JOIN transaction_categories c ON c.id = r.transaction_category_id
    WHERE c.code = 'sale' AND c.store_id = 'store_002' AND r.is_active = 1
    ORDER BY r.sort_order
  `).all().map(row => `${row.side} ${row.source_type}`);
  assert.deepEqual(rules, [
    'DEBIT payment_method',
    'CREDIT item_category_revenue',
    'DEBIT item_category_cogs',
    'CREDIT item_category_inventory'
  ]);
});

test('the single kind resolves inventory to 1301, as Bos Cyo decided on 2026-08-19', () => {
  const sqlite = database();

  const mappings = sqlite.prepare(`
    SELECT c.store_id, inv.code AS inventory, cogs.code AS cogs, rev.code AS revenue
    FROM item_categories c
    JOIN chart_of_accounts inv ON inv.id = c.inventory_account_id
    JOIN chart_of_accounts cogs ON cogs.id = c.cogs_account_id
    JOIN chart_of_accounts rev ON rev.id = c.revenue_account_id
    WHERE c.is_active = 1
    ORDER BY c.store_id
  `).all();

  assert.ok(mappings.length >= 2);
  for (const mapping of mappings) {
    assert.equal(mapping.inventory, '1301', `${mapping.store_id} keeps inventory in Persediaan Bahan`);
    assert.equal(mapping.cogs, '5101');
    assert.equal(mapping.revenue, '4101');
  }

  // One kind for now. A second one is a deliberate act in Setting Akuntansi
  // later, not something this migration decides on Bos Cyo's behalf.
  const kinds = sqlite.prepare(`SELECT DISTINCT code FROM product_kinds WHERE is_active = 1`)
    .all().map(row => row.code);
  assert.deepEqual(kinds, ['RAW_MATERIAL']);
});

test('configuration that already produced posted journals is left untouched', () => {
  const sqlite = database({ includeConfig: false });
  const before = sqlite.prepare(`
    SELECT id, inventory_account_id, cogs_account_id, revenue_account_id
    FROM item_categories WHERE store_id = 'store_001'
  `).get();

  applyConfig(sqlite);

  // store_001 already posts purchases against this mapping. Rewriting it would
  // move the accounts behind entries that can no longer be edited.
  assert.deepEqual(
    sqlite.prepare(`
      SELECT id, inventory_account_id, cogs_account_id, revenue_account_id
      FROM item_categories WHERE store_id = 'store_001'
    `).get(),
    before
  );
});

test('a product that already has a kind is never moved to another account', () => {
  const sqlite = database({ includeConfig: false });
  // Inserting the kind is enough: trg_product_kinds_seed_accounting_mapping
  // from migration 0029 creates its mapping, which the admin then points at
  // Persediaan Barang Jadi.
  sqlite.exec(`
    INSERT INTO product_kinds (id, store_id, code, name)
    VALUES ('kind_finished', 'store_001', 'FINISHED', 'Barang Jadi');
    UPDATE item_categories SET inventory_account_id = 'coa_store_001_1303'
    WHERE product_kind_id = 'kind_finished';
  `);
  const pinned = sqlite.prepare(`SELECT id FROM products WHERE store_id = 'store_001' AND is_active = 1 LIMIT 1`).get().id;
  sqlite.prepare(`UPDATE products SET product_kind_id = 'kind_finished' WHERE id = ?`).run(pinned);

  applyConfig(sqlite);

  assert.equal(
    sqlite.prepare(`SELECT product_kind_id FROM products WHERE id = ?`).get(pinned).product_kind_id,
    'kind_finished',
    'a kind an admin chose deliberately outranks the default'
  );
});

test('the migration refuses to finish while a sale could still fail to post', () => {
  const sqlite = database({ includeConfig: false });
  // An admin deactivated a Jenis Barang mapping while products were still using
  // it. Step 3 will not touch those products — they already have a kind — so
  // their sales would keep failing. A migration that reported success here is
  // exactly how eleven sales failed for days unnoticed.
  sqlite.exec(`
    INSERT INTO product_kinds (id, store_id, code, name)
    VALUES ('kind_special', 'store_001', 'SPECIAL', 'Barang Titipan');
    UPDATE products SET product_kind_id = 'kind_special'
    WHERE store_id = 'store_001' AND is_active = 1;
    UPDATE item_categories SET is_active = 0 WHERE product_kind_id = 'kind_special';
  `);

  assert.throws(() => applyConfig(sqlite), /CHECK|constraint/i);
});

test('applying the migration twice changes nothing the second time', () => {
  const sqlite = database();
  const before = tableRows(sqlite, CONFIG_TABLES);

  applyConfig(sqlite);

  // updated_at moves only if the UPDATE fires again, so an unchanged snapshot
  // also proves the second run does not re-touch rows it already assigned.
  assert.deepEqual(tableRows(sqlite, CONFIG_TABLES), before);
});

test('new stores always receive RAW_MATERIAL without requiring Accounting categories', () => {
  const sqlite = database();

  sqlite.exec(`
    INSERT INTO stores (id, code, name, edition) VALUES ('store_lite_new', 'LNEW', 'Lite New', 'LITE');
    INSERT INTO stores (id, code, name, edition) VALUES ('store_flexible_new', 'FNEW', 'Flexible New', 'FLEXIBLE');
    INSERT INTO stores (id, code, name, edition) VALUES ('store_accounting_new', 'ANEW', 'Accounting New', 'ACCOUNTING');
  `);

  for (const storeId of ['store_lite_new', 'store_flexible_new', 'store_accounting_new']) {
    const kinds = sqlite.prepare(`
      SELECT code FROM product_kinds WHERE store_id = ? ORDER BY code
    `).all(storeId).map(row => row.code);
    assert.deepEqual(kinds, ['RAW_MATERIAL'], `${storeId} gets exactly one RAW_MATERIAL kind`);
  }
});

test('the migration writes configuration, never journals', () => {
  const statements = read(CONFIG_MIGRATION).replace(/^\s*--.*$/gm, '');
  for (const table of ['accounting_journal_headers', 'accounting_journal_lines', 'accounting_bridge_deliveries']) {
    assert.ok(
      !statements.includes(table),
      `${table} belongs to Accounting; a configuration migration must not write it`
    );
  }
});
