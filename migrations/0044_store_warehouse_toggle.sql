PRAGMA foreign_keys = ON;

-- Warehouse is the optional quantity-tracking module. Existing and new stores
-- keep today's behavior until an authorized store setting explicitly disables it.
ALTER TABLE stores ADD COLUMN warehouse_enabled INTEGER NOT NULL DEFAULT 1
  CHECK (warehouse_enabled IN (0, 1));

