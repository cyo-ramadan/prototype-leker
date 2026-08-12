import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0018_product_master_accounting_reference.sql', import.meta.url), 'utf8');
const productMaster = readFileSync(new URL('../src/product-master.js', import.meta.url), 'utf8');
const productPolicy = readFileSync(new URL('../src/product-policy.js', import.meta.url), 'utf8');
const accountingReference = readFileSync(new URL('../src/accounting-reference.js', import.meta.url), 'utf8');
const cashierPurchase = readFileSync(new URL('../src/cashier-purchase.js', import.meta.url), 'utf8');
const purchaseDetail = readFileSync(new URL('../src/admin-purchase-detail.js', import.meta.url), 'utf8');
const productUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const cashierEnhancements = readFileSync(new URL('../public/cashier-enhancements.js', import.meta.url), 'utf8');
const masterMenu = readFileSync(new URL('../public/admin-master-menu.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('Product Master owns explicit recipe link while Accounting linkage is transaction-owned', () => {
  assert.match(migration, /ALTER TABLE products ADD COLUMN linked_recipe_id/);
  assert.match(migration, /PRODUCT_RECIPE_LINK_MISMATCH/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting_account_refs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS transaction_accounting_mappings/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS transaction_accounting_snapshots/);
  assert.doesNotMatch(migration, /CREATE TABLE IF NOT EXISTS product_accounting_refs/);
});

test('basic Accounting references include inventory material cash bank payable and stay provisional', () => {
  for (const code of ['1101', '1102', '1201', '1301', '1302', '1303', '2101', '3101', '3201', '4101', '5101', '6101']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.match(migration, /'1301', 'Persediaan Bahan'/);
  assert.match(migration, /'2101', 'Utang Usaha'/);
  assert.match(accountingReference, /MAXI_ACCOUNTING_REFERENCE_V1/);
  assert.match(accountingReference, /accountingOwner: 'ACCOUNTING_MODULE'/);
  assert.match(accountingReference, /syncStatus: 'PROVISIONAL'/);
  assert.doesNotMatch(accountingReference, /INSERT INTO journal/i);
  assert.doesNotMatch(accountingReference, /debit_amount|credit_amount/i);
});

test('material purchase mapping slots are created but never auto-linked', () => {
  assert.match(migration, /'PURCHASE_MATERIAL', 'CASH'/);
  assert.match(migration, /'PURCHASE_MATERIAL', 'BANK'/);
  assert.match(migration, /'PURCHASE_MATERIAL', 'PAYABLE'/);
  assert.match(migration, /Debit\/credit stay NULL until explicitly configured/);
  assert.match(accountingReference, /Debit dan kredit wajib dipilih, berbeda/);
  assert.match(accountingReference, /status: 'NEEDS_MAPPING'/);
  assert.match(accountingReference, /ON CONFLICT\(store_id, business_event, payment_method\)/);
});

test('unified Product Master validates type unit points stock mode and recipe without owning journal accounts', () => {
  assert.match(productMaster, /getManufacturingReferenceData/);
  assert.match(productMaster, /resolveProductMasterReferences/);
  assert.match(productMaster, /resolveLinkedRecipe/);
  assert.match(productMaster, /Poin barang harus bilangan bulat/);
  assert.match(productMaster, /Mode DADAKAN membutuhkan Recipe Linked/);
  assert.match(productMaster, /Satuan dasar tidak boleh diganti setelah barang punya resep atau histori stok/);
  assert.doesNotMatch(productMaster, /AccountingAccount|productAccounting|salesAccountRef|cogsAccountRef/);
});

test('Master Barang UI contains type unit points and recipe, while Accounting portal is transaction mapping', () => {
  assert.match(productUi, /Tipe Barang<select id="productItemType"/);
  assert.match(productUi, /Satuan Dasar<select id="productBaseUnit"/);
  assert.match(productUi, /Poin per 1 barang/);
  assert.match(productUi, /Recipe Linked<select id="productLinkedRecipe"/);
  assert.match(productUi, /Portal Link Akuntansi/);
  assert.match(productUi, /Jenis transaksi<select id="accountingBusinessEvent"/);
  assert.match(productUi, /Cara bayar<select id="accountingPaymentMethod"/);
  assert.match(productUi, /Debit<select id="accountingDebitAccount"/);
  assert.match(productUi, /Kredit<select id="accountingCreditAccount"/);
  assert.doesNotMatch(productUi, /productSalesAccount|productInventoryAccount|productCogsAccount/);
  assert.match(masterMenu, /data-master-open="products">Master Barang/);
});

test('purchase accepts cash bank payable and snapshots selected Accounting mapping atomically', () => {
  assert.match(cashierEnhancements, /<option value="CASH">Cash \/ Kas<\/option>/);
  assert.match(cashierEnhancements, /<option value="BANK">Bank \/ Transfer<\/option>/);
  assert.match(cashierEnhancements, /<option value="PAYABLE">Hutang \/ Utang Usaha<\/option>/);
  assert.match(cashierPurchase, /PURCHASE_MATERIAL/);
  assert.match(cashierPurchase, /buildTransactionAccountingSnapshot/);
  assert.match(cashierPurchase, /await env\.DB\.batch\(\[/);
  assert.match(cashierPurchase, /accounting\.statement/);
});

test('transaction mapping snapshot is immutable evidence for purchase detail while journal remains external', () => {
  assert.match(accountingReference, /Immutable connector snapshot/);
  assert.match(accountingReference, /getTransactionAccountingSnapshot/);
  assert.match(purchaseDetail, /transactionLink: snapshot/);
  assert.match(purchaseDetail, /journalReference: null/);
  assert.match(purchaseDetail, /PURCHASE_MATERIAL/);
});

test('new focused handlers win before legacy generic routes', () => {
  const purchaseHandler = indexSource.indexOf('const purchaseResponse = await handleCashierPurchaseApi');
  const drawerHandler = indexSource.indexOf('const cashierDrawerResponse = await handleCashierDrawerApi');
  assert.ok(purchaseHandler >= 0 && purchaseHandler < drawerHandler);

  const purchaseDetailHandler = indexSource.indexOf('const adminPurchaseDetailResponse = await handleAdminPurchaseDetailApi');
  const genericDetailHandler = indexSource.indexOf('const adminTransactionDetailResponse = await handleAdminTransactionDetailApi');
  assert.ok(purchaseDetailHandler >= 0 && purchaseDetailHandler < genericDetailHandler);

  assert.match(productPolicy, /linked_recipe_id/);
  assert.match(productPolicy, /resolveLinkedRecipe/);
});
