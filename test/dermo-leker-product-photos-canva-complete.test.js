import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../migrations/0089_dermo_leker_product_photos_canva_complete.sql', import.meta.url), 'utf8');

test('Dermo Canva photo completion selects products by name containing Leker, never category', () => {
  assert.match(migration, /store_id = 'store_dermo'/);
  assert.match(migration, /LOWER\(name\) LIKE '%leker%'/);
  assert.doesNotMatch(migration, /category\s*=/i);
  assert.doesNotMatch(migration, /manufacturing_recipes|recipe_/i);
});

test('Dermo Canva photo completion maps and verifies all 73 current Leker names', () => {
  const sourceSection = migration.match(/CREATE TABLE dermo_leker_photo_source_0089[\s\S]*?-- Fail closed/);
  assert.ok(sourceSection);
  const insertBlocks = [...sourceSection[0].matchAll(/INSERT INTO dermo_leker_photo_source_0089[\s\S]*?VALUES([\s\S]*?);/g)];
  assert.equal(insertBlocks.length, 10);
  const names = [...sourceSection[0].matchAll(/^  \('([^']+)'/gm)].map(match => match[1]);
  assert.equal(names.length, 73);
  assert.equal(new Set(names).size, 73);
  assert.ok(names.every(name => name.toLowerCase().includes('leker')));
  assert.ok(names.some(name => name.toLowerCase().includes('blueberry')));
  assert.ok(names.some(name => name.toLowerCase().includes('strawberry')));
  assert.match(migration, /canva_asset_name TEXT NOT NULL UNIQUE/);
  assert.match(migration, /JOIN dermo_leker_photo_source_0089 s/);
  assert.match(migration, /p\.name = 'Adonan Leker'/);
  assert.match(migration, /LOWER\(name\) LIKE '%leker%'[\s\S]*?\) = 74/);
});

test('Dermo Canva photo inserts stay below the D1 per-statement size boundary', () => {
  const statements = migration.split(/;\s*(?:\n|$)/).map(value => value.trim()).filter(Boolean);
  const photoInserts = statements.filter(value => value.startsWith('INSERT INTO dermo_leker_photo_source_0089'));
  assert.equal(photoInserts.length, 10);
  assert.ok(photoInserts.every(value => Buffer.byteLength(value) < 20_000));
});
