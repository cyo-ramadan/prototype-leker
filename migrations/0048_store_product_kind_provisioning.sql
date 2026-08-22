PRAGMA foreign_keys = ON;

-- IKAN-STORE-PROVISIONING-GAP-01
-- Backfill the single operational product kind for stores that were created
-- after 0040 but do not receive Accounting transaction-category seeds.
INSERT INTO product_kinds (id, store_id, code, name)
SELECT 'product_kind_' || s.id || '_raw_material', s.id, 'RAW_MATERIAL', 'Bahan Baku'
FROM stores s
WHERE NOT EXISTS (
  SELECT 1
  FROM product_kinds k
  WHERE k.store_id = s.id AND k.code = 'RAW_MATERIAL'
);

-- ACCOUNTING stores already receive RAW_MATERIAL through the existing `sale`
-- category trigger from 0040 after their chart of accounts is seeded. LITE and
-- FLEXIBLE stores do not create Accounting categories, so seed their operational
-- product kind directly when the store is created. Keeping ACCOUNTING out of this
-- trigger also avoids firing its accounting-mapping trigger before COA seeding.
CREATE TRIGGER IF NOT EXISTS trg_stores_seed_operational_product_kind
AFTER INSERT ON stores
WHEN NEW.edition IN ('LITE', 'FLEXIBLE')
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES ('product_kind_' || NEW.id || '_raw_material', NEW.id, 'RAW_MATERIAL', 'Bahan Baku');
END;
