PRAGMA foreign_keys = ON;

-- MAXI-STORE-PROVISIONING-GAP-20260822
--
-- Migration 0040 backfilled the single RAW_MATERIAL product kind for stores
-- that already existed and provisioned future stores indirectly through the
-- `sale` transaction-category seed. That coupling is fragile: store creation
-- must establish its POS-owned product classification independently of
-- Accounting category seeds or store edition.
--
-- Keep 0040 and 0045 immutable. This additive trigger is deliberately narrow
-- and idempotent so every newly inserted store owns the canonical default kind.
CREATE TRIGGER IF NOT EXISTS trg_stores_seed_raw_material_product_kind
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES (
    'product_kind_' || NEW.id || '_raw_material',
    NEW.id,
    'RAW_MATERIAL',
    'Bahan Baku'
  );
END;
