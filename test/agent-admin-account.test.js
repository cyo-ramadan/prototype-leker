import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// 2026-09-16, Bos Cyo: awalnya minta "jalur kusus untuk agent edit2
// aplikasi", dan migration 0095 menjawabnya dengan akun Entity Admin
// (`entityadmin_hana`). Bos Cyo lalu mengoreksi: akun itu tetap login
// lewat UI/endpoint dan tabel session yang sama dengan Entity Admin
// manusia -- bukan jalur terpisah walau cuma agen yang pakai ("yang aku
// inginkan jalur kusus untuk agent edit ya, bukan jalur manusia").
// Migration 0096 mematikan baris ini (is_active = 0); jalur yang benar
// sekarang Bearer-token-vs-secret env Worker, lihat
// test/agent-admin-token.test.js dan AGENT_ADMIN_IDENTITY di
// src/owner-auth.js.
//
// Tes ini sengaja TIDAK menyentuh password plaintext-nya sama sekali --
// cuma membuktikan baris lama sudah nonaktif, bukan dihapus (migration
// tidak boleh ditulis ulang, dan menghapus baris berarti UPDATE 0096 jadi
// tidak berlaku pada baris yang tidak ada).

const migrationDir = new URL('../migrations/', import.meta.url);

function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of readdirSync(migrationDir).filter(name => /^\d{4}_.+\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(file, migrationDir), 'utf8'));
  }
  return db;
}

test('superseded entityadmin_hana row is deactivated, not deleted, and carries no live session', () => {
  const sqlite = migratedDatabase();
  try {
    const rows = sqlite.prepare(`SELECT id, entity_id, username, display_name, is_active, password_hash FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE`).all();
    assert.equal(rows.length, 1, 'row from migration 0095 must still exist (migrations are additive, never rewritten)');
    const row = rows[0];
    assert.equal(row.entity_id, 'ENT-KPM');
    assert.equal(row.is_active, 0, 'migration 0096 must have deactivated this row');
    assert.match(row.password_hash, /^[0-9a-f]{64}$/, 'password_hash must be a 64-char lowercase hex SHA-256 digest, not a plaintext leftover');

    const sessions = sqlite.prepare(`SELECT COUNT(*) AS n FROM entity_admin_sessions WHERE entity_admin_id = ?`).get(row.id);
    assert.equal(sessions.n, 0, 'migration 0096 must have revoked any session for this account');
  } finally {
    sqlite.close();
  }
});

test('migration 0095 stays untouched (additive, idempotent) and 0096 only UPDATEs/DELETEs rows scoped to entityadmin_hana', () => {
  const source0095 = readFileSync(new URL('../migrations/0095_kpm_entity_admin_hana_agent.sql', import.meta.url), 'utf8');
  assert.match(source0095, /WHERE NOT EXISTS \(SELECT 1 FROM entity_admins WHERE username = 'entityadmin_hana' COLLATE NOCASE\)/);
  assert.doesNotMatch(source0095, /DROP TABLE|DELETE FROM entity_admins|UPDATE entity_admins/, 'migration 0095 itself must remain purely additive');

  const source0096 = readFileSync(new URL('../migrations/0096_retire_entity_admin_hana_agent.sql', import.meta.url), 'utf8');
  assert.match(source0096, /UPDATE entity_admins/);
  assert.match(source0096, /WHERE username = 'entityadmin_hana' COLLATE NOCASE/);
  assert.doesNotMatch(source0096, /DROP TABLE/);
});
