import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const migrationDir = new URL('../migrations/', import.meta.url);
const gameSource = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

function freshDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    sqlite.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return sqlite;
}

function columns(sqlite, table) {
  return sqlite.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name);
}

function foreignKeyTables(sqlite, table) {
  return sqlite.prepare(`PRAGMA foreign_key_list("${table}")`).all().map(row => row.table).sort();
}

test('GAME is defined in the platform registry without auto-enrolling any Tenant', () => {
  const sqlite = freshDatabase();
  const module = sqlite.prepare(`SELECT code, module_kind FROM platform_modules WHERE code = 'GAME'`).get();
  assert.deepEqual(module, { code: 'GAME', module_kind: 'HORIZONTAL' });

  const installations = sqlite.prepare(`SELECT COUNT(*) AS n FROM tenant_module_installations WHERE module_code = 'GAME'`).get().n;
  assert.equal(installations, 0, 'schema migration must not provision GAME to a Tenant');
});

test('tenant module entitlement keeps periods and allows only one open GAME installation', () => {
  const sqlite = freshDatabase();
  sqlite.prepare(`
    INSERT INTO tenant_module_installations (
      id, tenant_id, module_code, effective_from, reason, created_by_role, created_by_id
    ) VALUES (?, ?, 'GAME', ?, ?, ?, ?)
  `).run('TMI-GAME-1', 'TEN-PROTOTYPE', '2026-09-09T00:00:00Z', 'test enable', 'OWNER', 'owner-test');

  assert.throws(() => sqlite.prepare(`
    INSERT INTO tenant_module_installations (
      id, tenant_id, module_code, effective_from, reason, created_by_role, created_by_id
    ) VALUES (?, ?, 'GAME', ?, ?, ?, ?)
  `).run('TMI-GAME-DUP', 'TEN-PROTOTYPE', '2026-09-09T01:00:00Z', 'duplicate', 'OWNER', 'owner-test'), /UNIQUE|constraint/i);

  sqlite.prepare(`
    UPDATE tenant_module_installations
    SET effective_to = ?, closed_by_role = 'OWNER', closed_by_id = 'owner-test'
    WHERE id = 'TMI-GAME-1'
  `).run('2026-09-10T00:00:00Z');

  sqlite.prepare(`
    INSERT INTO tenant_module_installations (
      id, tenant_id, module_code, effective_from, reason, created_by_role, created_by_id
    ) VALUES (?, ?, 'GAME', ?, ?, ?, ?)
  `).run('TMI-GAME-2', 'TEN-PROTOTYPE', '2026-09-11T00:00:00Z', 'test re-enable', 'OWNER', 'owner-test');

  const history = sqlite.prepare(`
    SELECT id, effective_to FROM tenant_module_installations
    WHERE tenant_id = 'TEN-PROTOTYPE' AND module_code = 'GAME'
    ORDER BY effective_from
  `).all();
  assert.equal(history.length, 2);
  assert.equal(history[0].effective_to, '2026-09-10T00:00:00Z');
  assert.equal(history[1].effective_to, null);

  assert.throws(
    () => sqlite.prepare(`UPDATE tenant_module_installations SET effective_to = ? WHERE id = 'TMI-GAME-1'`).run('2026-09-12T00:00:00Z'),
    /CLOSED_IMMUTABLE/
  );
  assert.throws(
    () => sqlite.prepare(`DELETE FROM tenant_module_installations WHERE id = 'TMI-GAME-1'`).run(),
    /DELETE_FORBIDDEN/
  );
});

test('Game outcome schema is provider-neutral and storage-agnostic', () => {
  const sqlite = freshDatabase();
  const outcomeColumns = columns(sqlite, 'game_outcomes');
  assert.ok(outcomeColumns.includes('reward_key'));
  assert.ok(outcomeColumns.includes('artwork_ref'));
  assert.ok(!outcomeColumns.includes('voucher_master_id'));
  assert.ok(!outcomeColumns.includes('product_id'));
  assert.ok(!outcomeColumns.includes('voucher_instance_id'));

  const referenced = foreignKeyTables(sqlite, 'game_outcomes');
  assert.deepEqual(referenced, ['game_campaigns']);
});

test('Game facts anchor to Store/Entity rather than mutable Tenant ownership', () => {
  const sqlite = freshDatabase();
  assert.ok(!columns(sqlite, 'game_campaigns').includes('tenant_id'));
  assert.ok(!columns(sqlite, 'game_plays').includes('tenant_id'));
  assert.ok(columns(sqlite, 'game_plays').includes('player_ref'));
});

test('Game source has one module entry point and no direct reward-provider import', () => {
  assert.match(gameSource, /export async function handleGameApi\(/);
  assert.match(gameSource, /MODULE_NOT_INSTALLED/);
  assert.match(gameSource, /\/api\/game\/manifest/);
  assert.doesNotMatch(gameSource, /from ['"].*voucher\.js['"]/i);
  assert.doesNotMatch(gameSource, /from ['"].*product/i);
  assert.doesNotMatch(gameSource, /from ['"].*accounting/i);
});
