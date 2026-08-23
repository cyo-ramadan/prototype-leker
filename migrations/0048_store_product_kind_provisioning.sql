PRAGMA foreign_keys = ON;

-- MAXI-STORE-PROVISIONING-GAP-20260822
--
-- Migration 0040 backfilled the canonical RAW_MATERIAL product kind for stores
-- that already existed, then provisioned future ACCOUNTING stores indirectly
-- from the `sale` transaction-category seed. After stores.edition (0045),
-- LITE/FLEXIBLE intentionally no longer receive that Accounting category seed,
-- so store provisioning needs a POS-owned anchor shared by every edition.
--
-- Do not seed the kind directly from AFTER INSERT ON stores. Migration 0040
-- deliberately avoided that timing because Accounting stores have not finished
-- creating their Chart of Accounts yet; creating a product kind there can fire
-- trg_product_kinds_seed_accounting_mapping before its account prerequisites
-- exist and fail with ITEM_CATEGORY_SCOPE_MISMATCH.
--
-- CASH is POS Core identity and is provisioned for ACCOUNTING, FLEXIBLE, and
-- LITE stores. By the time CASH is inserted, ACCOUNTING stores have created the
-- prerequisite accounts, while the 0045 edition gate prevents LITE/FLEXIBLE
-- kinds from creating Accounting item_categories. The trigger is idempotent and
-- does not depend on transaction_categories or Accounting readiness.
CREATE TRIGGER IF NOT EXISTS trg_payment_methods_seed_raw_material_product_kind
AFTER INSERT ON payment_methods
WHEN NEW.code = 'CASH'
  AND NOT EXISTS (
    SELECT 1
    FROM product_kinds k
    WHERE k.store_id = NEW.store_id
      AND k.code = 'RAW_MATERIAL'
  )
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES (
    'product_kind_' || NEW.store_id || '_raw_material',
    NEW.store_id,
    'RAW_MATERIAL',
    'Bahan Baku'
  );
END;
