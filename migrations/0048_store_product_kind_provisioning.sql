PRAGMA foreign_keys = ON;

-- IKAN-STORE-PROVISIONING-GAP-01
--
-- Store creation already provisions at least one CASH payment method in every
-- edition. That point is late enough for ACCOUNTING stores to have their COA,
-- while LITE/FLEXIBLE stores can still receive the operational classification
-- without requiring Accounting transaction categories.
--
-- The trigger deliberately does not reference stores.edition. This keeps the
-- migration compatible with historical migration-isolation tests that apply
-- the post-0045 chain against the pre-edition stores schema.
CREATE TRIGGER IF NOT EXISTS trg_payment_methods_seed_operational_product_kind
AFTER INSERT ON payment_methods
WHEN NEW.code = 'CASH'
  AND NOT EXISTS (
    SELECT 1
    FROM product_kinds k
    WHERE k.store_id = NEW.store_id AND k.code = 'RAW_MATERIAL'
  )
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES ('product_kind_' || NEW.store_id || '_raw_material', NEW.store_id, 'RAW_MATERIAL', 'Bahan Baku');
END;
