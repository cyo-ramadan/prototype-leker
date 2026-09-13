import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/0086_dermo_leker_master_visuals.sql', import.meta.url), 'utf8');
const menuDb = await readFile(new URL('../src/db-multistore.js', import.meta.url), 'utf8');
const contract = await readFile(new URL('../contracts/product-master-accounting-reference-v5.md', import.meta.url), 'utf8');

test('Dermo Leker visual migration adds a Product Master fallback without overwriting curated Dermo images', () => {
  assert.match(migration, /ALTER TABLE products ADD COLUMN image_visual_key TEXT/);
  assert.match(migration, /CREATE TABLE dermo_leker_visual_source_0086/);
  assert.match(migration, /'Leker Susu Coklat'/);
  assert.match(migration, /'Leker Original'/);
  assert.match(migration, /d\.store_id = 'store_dermo'/);
  assert.match(migration, /p\.store_id = 'store_pendem'/);
  assert.match(migration, /COALESCE\(TRIM\(d\.image_data\), ''\) = ''/);
  assert.match(migration, /image_visual_key = 'LEKER_V1:' \|\| name/);
  assert.match(migration, /SELECT COUNT\(\*\) FROM dermo_leker_visual_source_0086\) = 73/);
  assert.match(migration, /dermo_master_visual_verify_0086/);
});

test('public menu carries Product Master visual reference for menu and Roda consumers', () => {
  assert.match(menuDb, /p\.image_data, p\.image_visual_key/);
  assert.match(menuDb, /imageData: row\.image_data \|\| ''/);
  assert.match(menuDb, /imageVisualKey: row\.image_visual_key \|\| ''/);
});

test('Product Master v5 locks explicit image precedence and keeps storage provider out of scope', () => {
  assert.match(contract, /image_data.*authoritative/s);
  assert.match(contract, /image_visual_key.*built-in visual reference/s);
  assert.match(contract, /prefer `imageData` first and then resolve `imageVisualKey`/);
  assert.match(contract, /does not imply R2/);
  assert.match(contract, /Sparse PATCH behavior from v4 remains unchanged/);
});
