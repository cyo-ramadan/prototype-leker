import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// 2026-09-16, Bos Cyo: "mending bikin jalur sendiri, pake admin hana gitu
// lo, jadi itu jalur kusus untuk agent edit2 aplikasi" -- agen sekarang
// punya kredensial Entity Admin sendiri (migration 0095), scoped ke
// ENT-KPM (entity yang sama dengan akun Bos Cyo sendiri, migration 0090),
// supaya nulis lewat /api/admin/* tidak perlu pinjam PIN admin manusia.
// Tes ini sengaja TIDAK menyentuh password plaintext-nya sama sekali --
// cuma membuktikan bentuk barisnya benar (hash 64 hex char, entity yang
// benar, aktif, idempotent).

const migrationDir = new URL('../migrations/', import.meta.url);

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

test('agent Entity Admin account exists, scoped to ENT-KPM, with a real SHA-256 password hash (never asserted in plaintext)', () => {
  const sqlite = migratedDatabase();
  try {
    const rows = sqlite.prepare(`SELECT id, entity_id, username, display_name, is_active, password_hash FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE`).all();
    assert.equal(rows.length, 1, 'exactly one agent admin row, not zero and not duplicated');
    const row = rows[0];
    assert.equal(row.entity_id, 'ENT-KPM');
    assert.equal(row.is_active, 1);
    assert.match(row.password_hash, /^[0-9a-f]{64}$/, 'password_hash must be a 64-char lowercase hex SHA-256 digest, not a plaintext leftover');
    assert.notEqual(row.id, null);

    // ENT-KPM must actually exist and be the same entity Dermo belongs to --
    // this account is only useful if it can reach the stores agents work on.
    const entity = sqlite.prepare(`SELECT id, status FROM entities WHERE id = 'ENT-KPM'`).get();
    assert.equal(entity?.status, 'ACTIVE');
    const dermo = sqlite.prepare(`SELECT entity_id FROM stores WHERE code = 'DERMO'`).get();
    if (dermo) assert.equal(dermo.entity_id, 'ENT-KPM', 'Dermo must be inside the entity this agent account is scoped to');
  } finally {
    sqlite.close();
  }
});

test('the migration is idempotent: applying it conceptually twice would not create a duplicate (guarded by WHERE NOT EXISTS)', () => {
  const source = readFileSync(new URL('../migrations/0095_kpm_entity_admin_hana_agent.sql', import.meta.url), 'utf8');
  assert.match(source, /WHERE NOT EXISTS \(SELECT 1 FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE\)/);
  assert.doesNotMatch(source, /DROP TABLE|DELETE FROM entity_admins|UPDATE entity_admins/, 'must be purely additive, must not touch any existing entity_admins row');
});
