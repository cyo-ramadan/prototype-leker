PRAGMA foreign_keys = ON;

-- LEKER-ACC-SCHEMA-RECON-20260817
-- Reconcile out-of-band Accounting schema artifacts traced to unmerged PR #3.
-- The canonical Prototype Leker account registry remains chart_of_accounts.
-- Recovery snapshots are intentionally retained as inert evidence; they are not runtime registries.
--
-- 2026-08-19 addendum: the original cleanup scoped four tables. Live D1 inspection found three
-- more objects from the same PR #3 experiment that reference them: pos_tenants, pos_terminals,
-- pos_integration_settings, and a live trigger (trg_store_integration_defaults) that has been
-- silently populating them on every `stores` insert since it was created out-of-band. None of
-- the seven are referenced anywhere in src/, public/, or test/. All seven are in scope together
-- so the guard below can actually pass instead of failing closed on the objects it exists to
-- catch.

CREATE TABLE IF NOT EXISTS accounting_schema_reconciliation_guard_20260817 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM accounting_schema_reconciliation_guard_20260817;

-- Fail before any drop if another live schema object depends on the orphan namespace.
-- This catches unexpected stale objects such as a foreign key/view/trigger that was not part
-- of the approved cleanup scope.
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
      'pos_tenants',
      'pos_terminals',
      'pos_integration_settings',
      'trg_store_integration_defaults',
      'accounting_schema_reconciliation_guard_20260817'
    )
    AND (
      lower(sql) LIKE '%accounting_accounts%'
      OR lower(sql) LIKE '%accounting_dimensions%'
      OR lower(sql) LIKE '%accounting_opening_balances%'
      OR lower(sql) LIKE '%accounting_transaction_mappings%'
      OR lower(sql) LIKE '%pos_tenants%'
      OR lower(sql) LIKE '%pos_terminals%'
      OR lower(sql) LIKE '%pos_integration_settings%'
    )
) THEN 0 ELSE 1 END;

-- The trigger runs on every `stores` insert. Drop it before touching the tables it writes to,
-- so nothing can populate them mid-migration.
DROP TRIGGER IF EXISTS trg_store_integration_defaults;

-- Fresh canonical databases do not contain the orphan tables. Minimal placeholders make this
-- forward migration deterministic on both fresh databases and drifted live databases. On live,
-- CREATE TABLE IF NOT EXISTS is a no-op and the real orphan schema/data is preserved below.
CREATE TABLE IF NOT EXISTS accounting_accounts (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_dimensions (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_opening_balances (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS accounting_transaction_mappings (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS pos_tenants (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS pos_terminals (__reconciliation_placeholder INTEGER);
CREATE TABLE IF NOT EXISTS pos_integration_settings (__reconciliation_placeholder INTEGER);

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
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_pos_tenants
AS SELECT * FROM pos_tenants;
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_pos_terminals
AS SELECT * FROM pos_terminals;
CREATE TABLE IF NOT EXISTS accounting_schema_backup_20260817_pos_integration_settings
AS SELECT * FROM pos_integration_settings;

CREATE TABLE IF NOT EXISTS accounting_schema_reconciliation_log (
  change_id TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  accounts_rows INTEGER NOT NULL,
  dimensions_rows INTEGER NOT NULL,
  opening_balances_rows INTEGER NOT NULL,
  transaction_mappings_rows INTEGER NOT NULL,
  pos_tenants_rows INTEGER NOT NULL DEFAULT 0,
  pos_terminals_rows INTEGER NOT NULL DEFAULT 0,
  pos_integration_settings_rows INTEGER NOT NULL DEFAULT 0,
  canonical_account_table TEXT NOT NULL CHECK (canonical_account_table = 'chart_of_accounts')
);
INSERT OR REPLACE INTO accounting_schema_reconciliation_log (
  change_id,
  captured_at,
  accounts_rows,
  dimensions_rows,
  opening_balances_rows,
  transaction_mappings_rows,
  pos_tenants_rows,
  pos_terminals_rows,
  pos_integration_settings_rows,
  canonical_account_table
)
SELECT
  'LEKER-ACC-SCHEMA-RECON-20260817',
  CURRENT_TIMESTAMP,
  (SELECT COUNT(*) FROM accounting_accounts),
  (SELECT COUNT(*) FROM accounting_dimensions),
  (SELECT COUNT(*) FROM accounting_opening_balances),
  (SELECT COUNT(*) FROM accounting_transaction_mappings),
  (SELECT COUNT(*) FROM pos_tenants),
  (SELECT COUNT(*) FROM pos_terminals),
  (SELECT COUNT(*) FROM pos_integration_settings),
  'chart_of_accounts';

-- Drop child/reference tables before the tables they reference.
DROP TABLE IF EXISTS pos_integration_settings;
DROP TABLE IF EXISTS accounting_opening_balances;
DROP TABLE IF EXISTS accounting_transaction_mappings;
DROP TABLE IF EXISTS accounting_dimensions;
DROP TABLE IF EXISTS accounting_accounts;
DROP TABLE IF EXISTS pos_terminals;
DROP TABLE IF EXISTS pos_tenants;

DROP TABLE accounting_schema_reconciliation_guard_20260817;
