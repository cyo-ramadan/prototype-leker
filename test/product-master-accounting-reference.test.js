import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const referenceMigration = readFileSync(new URL('../migrations/0018_product_master_accounting_reference.sql', import.meta.url), 'utf8');
const settingsMigration = readFileSync(new URL('../migrations/0022_accounting_warehouse_settings.sql', import.meta.url), 'utf8');
const snapshotCompatMigration = readFileSync(new URL('../migrations/0023_accounting_snapshot_settings_compat.sql', import.meta.url), 'utf8');
const costingMigration = readFileSync(new URL('../migrations/0019_product_costing_and_kinds.sql', import.meta.url), 'utf8');
const productionCostMigration = readFileSync(new URL('../migrations/0021_exact_production_costing.sql', import.meta.url), 'utf8');
const masterPurchasePriceMigration = readFileSync(new URL('../migrations/0032_master_purchase_price.sql', import.meta.url), 'utf8');
const productMaster = readFileSync(new URL('../src/product-master.js', import.meta.url), 'utf8');
const productKinds = readFileSync(new URL('../src/product-kinds.js', import.meta.url), 'utf8');
const productPolicy = readFileSync(new URL('../src/product-policy.js', import.meta.url), 'utf8');
const accountingReference = readFileSync(new URL('../src/accounting-reference.js', import.meta.url), 'utf8');
const cashierPurchase = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const correctionExecutor = readFileSync(new URL('../src/transaction-correction-executor.js', import.meta.url), 'utf8');
const purchaseDetail = readFileSync(new URL('../src/admin-purchase-detail.js', import.meta.url), 'utf8');
const productUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const procurementUi = readFileSync(new URL('../public/cashier-procurement-ui.js', import.meta.url), 'utf8');
const masterMenu = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('Product Master owns recipe link while canonical Accounting Settings supersedes the legacy pair registry forward-compatibly', () => {
  assert.match(referenceMigration, /ALTER TABLE products ADD COLUMN linked_recipe_id/);
  assert.match(referenceMigration, /PRODUCT_RECIPE_LINK_MISMATCH/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS accounting_account_refs/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS transaction_accounting_mappings/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS transaction_accounting_snapshots/);
  assert.match(settingsMigration, /CREATE TABLE IF NOT EXISTS chart_of_accounts/);
  assert.match(settingsMigration, /CREATE TABLE IF NOT EXISTS journal_rules/);
  assert.match(snapshotCompatMigration, /ALTER TABLE transaction_accounting_snapshots ADD COLUMN transaction_category_code/);
});

test('basic accounts live in canonical chart of accounts while provisional references are compatibility-only', () => {
  for (const code of ['1101', '1102', '1201', '1301', '1302', '1303', '2101', '3101', '3201', '4101', '5101', '6101']) {
    assert.match(settingsMigration, new RegExp(`'${code}'`));
  }
  assert.match(settingsMigration, /'1301', 'Persediaan Bahan'/);
  assert.match(settingsMigration, /'2101', 'Utang Usaha'/);
  assert.match(accountingReference, /MAXI_ACCOUNTING_SETTINGS_V1/);
  assert.match(accountingReference, /journalGeneration: 'OUT_OF_SCOPE'/);
  assert.match(accountingReference, /Pair mapping legacy sudah dipensiunkan/);
  assert.doesNotMatch(accountingReference, /transaction_accounting_mappings/);
  assert.doesNotMatch(accountingReference, /accounting_account_refs/);
  assert.doesNotMatch(accountingReference, /INSERT INTO journal/i);
});

test('transaction snapshot adds canonical configuration evidence without breaking 0018 history', () => {
  assert.match(referenceMigration, /business_event TEXT NOT NULL/);
  assert.match(referenceMigration, /mapping_status TEXT NOT NULL/);
  assert.match(snapshotCompatMigration, /transaction_category_code TEXT NOT NULL DEFAULT ''/);
  assert.match(snapshotCompatMigration, /payment_method_code TEXT NOT NULL DEFAULT ''/);
  assert.match(snapshotCompatMigration, /configuration_status TEXT NOT NULL DEFAULT 'INCOMPLETE'/);
  assert.match(snapshotCompatMigration, /WHEN 'PURCHASE_MATERIAL' THEN 'purchase_material'/);
  assert.match(accountingReference, /mapping_id, debit_account_ref_id, credit_account_ref_id, mapping_status/);
  assert.match(accountingReference, /NULL, NULL, NULL/);
  assert.match(accountingReference, /configurationStatus/);
  assert.match(accountingReference, /COMPLETE/);
  assert.match(accountingReference, /INCOMPLETE/);
  assert.match(accountingReference, /CATEGORY_NOT_FOUND/);
});

