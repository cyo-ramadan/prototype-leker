PRAGMA foreign_keys = ON;

-- Operasional owns business facts only. Historical Accounting rule ids are preserved
-- as compatibility evidence, but neither expenses nor Cost Master may enforce a
-- direct foreign key into Accounting-owned tables.
--
-- Rollback evidence: operational_accounting_boundary_recovery_0038 records every
-- non-null legacy selector before the rebuild. A pre-change application rollback can
-- still read the compatibility TEXT columns; a full schema rollback should use the
-- canonical D1 checkpoint / Time Travel procedure and this recovery table for audit.
CREATE TABLE IF NOT EXISTS operational_accounting_boundary_recovery_0038 (
  source_table TEXT NOT NULL CHECK (source_table IN ('expenses', 'cost_types')),
  row_id TEXT NOT NULL,
  accounting_component_rule_id TEXT NOT NULL,
  captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_table, row_id)
);

INSERT OR IGNORE INTO operational_accounting_boundary_recovery_0038 (
  source_table, row_id, accounting_component_rule_id
)
SELECT 'expenses', id, accounting_component_rule_id
FROM expenses
WHERE accounting_component_rule_id IS NOT NULL;

INSERT OR IGNORE INTO operational_accounting_boundary_recovery_0038 (
  source_table, row_id, accounting_component_rule_id
)
SELECT 'cost_types', id, accounting_component_rule_id
FROM cost_types
WHERE accounting_component_rule_id IS NOT NULL;

CREATE TABLE expenses_v2 (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  drawer_session_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  created_at TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'CASH',
  quantity TEXT NOT NULL DEFAULT '1',
  -- Deprecated compatibility evidence only. New Operasional writes must leave NULL.
  accounting_component_rule_id TEXT,
  voided_at TEXT,
  voided_by_role TEXT,
  voided_by_id TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  void_permit_id TEXT REFERENCES approval_permits(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id),
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id)
);

INSERT INTO expenses_v2 (
  id, store_id, drawer_session_id, cashier_id, description, amount, created_at,
  payment_method, quantity, accounting_component_rule_id,
  voided_at, voided_by_role, voided_by_id, void_reason, void_permit_id
)
SELECT
  id, store_id, drawer_session_id, cashier_id, description, amount, created_at,
  payment_method, quantity, accounting_component_rule_id,
  voided_at, voided_by_role, voided_by_id, void_reason, void_permit_id
FROM expenses;

DROP TABLE expenses;
ALTER TABLE expenses_v2 RENAME TO expenses;

CREATE INDEX idx_expenses_store_created_at
  ON expenses(store_id, created_at DESC);
CREATE INDEX idx_expenses_drawer_payment
  ON expenses(drawer_session_id, payment_method, created_at);
CREATE INDEX idx_expenses_store_created_quantity
  ON expenses(store_id, created_at DESC, quantity);
CREATE INDEX idx_expenses_store_void_created
  ON expenses(store_id, voided_at, created_at DESC);

-- Cost Master is an Operasional business concept. Preserve the historical rule id
-- only as rollback evidence; runtime must not join or expose it as current authority.
CREATE TABLE cost_types_v2 (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  accounting_component_rule_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, code),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE cost_masters_v2 (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL DEFAULT '',
  outgoing_amount INTEGER NOT NULL DEFAULT 0 CHECK (outgoing_amount >= 0),
  incoming_amount INTEGER NOT NULL DEFAULT 0 CHECK (incoming_amount >= 0),
  cost_type_id TEXT NOT NULL,
  cost_group TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, name),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (cost_type_id) REFERENCES cost_types_v2(id)
);

INSERT INTO cost_types_v2 (
  id, store_id, code, name, accounting_component_rule_id,
  is_active, created_at, updated_at
)
SELECT
  id, store_id, code, name, accounting_component_rule_id,
  is_active, created_at, updated_at
FROM cost_types;

INSERT INTO cost_masters_v2 (
  id, store_id, name, contact, outgoing_amount, incoming_amount,
  cost_type_id, cost_group, is_active, created_at, updated_at
)
SELECT
  id, store_id, name, contact, outgoing_amount, incoming_amount,
  cost_type_id, cost_group, is_active, created_at, updated_at
FROM cost_masters;

DROP TABLE cost_masters;
DROP TABLE cost_types;
ALTER TABLE cost_types_v2 RENAME TO cost_types;
ALTER TABLE cost_masters_v2 RENAME TO cost_masters;

CREATE INDEX idx_cost_types_store_active
  ON cost_types(store_id, is_active, name);
CREATE INDEX idx_cost_masters_store_active
  ON cost_masters(store_id, is_active, cost_group, name);
