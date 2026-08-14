PRAGMA foreign_keys = ON;

-- Admin-controlled default for all POS payment pickers.
ALTER TABLE payment_methods ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_one_active_default
  ON payment_methods(store_id)
  WHERE is_active = 1 AND is_default = 1;

UPDATE payment_methods
SET is_default = CASE WHEN code = 'CASH' THEN 1 ELSE 0 END,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('CASH', 'BANK', 'PAYABLE');

-- Piutang is available only as an explicit admin opt-in. On a purchase this means
-- offsetting a real supplier receivable, not creating ordinary purchase credit.
INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default)
SELECT 'payment_' || id || '_receivable_offset', id, 'RECEIVABLE_OFFSET',
       'Kompensasi Piutang (review)', 'coa_' || id || '_1201', 0, 0
FROM stores;

-- Every existing Jenis Barang receives a safe editable starting mapping.
-- Admin may change finished/semi-finished kinds to 1302/1303 from Setting Akuntansi.
INSERT OR IGNORE INTO item_categories (
  id, store_id, product_kind_id, name,
  inventory_account_id, cogs_account_id, revenue_account_id, is_active
)
SELECT 'itemcat_' || k.id, k.store_id, k.id, k.name,
       'coa_' || k.store_id || '_1301',
       'coa_' || k.store_id || '_5101',
       'coa_' || k.store_id || '_4101', 1
FROM product_kinds k;

-- Canonical purchase composition: inventory follows Jenis Barang; settlement follows payment method.
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || s.id || '_purchase_inventory', s.id, c.id,
       'Persediaan sesuai Jenis Barang', 'DEBIT', 'item_category_inventory', 10
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'purchase_material';

INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || s.id || '_purchase_payment', s.id, c.id,
       'Pembayaran / Hutang Pembelian', 'CREDIT', 'payment_method', 20
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'purchase_material';

CREATE TRIGGER IF NOT EXISTS trg_product_kinds_seed_accounting_mapping
AFTER INSERT ON product_kinds
BEGIN
  INSERT OR IGNORE INTO item_categories (
    id, store_id, product_kind_id, name,
    inventory_account_id, cogs_account_id, revenue_account_id, is_active
  ) VALUES (
    'itemcat_' || NEW.id, NEW.store_id, NEW.id, NEW.name,
    'coa_' || NEW.store_id || '_1301',
    'coa_' || NEW.store_id || '_5101',
    'coa_' || NEW.store_id || '_4101', 1
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_methods_cash_default_after_insert
AFTER INSERT ON payment_methods
WHEN NEW.code = 'CASH'
BEGIN
  UPDATE payment_methods SET is_default = CASE WHEN id = NEW.id THEN 1 ELSE 0 END
  WHERE store_id = NEW.store_id;
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default)
  VALUES ('payment_' || NEW.store_id || '_receivable_offset', NEW.store_id, 'RECEIVABLE_OFFSET', 'Kompensasi Piutang (review)', 'coa_' || NEW.store_id || '_1201', 0, 0);
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_category_rules_after_insert
AFTER INSERT ON transaction_categories
WHEN NEW.code = 'purchase_material'
BEGIN
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_purchase_inventory', NEW.store_id, NEW.id, 'Persediaan sesuai Jenis Barang', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_purchase_payment', NEW.store_id, NEW.id, 'Pembayaran / Hutang Pembelian', 'CREDIT', 'payment_method', 20);
END;
