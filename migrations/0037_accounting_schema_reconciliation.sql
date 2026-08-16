PRAGMA foreign_keys = ON;

-- LEKER-ACC-SCHEMA-RECON-20260817
-- Reconcile out-of-band Accounting schema artifacts traced to unmerged PR #3.
-- The canonical Prototype Leker account registry remains chart_of_accounts.
-- Recovery snapshots are intentionally retained as inert evidence; they are not runtime registries.

CREATE TABLE IF NOT EXISTS accounting_schema_reconciliation_guard_20260817 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM accounting_schema_reconciliation_guard_20260817;

-- Fail before any drop if another live schema object depends on the orphan namespace.
-- This catches unexpected stale objects such as a foreign key/view/trigger that was not part
-- of the approved four-table cleanup scope.
INSERT INTO accounting_schema_reconciliation_guard_20260817 (ok)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM sqlite_schema
  WHERE type IN ('table', 'view', 'trigger')
    AND sql IS NOT NULL
    AND name NOT IN (
      'accounting_accounts',
      'accounting_dimensions',
      'accounting_opening_balances',
      'accounting_transaction_mappings',
      'accounting_schema_reconciliation_guard_20260817'
    )
    AND (
      lower(sql) LIKE '%accounting_accounts%'
      OR lower(sql) LIKE '%accounting_dimensions%'
      OR lower(sql) LIKE '%accounting_opening_balances%'
      OR lower(sql) LIKE '%accounting_transaction_mappings%'
    )
) THEN 0 ELSE 1 END;

-- Fresh canonical databases do not contain the orphan tables. Minimal placeholders make this
-- forward migration deterministic on both fresh databases and drifted live databases. On live,
-- CREATE TABLE IF NOT EXISTS is a no-op and the real orphan schema/data is preserved below.
CREATE TABLE IF NOT EXISTS accounting_accounts (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_dimensions (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_opening_balances (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_transaction_mappings (__reconciliation_placeholder INTEGER);

-- Timestamped recovery snapshots. CREATE TABLE AS SELECT preserves every live column and row
-- without carrying the stale table's constraints/FKs back into the active schema.
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_accounts
AS SELECT * FROM accounting_accounts;
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_dimensions
AS SELECT * FROM accounting_dimensions;
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_opening_balances
AS SELECT * FROM accounting_opening_balances;
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_transaction_mappings
AS SELECT * FROM accounting_transaction_mappings;

CREATE TABLE IF NOT EXISTS accounting_schema_reconciliation_log (
  change_id TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  accounts_rows INTEGER NOT NULL,
  dimensions_rows INTEGER NOT NULL,
  opening_balances_rows INTEGER NOT NULL,
  transaction_mappings_rows INTEGER NOT NULL,
  canonical_account_table TEXT NOT NULL CHECK (canonical_account_table = 'chart_of_accounts')
);
INSERT OR REPLACE INTO accounting_schema_reconciliation_log (
  change_id,
  captured_at,
  accounts_rows,
  dimensions_rows,
  opening_balances_rows,
  transaction_mappings_rows,
  canonical_account_table
)
SELECT
  'LEKER-ACC-SCHEMA-RECON-20260817',
  CURRENT_TIMESTAMP,
  (SELECT COUNT(*) FROM accounting_accounts),
  (SELECT COUNT(*) FROM accounting_dimensions),
  (SELECT COUNT(*) FROM accounting_opening_balances),
  (SELECT COUNT(*) FROM accounting_transaction_mappings),
  'chart_of_accounts';

-- Drop child/reference tables before the stale account registry.
DROP TABLE IF EXISTS accounting_opening_balances;
DROP TABLE IF EXISTS accounting_transaction_mappings;
DROP TABLE IF EXISTS accounting_dimensions;
DROP TABLE IF EXISTS accounting_accounts;

DROP TABLE accounting_schema_reconciliation_guard_20260817;
