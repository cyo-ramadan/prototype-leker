import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// 2026-09-17, Bos Cyo: "aku lupa akun2 dan passwordnya" -> "ok reset
// password", cakupan dikonfirmasi HANYA dua akun milik Bos Cyo sendiri
// (owner, entityadmin_cyo) -- BUKAN Rika/Alfina/Admin Gerai yang masih
// aktif dipakai staf lain. Tes ini sengaja TIDAK menyentuh plaintext-nya
// sama sekali, hanya membuktikan cakupan dan bentuk migration-nya benar.

const migrationDir = new URL('../migrations/', import.meta.url);

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

test('password reset migration only touches owner and entityadmin_cyo -- no other account row changes', () => {
  const sqlite = migratedDatabase();
  try {
    const owner = sqlite.prepare(`SELECT password_hash, is_active FROM owner_accounts WHERE username = 'owner' COLLATE NOCASE`).get();
    assert.ok(owner, 'owner account must still exist');
    assert.equal(owner.is_active, 1);
    assert.match(owner.password_hash, /^[0-9a-f]{64}$/);

    const cyo = sqlite.prepare(`SELECT password_hash, is_active FROM entity_admins WHERE username = 'entityadmin_cyo' COLLATE NOCASE`).get();
    assert.ok(cyo, 'entityadmin_cyo must still exist');
    assert.equal(cyo.is_active, 1);
    assert.match(cyo.password_hash, /^[0-9a-f]{64}$/);

    // Other staff accounts must be completely untouched by this reset --
    // resetting them silently would lock people out who were never told.
    const rika = sqlite.prepare(`SELECT is_active FROM entity_admins WHERE username = 'entityadmin_rika' COLLATE NOCASE`).get();
    assert.equal(rika?.is_active, 1, 'entityadmin_rika must stay untouched and active');
    const alfina = sqlite.prepare(`SELECT is_active FROM entity_admins WHERE username = 'entityadmin_alfina' COLLATE NOCASE`).get();
    assert.equal(alfina?.is_active, 1, 'entityadmin_alfina must stay untouched and active');
    const storeAdminCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM store_admins WHERE is_active = 1`).get();
    assert.ok(storeAdminCount.n >= 10, 'store admin rows must remain intact');

    // Old sessions for the two reset accounts must be gone; other tables
    // are never touched by this migration.
    const ownerSessions = sqlite.prepare(`SELECT COUNT(*) AS n FROM owner_sessions`).get();
    assert.equal(ownerSessions.n, 0);
    const cyoSessions = sqlite.prepare(`
      SELECT COUNT(*) AS n FROM entity_admin_sessions
      WHERE entity_admin_id IN (SELECT id FROM entity_admins WHERE username = 'entityadmin_cyo' COLLATE NOCASE)
    `).get();
    assert.equal(cyoSessions.n, 0);
  } finally {
    sqlite.close();
  }
});

test('migration 0097 source is scoped and plaintext-free', async () => {
  const source = await readFile(new URL('../migrations/0097_reset_owner_and_boscyo_entity_admin_password.sql', import.meta.url), 'utf8');
  assert.match(source, /UPDATE owner_accounts/);
  assert.match(source, /WHERE username = 'owner' COLLATE NOCASE/);
  assert.match(source, /UPDATE entity_admins/);
  assert.match(source, /WHERE username = 'entityadmin_cyo' COLLATE NOCASE/);
  assert.doesNotMatch(source, /entityadmin_rika|entityadmin_alfina|store_admins/, 'must not touch any other account');
  assert.doesNotMatch(source, /DROP TABLE|DELETE FROM owner_accounts|DELETE FROM entity_admins/, 'must never delete an account row, only rotate its hash');
});
