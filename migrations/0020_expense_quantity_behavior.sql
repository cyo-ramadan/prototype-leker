PRAGMA foreign_keys = ON;

-- Operational expense quantity is behavioral metadata, not inventory stock.
-- Store it as canonical decimal text so future non-integer quantities do not require another schema change.
ALTER TABLE expenses ADD COLUMN quantity TEXT NOT NULL DEFAULT '1';

CREATE INDEX IF NOT EXISTS idx_expenses_store_created_quantity
  ON expenses(store_id, created_at DESC, quantity);
