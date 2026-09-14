import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  parseExpectedPhotos,
  verifyProductionRows,
} from '../scripts/verify-dermo-leker-drive-hires-production.mjs';

const migrationDir = new URL('../migrations/', import.meta.url);
const migrationFile = '0093_dermo_leker_drive_hires_photos.sql';
const migration = readFileSync(new URL(migrationFile, migrationDir), 'utf8');
const catalogMigration = readFileSync(
  new URL('0083_dermo_leker_catalog_and_recipes.sql', migrationDir),
  'utf8'
);
const skippedNames = [
  'Adonan Leker',
  'Leker Blueberry + Gula',
  'Leker Original',
];

function sourceRows() {
  return [...migration.matchAll(
    /INSERT INTO dermo_leker_photo_source_0093 \(product_name, drive_asset_name, image_data\) VALUES\s+\('([^']+)', '([^']+)', '(data:image\/webp;base64,[A-Za-z0-9+/=]+)'\);/g
  )].map(([, productName, assetName, imageData]) => ({
    productName,
    assetName,
    imageData,
  }));
}

function expectedProductNames() {
  const section = catalogMigration.match(
    /INSERT INTO dermo_leker_source_0083[\s\S]*?;\n\n-- Fail closed/
  );
  assert.ok(section, 'canonical Dermo catalog source exists');
  return [...section[0].matchAll(/\(\d+, '([^']+)', \d+\)/g)]
    .map(([, name]) => name)
    .filter(name => !skippedNames.includes(name));
}

function webpDimensions(bytes) {
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');

  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkType = bytes.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (chunkType === 'VP8 ') {
      assert.deepEqual(
        [...bytes.subarray(dataOffset + 3, dataOffset + 6)],
        [0x9d, 0x01, 0x2a]
      );
      return {
        width: bytes.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: bytes.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }
    if (chunkType === 'VP8X') {
      return {
        width: 1 + bytes.readUIntLE(dataOffset + 4, 3),
        height: 1 + bytes.readUIntLE(dataOffset + 7, 3),
      };
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  throw new Error('WebP dimension chunk not found');
}

function databaseBeforeMigration() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const files = readdirSync(migrationDir)
    .filter(name => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  for (const file of files) {
    if (file === migrationFile) break;
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function productsSnapshot(sqlite) {
  return sqlite.prepare('SELECT * FROM products ORDER BY store_id, id').all()
    .map(row => ({ ...row }));
}

function nonProductSnapshot(sqlite) {
  const tables = sqlite.prepare(`
    SELECT name
    FROM sqlite_schema
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name <> 'products'
    ORDER BY name
  `).all().map(row => row.name);
  const snapshot = {};
  for (const table of tables) {
    snapshot[table] = sqlite.prepare(`SELECT * FROM "${table}"`).all()
      .map(row => ({ ...row }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  return snapshot;
}

test('Dermo Drive photo update is name-based, store-scoped, and updates only image_data', () => {
  assert.match(migration, /store_id = 'store_dermo'/);
  assert.match(migration, /LOWER\(name\) LIKE '%leker%'/);
  assert.match(migration, /DOC-IMPACT: NOT_REQUIRED/);
  assert.doesNotMatch(migration, /(?:INSERT INTO|DELETE FROM) products/i);

  const update = migration.match(/UPDATE products\s+[\s\S]*?;\n/);
  assert.ok(update, 'products update statement exists');
  assert.match(update[0], /^UPDATE products\s+SET image_data =/);
  assert.doesNotMatch(
    update[0],
    /\b(?:updated_at|price|purchase_price|category|recipe|stock|hpp|journal|image_visual_key)\b/i
  );
  assert.doesNotMatch(update[0], /\bSET\s+[^;]*,/i);
});

test('Dermo Drive photo update maps the exact 71 approved products and skips three', () => {
  const rows = sourceRows();
  assert.equal(rows.length, 71);
  assert.equal(new Set(rows.map(row => row.productName)).size, 71);
  assert.equal(new Set(rows.map(row => row.assetName)).size, 71);
  assert.deepEqual(
    rows.map(row => row.productName).sort(),
    expectedProductNames().sort()
  );
  for (const skippedName of skippedNames) {
    assert.ok(!rows.some(row => row.productName === skippedName));
    assert.match(migration, new RegExp(skippedName.replaceAll('+', '\\+')));
  }

  const mappedAssets = new Map(rows.map(row => [row.productName, row.assetName]));
  assert.equal(mappedAssets.get('Leker BlueBand + Keju'), 'Blue Band + Keju.webp');
  assert.equal(mappedAssets.get('Leker BlueBand + Meses'), 'Blue Band + Meses.webp');
  assert.equal(mappedAssets.get('Leker Marsmellow'), 'Marshmallow.webp');
  assert.equal(mappedAssets.get('Leker Greentea + Keju'), 'Green Tea + Keju.webp');
  assert.equal(mappedAssets.get('Leker Greentea + Oreo + Keju'), 'Green Tea + Oreo + Keju.webp');
  assert.equal(mappedAssets.get('Leker Pisang + Greentea'), 'Pisang + Green Tea.webp');
  assert.equal(mappedAssets.get('Leker Nuttela + Mozarella'), 'Nutella + Mozarella.webp');
});

test('all 71 embedded images are valid mobile-ready 192x192 WebP files', () => {
  for (const row of sourceRows()) {
    const bytes = Buffer.from(row.imageData.split(',')[1], 'base64');
    assert.ok(bytes.length >= 3_500, `${row.assetName} is unexpectedly small`);
    assert.ok(bytes.length <= 6_500, `${row.assetName} is unexpectedly large`);
    assert.deepEqual(webpDimensions(bytes), { width: 192, height: 192 }, row.assetName);
  }
});

test('each Dermo Drive photo insert stays below 8 KiB', () => {
  const statements = migration.split(/;\s*(?:\n|$)/)
    .map(value => value.trim())
    .filter(Boolean);
  const photoInserts = statements.filter(value =>
    value.startsWith('INSERT INTO dermo_leker_photo_source_0093')
  );
  assert.equal(photoInserts.length, 71);
  assert.ok(photoInserts.every(statement => Buffer.byteLength(statement) < 8_192));
});

test('migration changes exactly 71 image_data values and leaves every other value untouched', () => {
  const sqlite = databaseBeforeMigration();
  try {
    const beforeProducts = productsSnapshot(sqlite);
    const beforeOtherTables = nonProductSnapshot(sqlite);
    const sourceByProduct = new Map(sourceRows().map(row => [row.productName, row.imageData]));
    const beforeByKey = new Map(beforeProducts.map(row => [`${row.store_id}\0${row.id}`, row]));
    const skippedBefore = new Map(skippedNames.map(name => [
      name,
      beforeProducts.find(row => row.store_id === 'store_dermo' && row.name === name),
    ]));

    sqlite.exec(migration);

    const afterProducts = productsSnapshot(sqlite);
    assert.equal(afterProducts.length, beforeProducts.length);
    let changedImages = 0;
    for (const after of afterProducts) {
      const before = beforeByKey.get(`${after.store_id}\0${after.id}`);
      assert.ok(before, `pre-migration product exists for ${after.store_id}/${after.id}`);
      const expectedImage = after.store_id === 'store_dermo'
        ? sourceByProduct.get(after.name)
        : undefined;
      if (expectedImage) {
        assert.notEqual(before.image_data, expectedImage, `${after.name} receives a new photo`);
        assert.equal(after.image_data, expectedImage, `${after.name} has the mapped photo`);
        const { image_data: beforeImage, ...beforeProtected } = before;
        const { image_data: afterImage, ...afterProtected } = after;
        assert.notEqual(beforeImage, afterImage);
        assert.deepEqual(afterProtected, beforeProtected, `${after.name} only changes image_data`);
        changedImages += 1;
      } else {
        assert.deepEqual(after, before, `${after.store_id}/${after.name} stays byte-for-byte stable`);
      }
    }
    assert.equal(changedImages, 71);
    for (const [name, before] of skippedBefore) {
      const after = afterProducts.find(row => row.store_id === 'store_dermo' && row.name === name);
      assert.ok(before && after, `${name} exists before and after`);
      assert.deepEqual(after, before, `${name} is explicitly skipped`);
    }
    assert.deepEqual(nonProductSnapshot(sqlite), beforeOtherTables);
    assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM products
        WHERE store_id = 'store_dermo' AND LOWER(name) LIKE '%leker%'
      `).get().count,
      74
    );
    assert.equal(
      sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_schema
        WHERE name LIKE 'dermo_leker_photo_%_0093'
      `).get().count,
      0
    );
  } finally {
    sqlite.close();
  }
});

test('migration fails closed when the current Dermo Leker name set drifts', () => {
  const sqlite = databaseBeforeMigration();
  try {
    sqlite.exec(`
      UPDATE products
      SET name = 'Renamed menu guard fixture'
      WHERE store_id = 'store_dermo' AND name = 'Leker Beng Beng';
    `);
    assert.throws(() => sqlite.exec(migration), /CHECK constraint failed/i);
  } finally {
    sqlite.close();
  }
});

test('production verifier requires migration 0093 and exact image payloads for all 71 products', () => {
  const expectedPhotos = parseExpectedPhotos(migration);
  const productRows = [
    ...expectedPhotos.map(photo => ({ name: photo.name, image_data: photo.imageData })),
    ...skippedNames.map(name => ({ name, image_data: `preserved:${name}` })),
  ];
  const evidence = verifyProductionRows({
    expectedPhotos,
    migrationRows: [{ name: migrationFile, applied_at: '2026-09-14T00:00:00.000Z' }],
    productRows,
  });
  assert.equal(evidence.mappedProducts, 71);
  assert.equal(evidence.nameMatchedLekerProducts, 74);
  assert.deepEqual(evidence.skipped, [...skippedNames].sort());

  const tamperedRows = productRows.map(row => row.name === expectedPhotos[0].name
    ? { ...row, image_data: `${row.image_data}tampered` }
    : row);
  assert.throws(
    () => verifyProductionRows({
      expectedPhotos,
      migrationRows: [{ name: migrationFile, applied_at: '2026-09-14T00:00:00.000Z' }],
      productRows: tamperedRows,
    }),
    /Production photo verification failed/
  );
});
