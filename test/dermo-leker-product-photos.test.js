import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stageSql = await readFile(new URL('../migrations/0087_dermo_leker_product_photos_canva_stage.sql', import.meta.url), 'utf8');
const applySql = await readFile(new URL('../migrations/0088_dermo_leker_product_photos_canva_apply.sql', import.meta.url), 'utf8');
const combinedSql = `${stageSql}\n${applySql}`;

const approvedNames = [
  'Leker Susu Coklat',
  'Leker Susu Vanila',
  'Leker Meses',
  'Leker Keju',
  'Leker Blueberry',
  'Leker Strawberry',
  'Leker Blue Band',
  'Leker Blueberry + Meses',
  'Leker Gula Aren',
  'Leker Oreo',
  'Leker Blueberry + Gula',
  'Leker Choco Chips',
  'Leker Strawberry + Meses',
  'Leker Strawberry + Gula',
  'Leker Green Tea',
  'Leker BlueBand + Keju',
  'Leker Cappucino',
];

test('Canva Dermo photo refresh stages exactly the 17 approved clean assets', () => {
  const stagedNames = [...combinedSql.matchAll(/\('((?:''|[^'])+)', 'data:image\/webp;base64,/g)]
    .map(match => match[1].replaceAll("''", "'"));

  assert.equal(stagedNames.length, 17);
  assert.deepEqual(new Set(stagedNames), new Set(approvedNames));
});

test('photo mutation is scoped to canonical Dermo Leker outputs only', () => {
  assert.ok(applySql.includes("WHERE store_id = 'store_dermo'"));
  assert.ok(applySql.includes("r.id LIKE 'dermo_leker_recipe_%'"));
  assert.ok(applySql.includes("r.created_by_id = 'migration_0083'"));
  assert.ok(applySql.includes('(SELECT COUNT(*) FROM dermo_leker_photo_source_0087) = 17'));
  assert.ok(applySql.includes(') = 73'));
});

test('unmatched canonical Dermo Leker photos are intentionally cleared', () => {
  assert.ok(applySql.includes("SET image_data = COALESCE(("));
  assert.ok(applySql.includes("), ''),"));
  assert.ok(applySql.includes("AND NOT EXISTS (\n        SELECT 1 FROM dermo_leker_photo_source_0087 s WHERE s.product_name = p.name"));
  assert.ok(applySql.includes("AND COALESCE(p.image_data, '') <> ''"));
});
