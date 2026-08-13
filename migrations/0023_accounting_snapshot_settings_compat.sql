PRAGMA foreign_keys = ON;

-- Forward-compatible bridge from the provisional 0018 pair-mapping snapshot to
-- the canonical Accounting Settings registry introduced in 0022.
-- Parent migration history is preserved so PR #4 may be deployed independently.
ALTER TABLE transaction_accounting_snapshots ADD COLUMN transaction_category_code TEXT NOT NULL DEFAULT '';
ALTER TABLE transaction_accounting_snapshots ADD COLUMN payment_method_code TEXT NOT NULL DEFAULT '';
ALTER TABLE transaction_accounting_snapshots ADD COLUMN configuration_status TEXT NOT NULL DEFAULT 'INCOMPLETE'
  CHECK (configuration_status IN ('COMPLETE','INCOMPLETE','CATEGORY_NOT_FOUND'));

UPDATE transaction_accounting_snapshots
SET transaction_category_code = CASE UPPER(business_event)
      WHEN 'PURCHASE_MATERIAL' THEN 'purchase_material'
      WHEN 'SALE_REVENUE' THEN 'sale'
      WHEN 'EXPENSE' THEN 'operational'
      WHEN 'OTHER_INCOME' THEN 'other_income'
      WHEN 'PAYROLL' THEN 'payroll'
      WHEN 'DEPOSIT' THEN 'deposit'
      WHEN 'WH_TRANSFER' THEN 'wh_transfer'
      WHEN 'WH_OPNAME' THEN 'wh_opname'
      WHEN 'WH_PRODUCTION' THEN 'wh_production'
      WHEN 'WH_RETURN' THEN 'wh_return'
      ELSE LOWER(business_event)
    END,
    payment_method_code = payment_method,
    configuration_status = CASE mapping_status WHEN 'MAPPED' THEN 'COMPLETE' ELSE 'INCOMPLETE' END
WHERE transaction_category_code = '';

CREATE INDEX IF NOT EXISTS idx_transaction_accounting_snapshots_configuration
  ON transaction_accounting_snapshots(store_id, configuration_status, created_at DESC);

-- Keep the legacy tables for historical compatibility, but prevent new stores from
-- receiving obsolete provisional account references and pair-mapping slots.
DROP TRIGGER IF EXISTS trg_stores_seed_accounting_reference_defaults;
