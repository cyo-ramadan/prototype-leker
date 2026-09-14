import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extractWranglerD1Rows } from './verify-remote-schema.mjs';

export const PHOTO_MIGRATION = '0093_dermo_leker_drive_hires_photos.sql';
export const EXPECTED_SKIPS = Object.freeze([
  'Adonan Leker',
  'Leker Blueberry + Gula',
  'Leker Original',
]);
const WRANGLER_TIMEOUT_MS = 120_000;

export function parseExpectedPhotos(sql) {
  return [...sql.matchAll(
    /INSERT INTO dermo_leker_photo_source_0093 \(product_name, drive_asset_name, image_data\) VALUES\s+\('([^']+)', '([^']+)', '(data:image\/webp;base64,[A-Za-z0-9+/=]+)'\);/g
  )].map(([, name, assetName, imageData]) => ({ name, assetName, imageData }));
}

export function verifyProductionRows({ expectedPhotos, migrationRows, productRows }) {
  if (expectedPhotos.length !== 71) {
    throw new Error(`Repository mapping must contain 71 photos; found ${expectedPhotos.length}.`);
  }
  if (migrationRows.length !== 1 || migrationRows[0]?.name !== PHOTO_MIGRATION) {
    throw new Error(`Production D1 has not recorded ${PHOTO_MIGRATION}.`);
  }
  if (productRows.length !== 74) {
    throw new Error(`Production Dermo must contain 74 name-matched Leker rows; found ${productRows.length}.`);
  }

  const expectedByName = new Map(expectedPhotos.map(photo => [photo.name, photo]));
  if (expectedByName.size !== 71) throw new Error('Repository photo mapping contains duplicate product names.');
  const productionByName = new Map(productRows.map(row => [row.name, row]));
  if (productionByName.size !== 74) throw new Error('Production Dermo Leker names are not unique.');

  const missing = [];
  const mismatched = [];
  for (const [name, expected] of expectedByName) {
    const actual = productionByName.get(name);
    if (!actual) {
      missing.push(name);
      continue;
    }
    if (actual.image_data !== expected.imageData) {
      mismatched.push({
        name,
        assetName: expected.assetName,
        expectedLength: expected.imageData.length,
        actualLength: String(actual.image_data || '').length,
      });
    }
  }
  if (missing.length || mismatched.length) {
    throw new Error(`Production photo verification failed: ${JSON.stringify({ missing, mismatched })}`);
  }

  const skipped = productRows
    .filter(row => !expectedByName.has(row.name))
    .map(row => row.name)
    .sort();
  if (JSON.stringify(skipped) !== JSON.stringify([...EXPECTED_SKIPS].sort())) {
    throw new Error(`Production skip set drifted: ${JSON.stringify(skipped)}.`);
  }

  return {
    migration: PHOTO_MIGRATION,
    appliedAt: migrationRows[0].applied_at,
    mappedProducts: expectedPhotos.length,
    nameMatchedLekerProducts: productRows.length,
    skipped,
  };
}

function executeRemoteD1(sql) {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(executable, [
    '--yes', 'wrangler', 'd1', 'execute', 'DB', '--remote', '--yes', '--json', '--command', sql,
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: WRANGLER_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    maxBuffer: 4 * 1024 * 1024,
  });

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      throw new Error(`Remote D1 photo verification exceeded ${WRANGLER_TIMEOUT_MS / 1000}s.`);
    }
    throw new Error(`Remote D1 photo verification could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Remote D1 photo verification failed.');
  }
  try {
    return extractWranglerD1Rows(JSON.parse(result.stdout));
  } catch {
    throw new Error('Remote D1 photo verification returned non-JSON output.');
  }
}

function verifyProduction() {
  const migrationSql = readFileSync(
    new URL(`../migrations/${PHOTO_MIGRATION}`, import.meta.url),
    'utf8'
  );
  const expectedPhotos = parseExpectedPhotos(migrationSql);
  const migrationRows = executeRemoteD1(`
    SELECT name, applied_at
    FROM d1_migrations
    WHERE name = '${PHOTO_MIGRATION}';
  `);
  const productRows = executeRemoteD1(`
    SELECT name, image_data
    FROM products
    WHERE store_id = 'store_dermo'
      AND LOWER(name) LIKE '%leker%'
    ORDER BY name;
  `);
  const evidence = verifyProductionRows({ expectedPhotos, migrationRows, productRows });
  console.log(`DERMO_LEKER_HIRES_PRODUCTION_VERIFY=${JSON.stringify(evidence)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    verifyProduction();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
