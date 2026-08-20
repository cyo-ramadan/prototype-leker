PRAGMA foreign_keys = ON;

-- MAXI-SETTING-TRANSAKSI-ACCOUNT-OPTIONAL-20260820
--
-- Correction to migrations/0042_accounting_choice_groups.sql, found by Karen
-- while preparing Fase 3 (github.com/cyo-ramadan/prototype-leker/issues/109).
--
-- 0042 landed accounting_choice_options.account_id as NOT NULL. That
-- contradicts both ADR-033 §8 ("tiap pilihan opsional di-link ke akun") and
-- Bos Cyo's direct clarification 2026-08-20: "linked ke akun tidak wajib,
-- kecuali konek dengan Akuntansi" — an option is valid generic/business
-- configuration on its own; the account only has to exist once the option
-- is actually selected on a posting journal_rules lane.
--
-- 0042 already applied, so it is not rewritten (CLAUDE.md invariant 7).
-- This corrects it forward: account_id becomes nullable. The resolver
-- (Fase 3, accounting-pos-bridge.js) is responsible for failing closed with
-- a dedicated code when a selected option has no account — that is
-- Accounting's job at posting time, not a schema-level guarantee.
--
-- SQLite cannot drop a NOT NULL constraint via ALTER TABLE, so the table is
-- rebuilt: new table, copy every row unchanged, drop, rename, re-create the
-- two indexes and two triggers that live on it today.

CREATE TABLE accounting_choice_options_row_count_20260820 (n INTEGER NOT NULL);
INSERT INTO accounting_choice_options_row_count_20260820 (n) SELECT COUNT(*) FROM accounting_choice_options;

CREATE TABLE accounting_choice_options_new (
  id              TEXT PRIMARY KEY,
  choice_group_id TEXT NOT NULL,
  store_id        TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  account_id      TEXT,
  is_default      INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (choice_group_id) REFERENCES accounting_choice_groups(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (choice_group_id, code)
);

INSERT INTO accounting_choice_options_new (
  id, choice_group_id, store_id, code, name, account_id,
  is_default, sort_order, is_active, created_at, updated_at
)
SELECT
  id, choice_group_id, store_id, code, name, account_id,
  is_default, sort_order, is_active, created_at, updated_at
FROM accounting_choice_options;

DROP TABLE accounting_choice_options;
ALTER TABLE accounting_choice_options_new RENAME TO accounting_choice_options;

CREATE INDEX idx_choice_options_group_order
  ON accounting_choice_options(choice_group_id, is_active, sort_order, id);

CREATE UNIQUE INDEX idx_choice_options_one_default
  ON accounting_choice_options(choice_group_id)
  WHERE is_active = 1 AND is_default = 1;

-- account_id is now optional, so the scope guard only checks it when
-- present — a bare "NOT EXISTS (... id = NULL ...)" would otherwise always
-- be true and reject every option that has no account yet.
CREATE TRIGGER trg_choice_option_scope_insert
BEFORE INSERT ON accounting_choice_options
WHEN NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     )
   OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'CHOICE_OPTION_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_choice_option_scope_update
BEFORE UPDATE OF store_id, choice_group_id, account_id ON accounting_choice_options
WHEN NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     )
   OR (NEW.account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'CHOICE_OPTION_SCOPE_MISMATCH');
END;

CREATE TABLE choice_options_optional_account_guard_20260820 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO choice_options_optional_account_guard_20260820 (ok)
SELECT CASE WHEN (
  (SELECT COUNT(*) FROM accounting_choice_options) = (SELECT n FROM accounting_choice_options_row_count_20260820)
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'accounting_choice_options' AND name IN ('idx_choice_options_group_order', 'idx_choice_options_one_default')) = 2
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'accounting_choice_options' AND name IN ('trg_choice_option_scope_insert', 'trg_choice_option_scope_update')) = 2
) THEN 1 ELSE 0 END;
DROP TABLE choice_options_optional_account_guard_20260820;
DROP TABLE accounting_choice_options_row_count_20260820;
