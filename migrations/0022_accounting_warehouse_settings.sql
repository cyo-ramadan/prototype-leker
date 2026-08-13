PRAGMA foreign_keys = ON;

-- Canonical local settings registry for Prototype Leker.
-- Accounting settings configure references/rules only; no journal posting engine is created here.

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  subtype TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  review_required INTEGER NOT NULL DEFAULT 0 CHECK (review_required IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_chart_of_accounts_store_type_active
  ON chart_of_accounts(store_id, type, is_active, code);

CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS item_categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_kind_id TEXT NOT NULL,
  name TEXT NOT NULL,
  inventory_account_id TEXT NOT NULL,
  cogs_account_id TEXT NOT NULL,
  revenue_account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_kind_id) REFERENCES product_kinds(id) ON DELETE RESTRICT,
  FOREIGN KEY (inventory_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (cogs_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (revenue_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (store_id, product_kind_id),
  UNIQUE (store_id, name)
);

CREATE TABLE IF NOT EXISTS transaction_categories (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  involves_payment INTEGER NOT NULL DEFAULT 0 CHECK (involves_payment IN (0, 1)),
  involves_item_category INTEGER NOT NULL DEFAULT 0 CHECK (involves_item_category IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  registered_by_module TEXT NOT NULL DEFAULT 'ACCOUNTING' CHECK (registered_by_module IN ('ACCOUNTING','WAREHOUSE')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code)
);

CREATE INDEX IF NOT EXISTS idx_transaction_categories_store_active
  ON transaction_categories(store_id, is_active, registered_by_module, code);

CREATE TABLE IF NOT EXISTS journal_rules (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  transaction_category_id TEXT NOT NULL,
  label TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  source_type TEXT NOT NULL CHECK (source_type IN (
    'fixed_account',
    'payment_method',
    'item_category_inventory',
    'item_category_cogs',
    'item_category_revenue',
    'cost_center_cash'
  )),
  fixed_account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (transaction_category_id) REFERENCES transaction_categories(id) ON DELETE CASCADE,
  FOREIGN KEY (fixed_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  CHECK (
    (source_type = 'fixed_account' AND fixed_account_id IS NOT NULL)
    OR (source_type <> 'fixed_account' AND fixed_account_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_journal_rules_category_order
  ON journal_rules(store_id, transaction_category_id, is_active, sort_order, id);

-- Warehouse settings own operational warehouse configuration only.
CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  location_name TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, code),
  UNIQUE (store_id, name)
);

CREATE INDEX IF NOT EXISTS idx_warehouses_store_active
  ON warehouses(store_id, is_active, name COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS warehouse_access (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('ADMIN','CASHIER')),
  principal_id TEXT NOT NULL,
  principal_name_snapshot TEXT NOT NULL,
  can_stock_opname INTEGER NOT NULL DEFAULT 0 CHECK (can_stock_opname IN (0, 1)),
  can_transfer INTEGER NOT NULL DEFAULT 0 CHECK (can_transfer IN (0, 1)),
  can_receive INTEGER NOT NULL DEFAULT 0 CHECK (can_receive IN (0, 1)),
  can_issue INTEGER NOT NULL DEFAULT 0 CHECK (can_issue IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  UNIQUE (warehouse_id, principal_type, principal_id)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_access_store_principal
  ON warehouse_access(store_id, principal_type, principal_id, is_active);

CREATE TABLE IF NOT EXISTS warehouse_stock_opname_settings (
  warehouse_id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  quantity_tolerance TEXT NOT NULL DEFAULT '0',
  percentage_tolerance_bps INTEGER NOT NULL DEFAULT 0 CHECK (percentage_tolerance_bps BETWEEN 0 AND 10000),
  schedule_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (schedule_type IN ('MANUAL','DAILY','WEEKLY','MONTHLY')),
  schedule_day INTEGER CHECK (schedule_day IS NULL OR schedule_day BETWEEN 1 AND 31),
  requires_approval INTEGER NOT NULL DEFAULT 1 CHECK (requires_approval IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

-- Scope guards keep store-local settings references deterministic.
CREATE TRIGGER IF NOT EXISTS trg_payment_method_account_scope_insert
BEFORE INSERT ON payment_methods
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_METHOD_ACCOUNT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_method_account_scope_update
BEFORE UPDATE OF store_id, account_id ON payment_methods
WHEN NEW.account_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_METHOD_ACCOUNT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_item_category_scope_insert
BEFORE INSERT ON item_categories
WHEN NOT EXISTS (
       SELECT 1 FROM product_kinds k WHERE k.id = NEW.product_kind_id AND k.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.inventory_account_id AND a.store_id = NEW.store_id AND a.type = 'ASSET'
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.cogs_account_id AND a.store_id = NEW.store_id AND a.type = 'EXPENSE'
     )
   OR (NEW.revenue_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.revenue_account_id AND a.store_id = NEW.store_id AND a.type = 'REVENUE'
     ))
BEGIN
  SELECT RAISE(ABORT, 'ITEM_CATEGORY_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_item_category_scope_update
BEFORE UPDATE OF store_id, product_kind_id, inventory_account_id, cogs_account_id, revenue_account_id ON item_categories
WHEN NOT EXISTS (
       SELECT 1 FROM product_kinds k WHERE k.id = NEW.product_kind_id AND k.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.inventory_account_id AND a.store_id = NEW.store_id AND a.type = 'ASSET'
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.cogs_account_id AND a.store_id = NEW.store_id AND a.type = 'EXPENSE'
     )
   OR (NEW.revenue_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.revenue_account_id AND a.store_id = NEW.store_id AND a.type = 'REVENUE'
     ))
BEGIN
  SELECT RAISE(ABORT, 'ITEM_CATEGORY_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_rule_scope_insert
BEFORE INSERT ON journal_rules
WHEN NOT EXISTS (
       SELECT 1 FROM transaction_categories c WHERE c.id = NEW.transaction_category_id AND c.store_id = NEW.store_id
     )
   OR (NEW.fixed_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.fixed_account_id AND a.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_RULE_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_journal_rule_scope_update
BEFORE UPDATE OF store_id, transaction_category_id, fixed_account_id ON journal_rules
WHEN NOT EXISTS (
       SELECT 1 FROM transaction_categories c WHERE c.id = NEW.transaction_category_id AND c.store_id = NEW.store_id
     )
   OR (NEW.fixed_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.fixed_account_id AND a.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_RULE_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_warehouse_access_scope_insert
BEFORE INSERT ON warehouse_access
WHEN NOT EXISTS (
  SELECT 1 FROM warehouses w WHERE w.id = NEW.warehouse_id AND w.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_ACCESS_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_warehouse_opname_scope_insert
BEFORE INSERT ON warehouse_stock_opname_settings
WHEN NOT EXISTS (
  SELECT 1 FROM warehouses w WHERE w.id = NEW.warehouse_id AND w.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_OPNAME_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_warehouse_opname_scope_update
BEFORE UPDATE OF warehouse_id, store_id ON warehouse_stock_opname_settings
WHEN NOT EXISTS (
  SELECT 1 FROM warehouses w WHERE w.id = NEW.warehouse_id AND w.store_id = NEW.store_id
)
BEGIN
  SELECT RAISE(ABORT, 'WAREHOUSE_OPNAME_SCOPE_MISMATCH');
END;

-- Basic chart of accounts requested for initial linking. No transaction category is auto-linked here.
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1101', id, '1101', 'Kas', 'ASSET', 'CASH' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1102', id, '1102', 'Bank', 'ASSET', 'BANK' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1201', id, '1201', 'Piutang Usaha', 'ASSET', 'RECEIVABLE' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1301', id, '1301', 'Persediaan Bahan', 'ASSET', 'INVENTORY' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1302', id, '1302', 'Persediaan Bahan Setengah Jadi', 'ASSET', 'INVENTORY' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1303', id, '1303', 'Persediaan Barang Jadi', 'ASSET', 'INVENTORY' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_2101', id, '2101', 'Utang Usaha', 'LIABILITY', 'PAYABLE' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_3101', id, '3101', 'Modal', 'EQUITY', 'CAPITAL' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_3201', id, '3201', 'Laba Ditahan', 'EQUITY', 'RETAINED_EARNINGS' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_4101', id, '4101', 'Penjualan', 'REVENUE', 'SALES' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_4201', id, '4201', 'Pendapatan Koreksi Stok', 'REVENUE', 'INVENTORY_ADJUSTMENT' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_5101', id, '5101', 'Harga Pokok Penjualan', 'EXPENSE', 'COGS' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_6101', id, '6101', 'Beban Operasional', 'EXPENSE', 'OPERATING_EXPENSE' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_6102', id, '6102', 'Beban Gaji', 'EXPENSE', 'PAYROLL' FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, review_required)
SELECT 'coa_' || id || '_6103', id, '6103', 'Beban Susut Persediaan', 'EXPENSE', 'INVENTORY_ADJUSTMENT', 1 FROM stores;

UPDATE chart_of_accounts SET review_required = 1 WHERE code = '4201' AND subtype = 'INVENTORY_ADJUSTMENT';

-- Payment method to settlement-account linkage. These are method references, not journal rules.
INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
SELECT 'payment_' || id || '_cash', id, 'CASH', 'Cash / Kas', 'coa_' || id || '_1101' FROM stores;
INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
SELECT 'payment_' || id || '_bank', id, 'BANK', 'Bank / Transfer', 'coa_' || id || '_1102' FROM stores;
INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
SELECT 'payment_' || id || '_payable', id, 'PAYABLE', 'Hutang / Utang Usaha', 'coa_' || id || '_2101' FROM stores;

-- Core transaction categories start without journal rules so the owner can link them explicitly.
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_sale', id, 'sale', 'Penjualan', 1, 1, 'Penjualan barang kepada customer.' FROM stores;
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_purchase_material', id, 'purchase_material', 'Pembelian Bahan', 1, 1, 'Pembelian barang/bahan dari supplier.' FROM stores;
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_operational', id, 'operational', 'Operasional', 1, 0, 'Pengeluaran operasional.' FROM stores;
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_payroll', id, 'payroll', 'Gaji', 1, 0, 'Pembayaran gaji.' FROM stores;
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_deposit', id, 'deposit', 'Setoran', 1, 0, 'Setoran kas/bank.' FROM stores;

-- Module B registers warehouse transaction categories into Module A data, never into a warehouse account-mapping table.
INSERT OR IGNORE INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module
)
SELECT 'txcat_' || id || '_wh_transfer', id, 'wh_transfer', 'Transfer Antar Gudang', 0, 1,
       'Perpindahan persediaan antar gudang.', 'WAREHOUSE' FROM stores;
INSERT OR IGNORE INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module
)
SELECT 'txcat_' || id || '_wh_opname', id, 'wh_opname', 'Stock Opname', 0, 1,
       'Penyesuaian selisih stock opname. Rule gain/loss wajib direview sebelum journal engine diaktifkan.', 'WAREHOUSE' FROM stores;
INSERT OR IGNORE INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module
)
SELECT 'txcat_' || id || '_wh_production', id, 'wh_production', 'Pemakaian Produksi / BOM', 0, 1,
       'Perpindahan nilai persediaan input ke output produksi.', 'WAREHOUSE' FROM stores;
INSERT OR IGNORE INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module
)
SELECT 'txcat_' || id || '_wh_return', id, 'wh_return', 'Retur Gudang', 0, 1,
       'Kategori retur didaftarkan fail-closed; detail arah retur akan dilink setelah subtype retur direview.', 'WAREHOUSE' FROM stores;

-- Default Warehouse rule data. Journal generation remains out of scope.
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_transfer_dr', id, 'txcat_' || id || '_wh_transfer',
       'Persediaan gudang tujuan', 'DEBIT', 'item_category_inventory', 10 FROM stores;
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_transfer_cr', id, 'txcat_' || id || '_wh_transfer',
       'Persediaan gudang asal', 'CREDIT', 'item_category_inventory', 20 FROM stores;

INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_opname_gain_dr', id, 'txcat_' || id || '_wh_opname',
       'Jika stok bertambah · Persediaan', 'DEBIT', 'item_category_inventory', 10 FROM stores;
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order
)
SELECT 'jrule_' || id || '_wh_opname_gain_cr', id, 'txcat_' || id || '_wh_opname',
       'Jika stok bertambah · Pendapatan Koreksi Stok', 'CREDIT', 'fixed_account', 'coa_' || id || '_4201', 20 FROM stores;
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order
)
SELECT 'jrule_' || id || '_wh_opname_loss_dr', id, 'txcat_' || id || '_wh_opname',
       'Jika stok berkurang · Beban Susut Persediaan', 'DEBIT', 'fixed_account', 'coa_' || id || '_6103', 30 FROM stores;
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_opname_loss_cr', id, 'txcat_' || id || '_wh_opname',
       'Jika stok berkurang · Persediaan', 'CREDIT', 'item_category_inventory', 40 FROM stores;

INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_production_dr', id, 'txcat_' || id || '_wh_production',
       'Persediaan hasil produksi', 'DEBIT', 'item_category_inventory', 10 FROM stores;
INSERT OR IGNORE INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type, sort_order
)
SELECT 'jrule_' || id || '_wh_production_cr', id, 'txcat_' || id || '_wh_production',
       'Persediaan bahan / BOM', 'CREDIT', 'item_category_inventory', 20 FROM stores;

-- New stores receive the same neutral settings foundation.
CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_settings_defaults
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1101', NEW.id, '1101', 'Kas', 'ASSET', 'CASH');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1102', NEW.id, '1102', 'Bank', 'ASSET', 'BANK');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1201', NEW.id, '1201', 'Piutang Usaha', 'ASSET', 'RECEIVABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1301', NEW.id, '1301', 'Persediaan Bahan', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1302', NEW.id, '1302', 'Persediaan Bahan Setengah Jadi', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1303', NEW.id, '1303', 'Persediaan Barang Jadi', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_2101', NEW.id, '2101', 'Utang Usaha', 'LIABILITY', 'PAYABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_3101', NEW.id, '3101', 'Modal', 'EQUITY', 'CAPITAL');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_3201', NEW.id, '3201', 'Laba Ditahan', 'EQUITY', 'RETAINED_EARNINGS');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_4101', NEW.id, '4101', 'Penjualan', 'REVENUE', 'SALES');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, review_required) VALUES ('coa_' || NEW.id || '_4201', NEW.id, '4201', 'Pendapatan Koreksi Stok', 'REVENUE', 'INVENTORY_ADJUSTMENT', 1);
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_5101', NEW.id, '5101', 'Harga Pokok Penjualan', 'EXPENSE', 'COGS');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6101', NEW.id, '6101', 'Beban Operasional', 'EXPENSE', 'OPERATING_EXPENSE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6102', NEW.id, '6102', 'Beban Gaji', 'EXPENSE', 'PAYROLL');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, review_required) VALUES ('coa_' || NEW.id || '_6103', NEW.id, '6103', 'Beban Susut Persediaan', 'EXPENSE', 'INVENTORY_ADJUSTMENT', 1);

  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_cash', NEW.id, 'CASH', 'Cash / Kas', 'coa_' || NEW.id || '_1101');
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_bank', NEW.id, 'BANK', 'Bank / Transfer', 'coa_' || NEW.id || '_1102');
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_payable', NEW.id, 'PAYABLE', 'Hutang / Utang Usaha', 'coa_' || NEW.id || '_2101');

  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_sale', NEW.id, 'sale', 'Penjualan', 1, 1, 'Penjualan barang kepada customer.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_purchase_material', NEW.id, 'purchase_material', 'Pembelian Bahan', 1, 1, 'Pembelian barang/bahan dari supplier.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_operational', NEW.id, 'operational', 'Operasional', 1, 0, 'Pengeluaran operasional.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_payroll', NEW.id, 'payroll', 'Gaji', 1, 0, 'Pembayaran gaji.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_deposit', NEW.id, 'deposit', 'Setoran', 1, 0, 'Setoran kas/bank.');

  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_transfer', NEW.id, 'wh_transfer', 'Transfer Antar Gudang', 0, 1, 'Perpindahan persediaan antar gudang.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_opname', NEW.id, 'wh_opname', 'Stock Opname', 0, 1, 'Penyesuaian selisih stock opname.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_production', NEW.id, 'wh_production', 'Pemakaian Produksi / BOM', 0, 1, 'Perpindahan nilai persediaan input ke output produksi.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_return', NEW.id, 'wh_return', 'Retur Gudang', 0, 1, 'Retur gudang; detail arah retur perlu direview.', 'WAREHOUSE');

  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_transfer_dr', NEW.id, 'txcat_' || NEW.id || '_wh_transfer', 'Persediaan gudang tujuan', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_transfer_cr', NEW.id, 'txcat_' || NEW.id || '_wh_transfer', 'Persediaan gudang asal', 'CREDIT', 'item_category_inventory', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_gain_dr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok bertambah · Persediaan', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_gain_cr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok bertambah · Pendapatan Koreksi Stok', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_4201', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_loss_dr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok berkurang · Beban Susut Persediaan', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6103', 30);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_loss_cr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok berkurang · Persediaan', 'CREDIT', 'item_category_inventory', 40);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_production_dr', NEW.id, 'txcat_' || NEW.id || '_wh_production', 'Persediaan hasil produksi', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_production_cr', NEW.id, 'txcat_' || NEW.id || '_wh_production', 'Persediaan bahan / BOM', 'CREDIT', 'item_category_inventory', 20);
END;
