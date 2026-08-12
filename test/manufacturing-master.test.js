import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/0016_manufacturing_master_v1.sql', import.meta.url), 'utf8');
const moduleSource = readFileSync(new URL('../src/manufacturing-master.js', import.meta.url), 'utf8');
const classificationSource = readFileSync(new URL('../src/admin-product-classification.js', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../src/db-multistore.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../public/admin-manufacturing.js', import.meta.url), 'utf8');
const contract = readFileSync(new URL('../contracts/manufacturing-master-v1.md', import.meta.url), 'utf8');

test('manufacturing master creates type, unit, recipe and component entities', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS item_types/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS units/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manufacturing_recipes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS manufacturing_recipe_components/);
  assert.match(migration, /FINISHED_GOOD/);
  assert.match(migration, /RAW_MATERIAL/);
  assert.match(migration, /SEMI_FINISHED/);
});

test('legacy and new products get safe finished-good plus PCS defaults', () => {
  assert.match(migration, /UPDATE products[\s\S]*FINISHED_GOOD/);
  assert.match(migration, /UPDATE products[\s\S]*code = 'PCS'/);
  assert.match(migration, /trg_products_default_manufacturing_metadata/);
  assert.match(migration, /trg_stores_seed_manufacturing_defaults/);
});

test('product classification is store-scoped and exposed through a dedicated API', () => {
  assert.match(migration, /PRODUCT_MASTER_SCOPE_MISMATCH/);
  assert.match(classificationSource, /resolveProductMasterReferences/);
  assert.match(classificationSource, /WHERE id = \? AND store_id = \?/);
  assert.match(uiSource, /data-save-classification/);
});

test('sellability capability is enforced in reads and database writes', () => {
  assert.match(dbSource, /COALESCE\(t\.can_sell, 1\) = 1/);
  assert.match(migration, /trg_sale_items_requires_sellable_product/);
  assert.match(migration, /trg_order_items_requires_sellable_product/);
  assert.match(migration, /PRODUCT_NOT_SELLABLE/);
  assert.match(contract, /RAW_MATERIAL.*can_sell = false/s);
});

test('recipe updates create immutable revisions and reject circular BOMs', () => {
  assert.match(moduleSource, /MAX\(revision\)/);
  assert.match(moduleSource, /status = 'ARCHIVED'/);
  assert.match(moduleSource, /recipeWouldCycle/);
  assert.match(moduleSource, /circular BOM/i);
  assert.match(migration, /idx_manufacturing_recipe_one_active_output/);
});

test('recipe and stock physical quantities stay integer with smallest-unit semantics', () => {
  assert.match(migration, /decimal_scale INTEGER NOT NULL DEFAULT 0 CHECK \(decimal_scale = 0\)/);
  assert.match(migration, /output_quantity INTEGER NOT NULL CHECK \(output_quantity > 0\)/);
  assert.match(migration, /quantity INTEGER NOT NULL CHECK \(quantity > 0\)/);
  assert.match(moduleSource, /Number\.isInteger\(number\)/);
  assert.match(moduleSource, /Satuan wajib memakai qty bulat/);
  assert.match(moduleSource, /output\.base_unit_id/);
  assert.match(moduleSource, /product\.base_unit_id/);
  assert.doesNotMatch(migration, /quantity_milli|output_quantity_milli/);
});
