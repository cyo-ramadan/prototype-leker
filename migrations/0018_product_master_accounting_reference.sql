PRAGMA foreign_keys = ON;

-- Product Master owns the explicit recipe selected for operational fulfillment.
ALTER TABLE products ADD COLUMN linked_recipe_id TEXT REFERENCES manufacturing_recipes(id);

UPDATE products
SET linked_recipe_id = (
  SELECT r.id
  FROM manufacturing_recipes r
  WHERE r.store_id = products.store_id
    AND r.output_product_id = products.id
    AND r.status = 'ACTIVE'
  ORDER BY r.revision DESC
  LIMIT 1
)
WHERE recipe_link_enabled = 1
  AND linked_recipe_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_store_linked_recipe
  ON products(store_id, linked_recipe_id);

CREATE TRIGGER IF NOT EXISTS trg_products_linked_recipe_scope_insert
BEFORE INSERT ON products
WHEN NEW.linked_recipe_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.id = NEW.linked_recipe_id
      AND r.store_id = NEW.store_id
      AND r.output_product_id = NEW.id
      AND r.status = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_RECIPE_LINK_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_linked_recipe_scope_update
BEFORE UPDATE OF store_id, linked_recipe_id ON products
WHEN NEW.linked_recipe_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.id = NEW.linked_recipe_id
      AND r.store_id = NEW.store_id
      AND r.output_product_id = NEW.id
      AND r.status = 'ACTIVE'
  )
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_RECIPE_LINK_MISMATCH');
END;

-- Immutable operational evidence only. Canonical account/rule configuration is created later
-- by the Accounting Settings migration; this table intentionally stores no debit/credit pair.
CREATE TABLE IF NOT EXISTS transaction_accounting_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  transaction_category_code TEXT NOT NULL,
  payment_method_code TEXT NOT NULL DEFAULT '',
  configuration_status TEXT NOT NULL CHECK (configuration_status IN ('COMPLETE','INCOMPLETE','CATEGORY_NOT_FOUND')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_accounting_snapshots_status
  ON transaction_accounting_snapshots(store_id, configuration_status, created_at DESC);
