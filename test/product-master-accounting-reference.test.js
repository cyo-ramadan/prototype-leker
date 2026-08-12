import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0018_product_master_accounting_reference.sql', import.meta.url), 'utf8');
const productMaster = readFileSync(new URL('../src/product-master.js', import.meta.url), 'utf8');
const productPolicy = readFileSync(new URL('../src/product-policy.js', import.meta.url), 'utf8');
const accountingReference = readFileSync(new URL('../src/accounting-reference.js', import.meta.url), 'utf8');
const productUi = readFileSync(new URL('../public/admin-product-policy.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');

test('Product Master stores explicit recipe selection and separate accounting references', () => {
  assert.match(migration, /ALTER TABLE products ADD COLUMN linked_recipe_id/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS accounting_account_refs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS product_accounting_refs/);
  assert.match(migration, /PRODUCT_RECIPE_LINK_MISMATCH/);
  assert.match(migration, /PRODUCT_ACCOUNTING_REF_MISMATCH/);
});

test('basic accounting references exist without becoming a journal ledger', () => {
  for (const code of ['1101', '1102', '1201', '1301', '2101', '3101', '3201', '4101', '5101', '6101', '6201', '6301']) {
    assert.match(migration, new RegExp(`'${code}'`));
  }
  assert.match(accountingReference, /MAXI_ACCOUNTING_REFERENCE_V1/);
  assert.match(accountingReference, /accountingOwner: 'ACCOUNTING_MODULE'/);
  assert.match(accountingReference, /syncStatus: 'PROVISIONAL'/);
  assert.doesNotMatch(accountingReference, /INSERT INTO journal/i);
  assert.doesNotMatch(accountingReference, /debit_amount|credit_amount/i);
});

test('unified Product Master validates type unit recipe stock points and account references', () => {
  assert.match(productMaster, /getManufacturingReferenceData/);
  assert.match(productMaster, /resolveProductMasterReferences/);
  assert.match(productMaster, /resolveLinkedRecipe/);
  assert.match(productMaster, /resolveProductAccountingRefs/);
  assert.match(productMaster, /Poin barang harus bilangan bulat/);
  assert.match(productMaster, /Mode DADAKAN membutuhkan Recipe Linked/);
  assert.match(productMaster, /Satuan dasar tidak boleh diganti setelah barang punya resep atau histori stok/);
  assert.match(productMaster, /await env\.DB\.batch\(statements\)/);
});

test('Product Master UI consolidates item type unit points recipe and Accounting portal into the product form', () => {
  assert.match(productUi, /Tipe Barang<select id="productItemType"/);
  assert.match(productUi, /Satuan Dasar<select id="productBaseUnit"/);
  assert.match(productUi, /Poin per 1 barang/);
  assert.match(productUi, /Recipe Linked<select id="productLinkedRecipe"/);
  assert.match(productUi, /Portal Akuntansi Barang/);
  assert.match(productUi, /Akun Penjualan/);
  assert.match(productUi, /Akun Persediaan/);
  assert.match(productUi, /Akun HPP/);
  assert.match(productUi, /form\.addEventListener\('submit', saveProductMaster, true\)/);
  assert.doesNotMatch(productUi, /productPolicyCard/);
});

test('technical master keeps type unit recipe while duplicate product classification is hidden compatibly', () => {
  assert.match(productUi, /Tipe Barang, Satuan & Resep/);
  assert.match(productUi, /classificationCard\.style\.display = 'none'/);
  assert.doesNotMatch(productUi, /classificationCard\?\.remove/);
});

test('Accounting reference portal is an Admin connector surface and Product Master route wins before generic admin', () => {
  assert.match(productUi, /button\.textContent = 'Akuntansi'/);
  assert.match(productUi, /Portal Referensi Akun/);
  assert.match(productUi, /Tidak ada jurnal yang dibuat dari panel ini/);
  const productMasterRoute = indexSource.indexOf('handleProductMasterApi');
  const genericAdminRoute = indexSource.indexOf("if (pathname.startsWith('/api/admin/'))");
  assert.ok(productMasterRoute >= 0 && productMasterRoute < genericAdminRoute);
  assert.match(productPolicy, /linked_recipe_id/);
  assert.match(productPolicy, /resolveLinkedRecipe/);
});