test('Product Master validates type unit points recipe and product kind without owning fulfillment or journal accounts', () => {
  assert.match(productMaster, /getManufacturingReferenceData/);
  assert.match(productMaster, /resolveProductMasterReferences/);
  assert.match(productMaster, /resolveLinkedRecipe/);
  assert.match(productMaster, /resolveProductKind/);
  assert.match(productMaster, /Poin barang harus bilangan bulat/);
  assert.match(productMaster, /Satuan dasar tidak boleh diganti setelah barang punya resep atau histori stok/);
  assert.doesNotMatch(productMaster, /productionMode|production_mode\s*=|Mode DADAKAN membutuhkan/);
  assert.doesNotMatch(productMaster, /AccountingAccount|productAccounting|salesAccountRef|cogsAccountRef/);
});

test('Jenis Barang is user-defined accounting classification with stable code and no invented seed', () => {
  assert.match(costingMigration, /CREATE TABLE IF NOT EXISTS product_kinds/);
  assert.match(costingMigration, /UNIQUE \(store_id, code\)/);
  assert.match(costingMigration, /ALTER TABLE products ADD COLUMN product_kind_id/);
  assert.match(productKinds, /codeText/);
  assert.match(productKinds, /is_active/);
  assert.doesNotMatch(costingMigration, /INSERT INTO product_kinds/);
  assert.match(indexSource, /handleProductKindApi/);
});

