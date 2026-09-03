PRAGMA foreign_keys = ON;

-- Entity Admin: satu tingkat akses baru di antara Store Admin (1 gerai) dan
-- Owner (semua gerai) -- login sekali, pilih gerai mana pun di bawah
-- Entity-nya, baca/tulis panel admin gerai itu tanpa perlu ganti kredensial
-- per gerai (beda dari Store Admin yang terkunci ke 1 store_id).
CREATE TABLE IF NOT EXISTS entity_admins (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE TABLE IF NOT EXISTS entity_admin_sessions (
  token_hash TEXT PRIMARY KEY,
  entity_admin_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (entity_admin_id) REFERENCES entity_admins(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entity_admins_entity_active
  ON entity_admins(entity_id, is_active, display_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_entity_admin_sessions_expiry
  ON entity_admin_sessions(expires_at);
