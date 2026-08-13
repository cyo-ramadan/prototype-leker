import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);

function tableColumns(db, table) {
  return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map(row => [row.name, String(row.type || '').toUpperCase()]));
}

test('all migrations apply in order on a fresh SQLite database', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    const files = readdirSync(migrationDir)
      .filter(name => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    assert.ok(files.length >= 22, 'expected the complete migration history through 0022');

    for (const file of files) {
      const sql = readFileSync(new URL(file, migrationDir), 'utf8');
      assert.doesNotThrow(() => db.exec(sql), `migration ${file} must apply to a fresh database`);
    }

    const productColumns = tableColumns(db, 'products');
    assert.equal(productColumns.get('product_kind_id'), 'TEXT');
    assert.equal(productColumns.get('average_cost'), 'INTEGER');
    assert.equal(productColumns.get('last_purchase_price'), 'INTEGER');

    const purchaseItemColumns = tableColumns(db, 'purchase_items');
    assert.equal(purchaseItemColumns.get('product_id'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('quantity'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('line_total'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('unit_cost'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('average_cost_before'), 'INTEGER');
    assert.equal(purchaseItemColumns.get('average_cost_after'), 'INTEGER');

    const saleItemColumns = tableColumns(db, 'sale_items');
    assert.equal(saleItemColumns.get('unit_cost_snapshot'), 'INTEGER');
    assert.equal(saleItemColumns.get('line_cogs'), 'INTEGER');

    const expenseColumns = tableColumns(db, 'expenses');
    assert.equal(expenseColumns.get('quantity'), 'TEXT');

    const productionRunColumns = tableColumns(db, 'production_runs');
    assert.equal(productionRunColumns.get('hpp_total_scaled'), 'INTEGER');
    assert.equal(productionRunColumns.get('hpp_per_unit_scaled'), 'INTEGER');

    const productionComponentColumns = tableColumns(db, 'production_run_components');
    assert.equal(productionComponentColumns.get('unit_cost_snapshot_scaled'), 'INTEGER');
    assert.equal(productionComponentColumns.get('total_cost_snapshot_scaled'), 'INTEGER');

    const kindColumns = tableColumns(db, 'product_kinds');
    assert.equal(kindColumns.get('id'), 'TEXT');
    assert.equal(kindColumns.get('code'), 'TEXT');
    assert.equal(kindColumns.get('is_active'), 'INTEGER');

    const snapshotColumns = tableColumns(db, 'transaction_accounting_snapshots');
    assert.equal(snapshotColumns.get('id'), 'TEXT');
    assert.equal(snapshotColumns.get('transaction_category_code'), 'TEXT');
    assert.equal(snapshotColumns.get('payment_method_code'), 'TEXT');
    assert.equal(snapshotColumns.get('configuration_status'), 'TEXT');

    const accountColumns = tableColumns(db, 'chart_of_accounts');
    assert.equal(accountColumns.get('id'), 'TEXT');
    assert.equal(accountColumns.get('code'), 'TEXT');
    assert.equal(accountColumns.get('is_active'), 'INTEGER');
    assert.equal(accountColumns.get('review_required'), 'INTEGER');

    const paymentColumns = tableColumns(db, 'payment_methods');
    assert.equal(paymentColumns.get('id'), 'TEXT');
    assert.equal(paymentColumns.get('account_id'), 'TEXT');
    assert.equal(paymentColumns.get('is_active'), 'INTEGER');

    const itemCategoryColumns = tableColumns(db, 'item_categories');
    assert.equal(itemCategoryColumns.get('product_kind_id'), 'TEXT');
    assert.equal(itemCategoryColumns.get('inventory_account_id'), 'TEXT');
    assert.equal(itemCategoryColumns.get('cogs_account_id'), 'TEXT');

    const transactionCategoryColumns = tableColumns(db, 'transaction_categories');
    assert.equal(transactionCategoryColumns.get('involves_payment'), 'INTEGER');
    assert.equal(transactionCategoryColumns.get('involves_item_category'), 'INTEGER');
    assert.equal(transactionCategoryColumns.get('registered_by_module'), 'TEXT');

    const ruleColumns = tableColumns(db, 'journal_rules');
    assert.equal(ruleColumns.get('transaction_category_id'), 'TEXT');
    assert.equal(ruleColumns.get('fixed_account_id'), 'TEXT');
    assert.equal(ruleColumns.get('sort_order'), 'INTEGER');

    const warehouseColumns = tableColumns(db, 'warehouses');
    assert.equal(warehouseColumns.get('id'), 'TEXT');
    assert.equal(warehouseColumns.get('store_id'), 'TEXT');
    assert.equal(warehouseColumns.get('is_active'), 'INTEGER');

    const accessColumns = tableColumns(db, 'warehouse_access');
    assert.equal(accessColumns.get('principal_id'), 'TEXT');
    assert.equal(accessColumns.get('can_stock_opname'), 'INTEGER');
    assert.equal(accessColumns.get('can_transfer'), 'INTEGER');

    const opnameColumns = tableColumns(db, 'warehouse_stock_opname_settings');
    assert.equal(opnameColumns.get('quantity_tolerance'), 'TEXT');
    assert.equal(opnameColumns.get('percentage_tolerance_bps'), 'INTEGER');
    assert.equal(opnameColumns.get('requires_approval'), 'INTEGER');

    const seededCategories = db.prepare(`SELECT code, registered_by_module FROM transaction_categories WHERE store_id = 'store_001' ORDER BY code`).all();
    const categoryMap = new Map(seededCategories.map(row => [row.code, row.registered_by_module]));
    for (const code of ['sale','purchase_material','operational','payroll','deposit']) assert.equal(categoryMap.get(code), 'ACCOUNTING');
    for (const code of ['wh_transfer','wh_opname','wh_production','wh_return']) assert.equal(categoryMap.get(code), 'WAREHOUSE');

    const reviewedAccounts = db.prepare(`SELECT code FROM chart_of_accounts WHERE store_id = 'store_001' AND review_required = 1 ORDER BY code`).all().map(row => row.code);
    assert.deepEqual(reviewedAccounts, ['4201', '6103']);
  } finally {
    db.close();
  }
});
