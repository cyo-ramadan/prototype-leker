-- MAXI Protocol integration foundation. Additive only; no shared-module tables are copied.
-- Organization, outlet, terminal, shift and warehouse remain separate identities.

CREATE TABLE IF NOT EXISTS pos_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO pos_tenants (id, name) VALUES ('tenant_leker', 'MAXI Leker');

CREATE TABLE IF NOT EXISTS pos_terminals (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, code),
  FOREIGN KEY (tenant_id) REFERENCES pos_tenants(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

INSERT OR IGNORE INTO pos_terminals (id, tenant_id, store_id, code, name)
SELECT 'terminal_' || id, 'tenant_leker', id, 'POS-01', 'Terminal Utama' FROM stores;

ALTER TABLE cash_drawer_sessions ADD COLUMN terminal_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  parent_id TEXT,
  is_postable INTEGER NOT NULL DEFAULT 0 CHECK (is_postable IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, code),
  FOREIGN KEY (tenant_id) REFERENCES pos_tenants(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (parent_id) REFERENCES accounting_accounts(id)
);

CREATE TABLE IF NOT EXISTS accounting_dimensions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  dimension_type TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (store_id, dimension_type, code),
  FOREIGN KEY (tenant_id) REFERENCES pos_tenants(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS accounting_opening_balances (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  debit_amount INTEGER NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
  credit_amount INTEGER NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, account_id, effective_date),
  FOREIGN KEY (account_id) REFERENCES accounting_accounts(id)
);

CREATE TABLE IF NOT EXISTS accounting_transaction_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'ANY',
  debit_account_id TEXT,
  credit_account_id TEXT,
  status TEXT NOT NULL DEFAULT 'NEEDS_CONFIGURATION' CHECK (status IN ('ACTIVE','NEEDS_CONFIGURATION','INACTIVE')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, transaction_type, payment_method),
  FOREIGN KEY (debit_account_id) REFERENCES accounting_accounts(id),
  FOREIGN KEY (credit_account_id) REFERENCES accounting_accounts(id)
);

CREATE TABLE IF NOT EXISTS warehouse_item_mappings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  warehouse_id TEXT NOT NULL,
  warehouse_item_id TEXT NOT NULL,
  deduction_quantity INTEGER NOT NULL DEFAULT 1 CHECK (deduction_quantity > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','NEEDS_CONFIGURATION','INACTIVE')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, product_id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS pos_integration_settings (
  store_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL DEFAULT '',
  warehouse_id TEXT NOT NULL DEFAULT '',
  retained_earnings_account_id TEXT,
  accounting_module TEXT NOT NULL DEFAULT '@maxi/accounting',
  accounting_version TEXT NOT NULL DEFAULT '1.3.0',
  warehouse_module TEXT NOT NULL DEFAULT '@maxi/warehouse',
  warehouse_version TEXT NOT NULL DEFAULT '2.0.0',
  pos_module TEXT NOT NULL DEFAULT '@maxi/pos-core',
  pos_version TEXT NOT NULL DEFAULT '1.0.0',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (retained_earnings_account_id) REFERENCES accounting_accounts(id)
);

INSERT OR IGNORE INTO pos_integration_settings (store_id, tenant_id, terminal_id)
SELECT id, 'tenant_leker', 'terminal_' || id FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_store_integration_defaults
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO pos_terminals (id, tenant_id, store_id, code, name)
  VALUES ('terminal_' || NEW.id, 'tenant_leker', NEW.id, 'POS-01', 'Terminal Utama');
  INSERT OR IGNORE INTO pos_integration_settings (store_id, tenant_id, terminal_id)
  VALUES (NEW.id, 'tenant_leker', 'terminal_' || NEW.id);
END;

CREATE TABLE IF NOT EXISTS integration_outbox (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  terminal_id TEXT NOT NULL,
  shift_id TEXT NOT NULL,
  destination TEXT NOT NULL CHECK (destination IN ('ACCOUNTING','WAREHOUSE')),
  module_name TEXT NOT NULL,
  module_version TEXT NOT NULL,
  message_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','NEEDS_MAPPING','DISPATCHED','FAILED')),
  payload_json TEXT NOT NULL,
  error_code TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dispatched_at TEXT,
  UNIQUE (tenant_id, destination, idempotency_key),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_outbox_dispatch ON integration_outbox(status, destination, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_store_status ON integration_outbox(store_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_parent ON accounting_accounts(store_id, parent_id, code);

-- Neutral COA hierarchy only. Transaction mapping remains deliberately unconfigured.
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_1000', 'tenant_leker', id, '1000', 'Aset', 'ASSET', NULL, 0 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_1100', 'tenant_leker', id, '1100', 'Kas dan Setara Kas', 'ASSET', 'coa_' || id || '_1000', 1 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_1200', 'tenant_leker', id, '1200', 'Persediaan', 'ASSET', 'coa_' || id || '_1000', 1 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_2000', 'tenant_leker', id, '2000', 'Liabilitas', 'LIABILITY', NULL, 0 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_3000', 'tenant_leker', id, '3000', 'Ekuitas', 'EQUITY', NULL, 0 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_3900', 'tenant_leker', id, '3900', 'Laba Ditahan', 'EQUITY', 'coa_' || id || '_3000', 1 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_4000', 'tenant_leker', id, '4000', 'Pendapatan', 'REVENUE', NULL, 0 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_4100', 'tenant_leker', id, '4100', 'Penjualan', 'REVENUE', 'coa_' || id || '_4000', 1 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_5000', 'tenant_leker', id, '5000', 'Beban', 'EXPENSE', NULL, 0 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_5100', 'tenant_leker', id, '5100', 'Harga Pokok Penjualan', 'EXPENSE', 'coa_' || id || '_5000', 1 FROM stores;
INSERT OR IGNORE INTO accounting_accounts (id, tenant_id, store_id, code, name, account_type, parent_id, is_postable)
SELECT 'coa_' || id || '_5200', 'tenant_leker', id, '5200', 'Beban Operasional', 'EXPENSE', 'coa_' || id || '_5000', 1 FROM stores;
