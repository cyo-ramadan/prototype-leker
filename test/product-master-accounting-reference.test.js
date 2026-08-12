import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const referenceMigration = readFileSync(new URL('../migrations/0018_product_master_accounting_reference.sql', import.meta.url), 'utf8');
const costingMigration = readFileSync(new URL('../migrations/0019_product_costing_and_kinds.sql', import.meta.url), 'utf8');
const productMaster = readFileSync(new URL('../src/product-master.js', import.meta.url), 'utf8');
const productKinds = readFileSync(new URL('../src/product-kinds.js', import.meta.url), 'utf8');
const productPolicy = readFileSync(new URL('../src/product-policy.js', import.meta.url), 'utf8');
const accountingReference = readFileSync(new URL('../src/accounting-reference.js', import.meta.url), 'utf8');
const cashierPurchase = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const purchaseDetail = readFileSync(new URL('../src/admin-purchase-detail.js', import.meta.url), 'utf8');
const productUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const cashierEnhancements = readFileSync(new URL('../public/cashier-enhancements.js', import.meta.url), 'utf8');
const masterMenu = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('Product Master owns explicit recipe link while Accounting linkage is transaction-owned', () => {
  assert.match(referenceMigration, /ALTER TABLE products ADD COLUMN linked_recipe_id/);
  assert.match(referenceMigration, /PRODUCT_RECIPE_LINK_MISMATCH/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS accounting_account_refs/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS transaction_accounting_mappings/);
  assert.match(referenceMigration, /CREATE TABLE IF NOT EXISTS transaction_accounting_snapshots/);
  assert.doesNotMatch(referenceMigration, /CREATE TABLE IF NOT EXISTS product_accounting_refs/);
});

test('basic Accounting references include inventory material cash bank payable and stay provisional', () => {
  for (const code of ['1101', '1102', '1201', '1301', '1302', '1303', '2101', '3101', '3201', '4101', '5101', '6101']) {
    assert.match(referenceMigration, new RegExp(`'${code}'`));
  }
  assert.match(referenceMigration, /'1301', 'Persediaan Bahan'/);
  assert.match(referenceMigration, /'2101', 'Utang Usaha'/);
  assert.match(accountingReference, /MAXI_ACCOUNTING_REFERENCE_V1/);
  assert.match(accountingReference, /accountingOwner: 'ACCOUNTING_MODULE'/);
  assert.match(accountingReference, /syncStatus: 'PROVISIONAL'/);
  assert.doesNotMatch(accountingReference, /INSERT INTO journal/i);
  assert.doesNotMatch(accountingReference, /debit_amount|credit_amount/i);
});

test('material purchase mapping slots are created but never auto-linked', () => {
  assert.match(referenceMigration, /'PURCHASE_MATERIAL', 'CASH'/);
  assert.match(referenceMigration, /'PURCHASE_MATERIAL', 'BANK'/);
  assert.match(referenceMigration, /'PURCHASE_MATERIAL', 'PAYABLE'/);
  assert.match(referenceMigration, /Debit\/credit stay NULL until explicitly configured/);
  assert.match(accountingReference, /Debit dan kredit wajib dipilih, berbeda/);
  assert.match(accountingReference, /status: 'NEEDS_MAPPING'/);
  assert.match(accountingReference, /ON CONFLICT\(store_id, business_event, payment_method\)/);
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

test('Average Cost and Last Purchase Price are automatic server-owned Product Master fields', () => {
  assert.match(costingMigration, /ALTER TABLE products ADD COLUMN average_cost REAL NOT NULL DEFAULT 0/);
  assert.match(costingMigration, /ALTER TABLE products ADD COLUMN last_purchase_price REAL NOT NULL DEFAULT 0/);
  assert.match(productMaster, /p\.average_cost, p\.last_purchase_price/);
  assert.match(productUi, /Average Cost · HPP berjalan/);
  assert.match(productUi, /Harga Beli Terakhir/);
  assert.match(productUi, /readonly/);
  assert.doesNotMatch(productMaster, /body\?\.averageCost|body\?\.lastPurchasePrice/);
});

test('Master Barang UI contains type kind unit points and recipe while fulfillment is removed', () => {
  assert.match(productUi, /Tipe Barang<select id="productItemType"/);
  assert.match(productUi, /Jenis Barang<select id="productKind"/);
  assert.match(productUi, /Satuan Dasar<select id="productBaseUnit"/);
  assert.match(productUi, /Poin per 1 barang/);
  assert.match(productUi, /Recipe Linked<select id="productLinkedRecipe"/);
  assert.doesNotMatch(productUi, /id="productProductionMode"/);
  assert.match(masterMenu, /data-master-target="productKindMasterCard">Jenis Barang/);
});

test('purchase is itemized and atomically snapshots accounting stock last price and moving average cost', () => {
  assert.match(cashierEnhancements, /<option value="CASH">Cash \/ Kas<\/option>/);
  assert.match(cashierEnhancements, /<option value="BANK">Bank \/ Transfer<\/option>/);
  assert.match(cashierEnhancements, /<option value="PAYABLE">Hutang \/ Utang Usaha<\/option>/);
  assert.match(cashierEnhancements, /purchaseItemsPayload/);
  assert.match(cashierPurchase, /PURCHASE_MATERIAL/);
  assert.match(cashierPurchase, /buildTransactionAccountingSnapshot/);
  assert.match(cashierPurchase, /INSERT INTO purchase_items/);
  assert.match(cashierPurchase, /average_cost_after/);
  assert.match(cashierPurchase, /last_purchase_price/);
  assert.match(cashierPurchase, /UPDATE inventory_stock_balances/);
  assert.match(cashierPurchase, /await env\.DB\.batch\(statements\)/);
  assert.match(cashierPurchase, /accounting\.statement/);
});

test('transaction mapping snapshot remains immutable evidence for purchase detail while journal stays external', () => {
  assert.match(accountingReference, /transaction_accounting_snapshots/);
  assert.match(accountingReference, /getTransactionAccountingSnapshot/);
  assert.match(purchaseDetail, /transactionLink: snapshot/);
  assert.match(purchaseDetail, /journalReference: null/);
  assert.match(purchaseDetail, /PURCHASE_MATERIAL/);
  assert.match(purchaseDetail, /averageCostBefore/);
  assert.match(purchaseDetail, /averageCostAfter/);
});

test('new focused handlers win before legacy generic routes', () => {
  const purchaseHandler = indexSource.indexOf('const purchaseResponse = await handleCashierPurchaseApi');
  const drawerHandler = indexSource.indexOf('const cashierDrawerResponse = await handleCashierDrawerApi');
  assert.ok(purchaseHandler >= 0 && purchaseHandler < drawerHandler);

  const productKindHandler = indexSource.indexOf('const productKindResponse = await handleProductKindApi');
  const genericAdminHandler = indexSource.indexOf("if (pathname.startsWith('/api/admin/')) return handleAdminApi");
  assert.ok(productKindHandler >= 0 && productKindHandler < genericAdminHandler);

  const purchaseDetailHandler = indexSource.indexOf('const adminPurchaseDetailResponse = await handleAdminPurchaseDetailApi');
  const genericDetailHandler = indexSource.indexOf('const adminTransactionDetailResponse = await handleAdminTransactionDetailApi');
  assert.ok(purchaseDetailHandler >= 0 && purchaseDetailHandler < genericDetailHandler);

  assert.match(productPolicy, /linked_recipe_id/);
  assert.match(productPolicy, /resolveLinkedRecipe/);
  assert.match(productPolicy, /legacyProductionMode/);
});
