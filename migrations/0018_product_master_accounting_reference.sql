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

-- Connector-side account references only. Canonical COA and journal posting remain owned by Accounting.
CREATE TABLE IF NOT EXISTS accounting_account_refs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  is_postable INTEGER NOT NULL DEFAULT 1 CHECK (is_postable IN (0, 1)),
  external_account_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'PROVISIONAL' CHECK (sync_status IN ('PROVISIONAL','MAPPED','INACTIVE')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_account_refs_store_type
  ON accounting_account_refs(store_id, account_type, is_active, code);

-- Rules link one operational business event + payment method to an Accounting debit/credit reference pair.
-- They do not create journals inside Prototype Leker.
CREATE TABLE IF NOT EXISTS transaction_accounting_mappings (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  business_event TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'ANY' CHECK (payment_method IN ('ANY','CASH','BANK','PAYABLE','NON_CASH')),
  debit_account_ref_id TEXT,
  credit_account_ref_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEEDS_MAPPING' CHECK (status IN ('ACTIVE','NEEDS_MAPPING','INACTIVE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (debit_account_ref_id) REFERENCES accounting_account_refs(id),
  FOREIGN KEY (credit_account_ref_id) REFERENCES accounting_account_refs(id),
  UNIQUE (store_id, business_event, payment_method)
);

CREATE INDEX IF NOT EXISTS idx_transaction_accounting_mappings_lookup
  ON transaction_accounting_mappings(store_id, business_event, payment_method, status);

-- Immutable connector snapshot captured when an operational fact is created.
-- If the mapping is changed later, historical transactions retain the reference used at posting time.
CREATE TABLE IF NOT EXISTS transaction_accounting_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  business_event TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  mapping_id TEXT,
  debit_account_ref_id TEXT,
  credit_account_ref_id TEXT,
  mapping_status TEXT NOT NULL CHECK (mapping_status IN ('MAPPED','NEEDS_MAPPING')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (mapping_id) REFERENCES transaction_accounting_mappings(id),
  FOREIGN KEY (debit_account_ref_id) REFERENCES accounting_account_refs(id),
  FOREIGN KEY (credit_account_ref_id) REFERENCES accounting_account_refs(id),
  UNIQUE (store_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_accounting_snapshots_status
  ON transaction_accounting_snapshots(store_id, mapping_status, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_transaction_accounting_mapping_scope_insert
BEFORE INSERT ON transaction_accounting_mappings
WHEN (NEW.debit_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.debit_account_ref_id AND a.store_id = NEW.store_id AND a.is_active = 1 AND a.is_postable = 1
      ))
   OR (NEW.credit_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.credit_account_ref_id AND a.store_id = NEW.store_id AND a.is_active = 1 AND a.is_postable = 1
      ))
   OR (NEW.debit_account_ref_id IS NOT NULL AND NEW.debit_account_ref_id = NEW.credit_account_ref_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_ACCOUNTING_MAPPING_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_transaction_accounting_mapping_scope_update
BEFORE UPDATE OF store_id, debit_account_ref_id, credit_account_ref_id ON transaction_accounting_mappings
WHEN (NEW.debit_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.debit_account_ref_id AND a.store_id = NEW.store_id AND a.is_active = 1 AND a.is_postable = 1
      ))
   OR (NEW.credit_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.credit_account_ref_id AND a.store_id = NEW.store_id AND a.is_active = 1 AND a.is_postable = 1
      ))
   OR (NEW.debit_account_ref_id IS NOT NULL AND NEW.debit_account_ref_id = NEW.credit_account_ref_id)
BEGIN
  SELECT RAISE(ABORT, 'TRANSACTION_ACCOUNTING_MAPPING_MISMATCH');
END;

-- Basic provisional reference list. Nothing is auto-linked.
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1101', id, '1101', 'Kas', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1102', id, '1102', 'Bank', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1201', id, '1201', 'Piutang Usaha', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1301', id, '1301', 'Persediaan Bahan', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1302', id, '1302', 'Persediaan Bahan Setengah Jadi', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1303', id, '1303', 'Persediaan Barang Jadi', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_2101', id, '2101', 'Utang Usaha', 'LIABILITY' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_3101', id, '3101', 'Modal', 'EQUITY' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_3201', id, '3201', 'Laba Ditahan', 'EQUITY' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_4101', id, '4101', 'Penjualan', 'REVENUE' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_5101', id, '5101', 'Harga Pokok Penjualan', 'EXPENSE' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_6101', id, '6101', 'Beban Operasional', 'EXPENSE' FROM stores;

-- Seed mapping slots only. Debit/credit stay NULL until explicitly configured by management.
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_purchase_material_cash', id, 'PURCHASE_MATERIAL', 'CASH' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_purchase_material_bank', id, 'PURCHASE_MATERIAL', 'BANK' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_purchase_material_payable', id, 'PURCHASE_MATERIAL', 'PAYABLE' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_sale_cash', id, 'SALE_REVENUE', 'CASH' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_sale_bank', id, 'SALE_REVENUE', 'BANK' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_expense_cash', id, 'EXPENSE', 'CASH' FROM stores;
INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method)
SELECT 'acctmap_' || id || '_expense_bank', id, 'EXPENSE', 'BANK' FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_reference_defaults
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1101', NEW.id, '1101', 'Kas', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1102', NEW.id, '1102', 'Bank', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1201', NEW.id, '1201', 'Piutang Usaha', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1301', NEW.id, '1301', 'Persediaan Bahan', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1302', NEW.id, '1302', 'Persediaan Bahan Setengah Jadi', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1303', NEW.id, '1303', 'Persediaan Barang Jadi', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_2101', NEW.id, '2101', 'Utang Usaha', 'LIABILITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_3101', NEW.id, '3101', 'Modal', 'EQUITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_3201', NEW.id, '3201', 'Laba Ditahan', 'EQUITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_4101', NEW.id, '4101', 'Penjualan', 'REVENUE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_5101', NEW.id, '5101', 'Harga Pokok Penjualan', 'EXPENSE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_6101', NEW.id, '6101', 'Beban Operasional', 'EXPENSE');

  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_purchase_material_cash', NEW.id, 'PURCHASE_MATERIAL', 'CASH');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_purchase_material_bank', NEW.id, 'PURCHASE_MATERIAL', 'BANK');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_purchase_material_payable', NEW.id, 'PURCHASE_MATERIAL', 'PAYABLE');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_sale_cash', NEW.id, 'SALE_REVENUE', 'CASH');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_sale_bank', NEW.id, 'SALE_REVENUE', 'BANK');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_expense_cash', NEW.id, 'EXPENSE', 'CASH');
  INSERT OR IGNORE INTO transaction_accounting_mappings (id, store_id, business_event, payment_method) VALUES ('acctmap_' || NEW.id || '_expense_bank', NEW.id, 'EXPENSE', 'BANK');
END;
