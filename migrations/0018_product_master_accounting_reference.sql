PRAGMA foreign_keys = ON;

-- Product Master owns the explicit recipe selected for operational fulfillment.
-- The recipe remains an immutable Manufacturing Master revision.
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

-- Connector-side account references only. These rows are not the Accounting ledger/COA
-- source of truth and never create journal lines inside Prototype Leker.
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

CREATE TABLE IF NOT EXISTS product_accounting_refs (
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  sales_account_ref_id TEXT,
  inventory_account_ref_id TEXT,
  cogs_account_ref_id TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, product_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (sales_account_ref_id) REFERENCES accounting_account_refs(id),
  FOREIGN KEY (inventory_account_ref_id) REFERENCES accounting_account_refs(id),
  FOREIGN KEY (cogs_account_ref_id) REFERENCES accounting_account_refs(id)
);

CREATE TRIGGER IF NOT EXISTS trg_product_accounting_refs_scope_insert
BEFORE INSERT ON product_accounting_refs
WHEN (NEW.sales_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.sales_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'REVENUE' AND a.is_active = 1
      ))
   OR (NEW.inventory_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.inventory_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'ASSET' AND a.is_active = 1
      ))
   OR (NEW.cogs_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.cogs_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'EXPENSE' AND a.is_active = 1
      ))
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_ACCOUNTING_REF_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_product_accounting_refs_scope_update
BEFORE UPDATE OF store_id, sales_account_ref_id, inventory_account_ref_id, cogs_account_ref_id ON product_accounting_refs
WHEN (NEW.sales_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.sales_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'REVENUE' AND a.is_active = 1
      ))
   OR (NEW.inventory_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.inventory_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'ASSET' AND a.is_active = 1
      ))
   OR (NEW.cogs_account_ref_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM accounting_account_refs a
        WHERE a.id = NEW.cogs_account_ref_id AND a.store_id = NEW.store_id AND a.account_type = 'EXPENSE' AND a.is_active = 1
      ))
BEGIN
  SELECT RAISE(ABORT, 'PRODUCT_ACCOUNTING_REF_MISMATCH');
END;

-- Basic provisional references requested for mapping preparation.
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1101', id, '1101', 'Kas', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1102', id, '1102', 'Bank', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1201', id, '1201', 'Piutang Usaha', 'ASSET' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_1301', id, '1301', 'Persediaan', 'ASSET' FROM stores;
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
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_6201', id, '6201', 'Beban Gaji', 'EXPENSE' FROM stores;
INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type)
SELECT 'acctref_' || id || '_6301', id, '6301', 'Beban Utilitas', 'EXPENSE' FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_reference_defaults
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1101', NEW.id, '1101', 'Kas', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1102', NEW.id, '1102', 'Bank', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1201', NEW.id, '1201', 'Piutang Usaha', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_1301', NEW.id, '1301', 'Persediaan', 'ASSET');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_2101', NEW.id, '2101', 'Utang Usaha', 'LIABILITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_3101', NEW.id, '3101', 'Modal', 'EQUITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_3201', NEW.id, '3201', 'Laba Ditahan', 'EQUITY');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_4101', NEW.id, '4101', 'Penjualan', 'REVENUE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_5101', NEW.id, '5101', 'Harga Pokok Penjualan', 'EXPENSE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_6101', NEW.id, '6101', 'Beban Operasional', 'EXPENSE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_6201', NEW.id, '6201', 'Beban Gaji', 'EXPENSE');
  INSERT OR IGNORE INTO accounting_account_refs (id, store_id, code, name, account_type) VALUES ('acctref_' || NEW.id || '_6301', NEW.id, '6301', 'Beban Utilitas', 'EXPENSE');
END;
