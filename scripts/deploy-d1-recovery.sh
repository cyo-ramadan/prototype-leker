#!/usr/bin/env bash
set -euo pipefail

# One-time production recovery for historical D1 schema drift detected on 2026-08-13.
# Remote d1_migrations recorded 0018 as applied, but two compatibility tables from
# 0018 were absent. Recreate only those missing 0018 objects, then resume the
# canonical migration chain. This script is intended to be removed after recovery.

RECOVERY_BOOKMARK="$(npx --yes wrangler d1 time-travel info DB --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s);process.stdout.write(x.bookmark||'')})")"
test -n "$RECOVERY_BOOKMARK" || { echo 'Unable to capture D1 Time Travel recovery bookmark'; exit 1; }
echo "D1 recovery bookmark captured before repair."

REPAIR_SQL=$(cat <<'SQL'
PRAGMA defer_foreign_keys = ON;

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
SQL
)

npx --yes wrangler d1 execute DB --remote --command "$REPAIR_SQL"

# Verify the repaired compatibility objects exist before touching versioned migrations.
npx --yes wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('transaction_accounting_mappings','transaction_accounting_snapshots') ORDER BY name" --json > /tmp/d1-repair-verify.json
grep -q 'transaction_accounting_mappings' /tmp/d1-repair-verify.json
grep -q 'transaction_accounting_snapshots' /tmp/d1-repair-verify.json

# Resume repository-owned canonical migration path.
npx --yes wrangler d1 migrations apply DB --remote

# Fail if Wrangler still reports any repository migration as pending.
npx --yes wrangler d1 migrations list DB --remote > /tmp/d1-migrations-after.txt
if grep -qE '0023_accounting_snapshot_settings_compat|0024_accounting_workspace|0025_accounting_pos_bridge|0026_accounting_six_decimal_precision' /tmp/d1-migrations-after.txt; then
  echo 'Accounting migrations remain pending after recovery.'
  cat /tmp/d1-migrations-after.txt
  exit 1
fi

npx --yes wrangler deploy