test('Master purchase price stays editable while Average Cost and Last Purchase Price remain server-owned', () => {
  assert.match(costingMigration, /ALTER TABLE products ADD COLUMN average_cost INTEGER NOT NULL DEFAULT 0/);
  assert.match(costingMigration, /ALTER TABLE products ADD COLUMN last_purchase_price INTEGER NOT NULL DEFAULT 0/);
  assert.match(costingMigration, /purchase_price \* 1000000/);
  assert.doesNotMatch(costingMigration, /average_cost REAL|last_purchase_price REAL|unit_cost REAL/);
  assert.match(productionCostMigration, /hpp_total_scaled INTEGER/);
  assert.match(productionCostMigration, /unit_cost_snapshot_scaled INTEGER/);
  assert.match(productMaster, /COST_SCALE = 1_000_000/);
  assert.match(productMaster, /costFromScaled\(row\.average_cost\)/);
  assert.match(productMaster, /purchasePrice: Number\(row\.purchase_price/);
  assert.match(productMaster, /const purchasePrice = money\(owns\(body, 'purchasePrice'\)/);
  assert.match(productMaster, /purchase_price = \?, price = \?/);
  assert.match(productUi, /Average Cost · HPP berjalan/);
  assert.match(productUi, /Harga Beli Terakhir/);
  assert.match(productUi, /readonly/);
  assert.match(productUi, /purchasePrice: Number\(el\('productPurchasePrice'\)\.value\)/);
  assert.match(productUi, /Belum ada transaksi pembelian; sementara mengikuti Harga Beli master/);
  assert.match(masterPurchasePriceMigration, /WHERE purchase_price = 0/);
  assert.match(masterPurchasePriceMigration, /last_purchase_price > 0/);
  assert.match(masterPurchasePriceMigration, /last_purchase_at IS NOT NULL/);
  assert.doesNotMatch(cashierPurchase, /purchase_price = CAST/);
  assert.doesNotMatch(correctionExecutor, /\n\s+purchase_price = \?/);
  assert.doesNotMatch(productMaster, /body\?\.averageCost|body\?\.lastPurchasePrice/);
});

test('Master Barang keeps scalable references behind a simple advanced surface', () => {
  assert.match(productUi, /Stok & pengaturan lanjutan/);
  assert.match(productUi, /Peran Barang<select id="productItemType"/);
  assert.match(productUi, /Klasifikasi Accounting<select id="productKind"/);
  assert.match(productUi, /Satuan Dasar<select id="productBaseUnit"/);
  assert.match(productUi, /Poin per 1 barang/);
  assert.match(productUi, /Recipe Linked<select id="productLinkedRecipe"/);
  assert.doesNotMatch(productUi, /id="productProductionMode"/);
  assert.match(masterMenu, /data-master-target="productKindMasterCard">Klasifikasi Accounting/);
  assert.match(productUi, /item\.code === 'FINISHED_GOOD'/);
  assert.match(productUi, /item\.code === 'PCS'/);
  assert.match(productUi, /loadEditor\(true\)/);
  assert.match(productUi, /product-master-reference-updated/);
  assert.match(productMaster, /owns\(body, 'purchasePrice'\)/);
  assert.match(productMaster, /current\?\.purchase_price/);
  assert.match(productMaster, /const refs = await getManufacturingReferenceData/);
  assert.doesNotMatch(productMaster, /const \[refs, productKinds, products, recipes\] = await Promise\.all/);
});

test('purchase is itemized from database products and atomically snapshots configuration stock last price and moving average cost', () => {
  assert.match(procurementUi, /\/api\/cashier\/purchases\/options/);
  assert.match(procurementUi, /id="dialogPurchaseProduct"/);
  assert.match(procurementUi, /id="dialogPurchaseQty"/);
  assert.match(procurementUi, /<option value="CASH">Cash \/ Kas<\/option>/);
  assert.match(procurementUi, /<option value="BANK">Bank \/ Transfer<\/option>/);
  assert.match(procurementUi, /<option value="PAYABLE">Hutang \/ Utang Usaha<\/option>/);
  assert.match(cashierPurchase, /PURCHASE_MATERIAL/);
  assert.match(cashierPurchase, /buildTransactionAccountingSnapshot/);
  assert.match(cashierPurchase, /INSERT INTO purchase_items/);
  assert.match(cashierPurchase, /average_cost_after/);
  assert.match(cashierPurchase, /last_purchase_price/);
  assert.doesNotMatch(cashierPurchase, /last_purchase_price[\s\S]{0,300}purchase_price = CAST/);
  assert.match(cashierPurchase, /unitCostScaled/);
  assert.match(cashierPurchase, /UPDATE inventory_stock_balances/);
  assert.match(cashierPurchase, /await env\.DB\.batch\(statements\)/);
  assert.match(cashierPurchase, /accounting\.statement/);
  assert.doesNotMatch(cashierPurchase, /\* 1\.0/);
});

test('transaction configuration snapshot remains immutable evidence for purchase detail while journal stays external', () => {
  assert.match(accountingReference, /transaction_accounting_snapshots/);
  assert.match(accountingReference, /getTransactionAccountingSnapshot/);
  assert.match(purchaseDetail, /transactionLink: snapshot/);
  assert.match(purchaseDetail, /journalReference: null/);
  assert.match(purchaseDetail, /PURCHASE_MATERIAL/);
  assert.match(purchaseDetail, /averageCostBefore/);
  assert.match(purchaseDetail, /averageCostAfter/);
  assert.match(purchaseDetail, /costFromScaled/);
});

test('new focused handlers win before legacy generic routes', () => {
  const purchaseHandler = indexSource.indexOf('const purchaseResponse = await handleCashierPurchaseApi');
  const drawerHandler = indexSource.indexOf('const cashierDrawerResponse = await handleCashierDrawerApi');
  assert.ok(purchaseHandler >= 0 && purchaseHandler < drawerHandler);

  const productKindHandler = indexSource.indexOf('const productKindResponse = await handleProductKindApi');
  const accountingSettingsHandler = indexSource.indexOf('const accountingSettingsResponse = await handleAccountingSettingsApi');
  const warehouseSettingsHandler = indexSource.indexOf('const warehouseSettingsResponse = await handleWarehouseSettingsApi');
  const genericAdminHandler = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(productKindHandler >= 0 && productKindHandler < genericAdminHandler);
  assert.ok(accountingSettingsHandler >= 0 && accountingSettingsHandler < genericAdminHandler);
  assert.ok(warehouseSettingsHandler >= 0 && warehouseSettingsHandler < genericAdminHandler);

  const purchaseDetailHandler = indexSource.indexOf('const adminPurchaseDetailResponse = await handleAdminPurchaseDetailApi');
  const genericDetailHandler = indexSource.indexOf('const adminTransactionDetailResponse = await handleAdminTransactionDetailApi');
  assert.ok(purchaseDetailHandler >= 0 && purchaseDetailHandler < genericDetailHandler);

  assert.match(productPolicy, /linked_recipe_id/);
  assert.match(productPolicy, /resolveLinkedRecipe/);
  assert.match(productPolicy, /legacyProductionMode/);
});
