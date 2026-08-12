import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0016_manufacturing_master_v1.sql', import.meta.url), 'utf8');
const manufacturingApi = readFileSync(new URL('../src/manufacturing-master.js', import.meta.url), 'utf8');
const classificationApi = readFileSync(new URL('../src/admin-product-classification.js', import.meta.url), 'utf8');
const productDb = readFileSync(new URL('../src/db-multistore.js', import.meta.url), 'utf8');
const transactionApi = readFileSync(new URL('../src/admin-transactions.js', import.meta.url), 'utf8');
const accountingSeam = readFileSync(new URL('../src/accounting-bridge-seam.js', import.meta.url), 'utf8');
const manufacturingUi = readFileSync(new URL('../public/admin-manufacturing.js', import.meta.url), 'utf8');
const transactionUi = readFileSync(new URL('../public/admin-transactions-ui.js', import.meta.url), 'utf8');
const branchAdmin = readFileSync(new URL('../public/branch-admin.html', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('manufacturing master schema separates types, units, recipe headers, and recipe components', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS item_types/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS units/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manufacturing_recipes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manufacturing_recipe_components/);
  assert.match(migration, /ALTER TABLE products ADD COLUMN item_type_id/);
  assert.match(migration, /ALTER TABLE products ADD COLUMN base_unit_id/);
  assert.match(migration, /output_quantity_milli INTEGER NOT NULL CHECK \(output_quantity_milli > 0\)/);
  assert.match(migration, /UNIQUE \(store_id, output_product_id, revision\)/);
  assert.match(migration, /WHERE status = 'ACTIVE'/);
});

test('default item types carry policy capabilities and raw material is not sellable', () => {
  assert.match(migration, /'FINISHED_GOOD', 'Barang Jadi', 1, 1, 1, 1, 1, 1/);
  assert.match(migration, /'RAW_MATERIAL', 'Bahan', 0, 1, 0, 1, 1, 1/);
  assert.match(migration, /'SEMI_FINISHED', 'Bahan Setengah Jadi', 0, 1, 1, 1, 1, 1/);
  assert.match(productDb, /COALESCE\(t\.can_sell, 1\) = 1/);
  assert.match(classificationApi, /itemTypeId/);
  assert.match(classificationApi, /baseUnitId/);
});

test('recipe writes create immutable revisions and reject circular BOMs', () => {
  assert.match(manufacturingApi, /recipeWouldCycle/);
  assert.match(manufacturingApi, /Circular|circular BOM/i);
  assert.match(manufacturingApi, /MAX\(revision\), 0\) \+ 1 AS next_revision/);
  assert.match(manufacturingApi, /SET status = 'ARCHIVED'/);
  assert.match(manufacturingApi, /INSERT INTO manufacturing_recipes/);
  assert.match(manufacturingApi, /INSERT INTO manufacturing_recipe_components/);
  assert.doesNotMatch(manufacturingApi, /UPDATE manufacturing_recipe_components\s+SET/);
});

test('admin manufacturing UI is modular and loaded without replacing existing admin listeners', () => {
  assert.match(branchAdmin, /admin-manufacturing\.js/);
  assert.match(manufacturingUi, /data-tab = 'manufacturing'|dataset\.tab = 'manufacturing'/);
  assert.match(manufacturingUi, /Klasifikasi Barang/);
  assert.match(manufacturingUi, /Buat Resep \/ BOM/);
  assert.match(manufacturingUi, /Simpan sebagai revision baru/);
  assert.doesNotMatch(manufacturingUi, /setInterval\s*\(/);
});

test('admin transaction explorer reads operational facts lazily and exposes accounting references only', () => {
  assert.match(branchAdmin, /admin-transactions-ui\.js/);
  assert.match(transactionApi, /WITH transaction_facts AS/);
  assert.match(transactionApi, /'SALE' AS kind/);
  assert.match(transactionApi, /'PURCHASE'/);
  assert.match(transactionApi, /'EXPENSE'/);
  assert.match(transactionApi, /'OTHER_INCOME'/);
  assert.match(transactionApi, /approval_requests/);
  assert.match(transactionApi, /accountingReferenceForTransaction/);
  assert.match(transactionUi, /Detail jurnal tetap menjadi domain Accounting/);
  assert.doesNotMatch(transactionUi, /setInterval\s*\(/);
});

test('accounting connector seam never owns journal interpretation', () => {
  assert.match(accountingSeam, /MAXI_ACCOUNTING_BUSINESS_FACT_V1/);
  assert.match(accountingSeam, /syncStatus: eligible \? 'NOT_CONNECTED' : 'NOT_POSTABLE'/);
  assert.match(accountingSeam, /journalReference: null/);
  assert.doesNotMatch(accountingSeam, /debit|credit|chart.?of.?accounts|general.?ledger/i);
  assert.doesNotMatch(accountingSeam, /fetch\s*\(/);
});

test('specific manufacturing routes are evaluated before generic admin route', () => {
  const classificationPosition = indexSource.indexOf('handleAdminProductClassificationApi');
  const manufacturingPosition = indexSource.indexOf('handleManufacturingMasterApi(request');
  const genericAdminPosition = indexSource.indexOf("if (pathname.startsWith('/api/admin/'))");
  assert.ok(classificationPosition >= 0 && manufacturingPosition >= 0 && genericAdminPosition >= 0);
  assert.ok(classificationPosition < genericAdminPosition);
  assert.ok(manufacturingPosition < genericAdminPosition);
});
