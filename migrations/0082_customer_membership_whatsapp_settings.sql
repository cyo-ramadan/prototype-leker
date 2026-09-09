PRAGMA foreign_keys = ON;

-- Store-scoped destination for the free/manual WhatsApp member-verification flow.
-- Store Admin edits only its own Store; Entity Admin may edit Stores in its Entity
-- through the existing requireManagement Store-scope guard.
CREATE TABLE IF NOT EXISTS customer_membership_settings (
  store_id TEXT PRIMARY KEY,
  registration_whatsapp_number TEXT NOT NULL DEFAULT '',
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);
