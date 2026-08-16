PRAGMA foreign_keys = ON;

-- `purchase_price` already exists from the original Product Master schema.
-- Bootstrap only missing master defaults from real purchase evidence, then keep
-- the editable master default independent from future transaction-owned costs.
UPDATE products
SET purchase_price = CAST((last_purchase_price + 500000) / 1000000 AS INTEGER),
    updated_at = CURRENT_TIMESTAMP
WHERE purchase_price = 0
  AND last_purchase_price > 0
  AND last_purchase_at IS NOT NULL;
