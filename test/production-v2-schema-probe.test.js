import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const probe = readFileSync(new URL('../scripts/probe-production-v2-remote-schema-temp.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('Production V2 remote schema probe is read-only and checks migration 0039 columns', () => {
  assert.match(probe, /PRAGMA table_info/);
  for (const column of [
    'template_modified',
    'output_product_kind_id',
    'output_product_kind_code',
    'output_product_kind_name',
    'component_product_kind_id',
    'component_product_kind_code',
    'component_product_kind_name'
  ]) assert.match(probe, new RegExp(column));
  assert.doesNotMatch(probe, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  assert.doesNotMatch(probe, /wrangler\(\['deploy'\]|wrangler',\s*'deploy'|\bdeploy\b.*--/i);
});

test('temporary deploy command routes only to the read-only probe', () => {
  assert.equal(packageJson.scripts.deploy, 'node scripts/probe-production-v2-remote-schema-temp.mjs');
});
