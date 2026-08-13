PRAGMA foreign_keys = ON;

-- Integration Bridge delivery state only. This table does NOT own account mappings.
CREATE TABLE IF NOT EXISTS accounting_bridge_deliveries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  producer_module TEXT NOT NULL CHECK (producer_module IN ('POS', 'WAREHOUSE')),
  fact_type TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  transaction_category_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'NEEDS_CONFIGURATION', 'FAILED')),
  journal_id TEXT,
  failure_code TEXT NOT NULL DEFAULT '',
  failure_detail TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  UNIQUE (store_id, producer_module, fact_type, fact_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_bridge_delivery_status
  ON accounting_bridge_deliveries(store_id, status, updated_at DESC);

-- Operational expense chooses a component rule, not an account. The bridge resolves
-- that rule through Accounting Settings, preserving Accounting ownership of the account.
ALTER TABLE expenses ADD COLUMN accounting_component_rule_id TEXT REFERENCES journal_rules(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_expenses_accounting_component_rule
  ON expenses(store_id, accounting_component_rule_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_expense_component_rule_scope_insert
BEFORE INSERT ON expenses
WHEN NEW.accounting_component_rule_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1
   FROM journal_rules r
   JOIN transaction_categories c
     ON c.id = r.transaction_category_id
    AND c.store_id = r.store_id
   WHERE r.id = NEW.accounting_component_rule_id
     AND r.store_id = NEW.store_id
     AND r.is_active = 1
     AND r.side = 'DEBIT'
     AND r.source_type = 'fixed_account'
     AND c.code = 'operational'
     AND c.is_active = 1
 )
BEGIN
  SELECT RAISE(ABORT, 'EXPENSE_ACCOUNTING_COMPONENT_SCOPE_MISMATCH');
END;

-- Preserve legacy NON_CASH input as an explicit configurable payment component.
-- It intentionally starts without an account, so Accounting remains fail-closed until linked.
INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active)
SELECT 'payment_' || id || '_non_cash', id, 'NON_CASH', 'Non Tunai (Legacy)', NULL, 1
FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_bridge_compat
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active)
  VALUES ('payment_' || NEW.id || '_non_cash', NEW.id, 'NON_CASH', 'Non Tunai (Legacy)', NULL, 1);
END;
