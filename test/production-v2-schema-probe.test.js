import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const probe = readFileSync(new URL('../scripts/probe-production-v2-remote-schema-temp.mjs', import.meta.url), 'utf8');
const partialProbe = readFileSync(new URL('../scripts/probe-production-v2-zero-target-columns-temp.mjs', import.meta.url), 'utf8');
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
});

test('Production V2 partial-schema probe is read-only and only distinguishes zero target columns from partial schema', () => {
  assert.match(partialProbe, /PRAGMA table_info/);
  assert.match(partialProbe, /PRODUCTION_V2_ZERO_TARGET_COLUMNS_CONFIRMED/);
  assert.match(partialProbe, /PRODUCTION_V2_PARTIAL_SCHEMA_PRESENT/);
  assert.doesNotMatch(partialProbe, /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
});

test('temporary deploy remains a bounded Production V2 recovery/probe command', () => {
  assert.equal([
    'node scripts/deploy-production-v2-migration-recovery-temp.mjs',
    'node scripts/probe-production-v2-remote-schema-temp.mjs',
    'node scripts/probe-production-v2-d1-connectivity-temp.mjs',
    'node scripts/probe-production-v2-migration-state-temp.mjs',
    'node scripts/probe-production-v2-zero-target-columns-temp.mjs'
  ].includes(packageJson.scripts.deploy), true);
});
