PRAGMA foreign_keys = ON;

-- MAXI-SETTING-TRANSAKSI-20260819
--
-- Schema only. Zero behavior change for every store that exists today — no
-- journal_rules row is touched, no existing resolver path is exercised
-- differently. This lands the tables and the new journal_rules source_type
-- so Setting Akuntansi can grow "Setting Transaksi" (Choice Group in code/
-- schema, per ADR-033) without a big-bang rewrite of the resolver.
--
-- Two new registries:
--   accounting_choice_groups  — a named, reusable list of account choices
--   accounting_choice_options — one choice in that list; always points to a
--                                real account (chart_of_accounts row)
--
-- journal_rules gets a third shape alongside 'fixed_account' and the
-- item_category_*/payment_method sources: 'choice_group', which points at
-- one row in accounting_choice_groups instead of one fixed account. SQLite
-- cannot ALTER a CHECK constraint, so journal_rules is rebuilt: new table,
-- copy every row unchanged, drop, rename, then re-create the exact two
-- indexes and two triggers that live on it today. The guard at the bottom
-- fails the whole migration closed if the rebuild lost a row, an index, or
-- a trigger — the kind of silent loss that would otherwise surface months
-- later as configuration nobody remembers removing.

CREATE TABLE accounting_choice_groups (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL,
  entity_id  TEXT,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (store_id, code)
);

CREATE TABLE accounting_choice_options (
  id              TEXT PRIMARY KEY,
  choice_group_id TEXT NOT NULL,
  store_id        TEXT NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  account_id      TEXT NOT NULL,
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

CREATE INDEX idx_choice_options_group_order
  ON accounting_choice_options(choice_group_id, is_active, sort_order, id);

CREATE UNIQUE INDEX idx_choice_options_one_default
  ON accounting_choice_options(choice_group_id)
  WHERE is_active = 1 AND is_default = 1;

-- Same defensive pattern as trg_journal_rule_scope_insert/update: FKs alone
-- don't stop a group, its option, and the option's account from belonging
-- to three different stores. Fail closed instead of trusting the caller.
CREATE TRIGGER trg_choice_option_scope_insert
BEFORE INSERT ON accounting_choice_options
WHEN NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'CHOICE_OPTION_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_choice_option_scope_update
BEFORE UPDATE OF store_id, choice_group_id, account_id ON accounting_choice_options
WHEN NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'CHOICE_OPTION_SCOPE_MISMATCH');
END;

-- --- journal_rules rebuild: add 'choice_group' as a third rule shape -------

CREATE TABLE journal_rules_row_count_20260819 (n INTEGER NOT NULL);
INSERT INTO journal_rules_row_count_20260819 (n) SELECT COUNT(*) FROM journal_rules;

-- Default (non-legacy) ALTER TABLE RENAME validates every trigger in the
-- schema against the pre-rename state, including triggers on unrelated
-- tables (trg_stores_seed_accounting_settings_defaults, on `stores`, whose
-- body inserts into journal_rules). Mid-rebuild journal_rules briefly does
-- not exist under that name, and the unrelated trigger trips the
-- validation with "no such table: journal_rules". legacy_alter_table
-- disables that cross-trigger scan for the rename below; nothing else in
-- this migration depends on it, so it is turned back off immediately after.
PRAGMA legacy_alter_table = ON;

CREATE TABLE journal_rules_new (
  id                       TEXT PRIMARY KEY,
  store_id                 TEXT NOT NULL,
  transaction_category_id  TEXT NOT NULL,
  label                    TEXT NOT NULL,
  side                     TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  source_type              TEXT NOT NULL CHECK (source_type IN (
    'fixed_account',
    'choice_group',
    'payment_method',
    'item_category_inventory',
    'item_category_cogs',
    'item_category_revenue',
    'cost_center_cash'
  )),
  fixed_account_id         TEXT,
  choice_group_id          TEXT,
  is_active                INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order               INTEGER NOT NULL DEFAULT 0,
  is_default               INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (transaction_category_id) REFERENCES transaction_categories(id) ON DELETE CASCADE,
  FOREIGN KEY (fixed_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (choice_group_id) REFERENCES accounting_choice_groups(id) ON DELETE RESTRICT,
  CHECK (
    (source_type = 'fixed_account' AND fixed_account_id IS NOT NULL AND choice_group_id IS NULL)
    OR (source_type = 'choice_group' AND choice_group_id IS NOT NULL AND fixed_account_id IS NULL)
    OR (source_type NOT IN ('fixed_account', 'choice_group') AND fixed_account_id IS NULL AND choice_group_id IS NULL)
  )
);

INSERT INTO journal_rules_new (
  id, store_id, transaction_category_id, label, side, source_type,
  fixed_account_id, choice_group_id, is_active, sort_order, is_default, created_at, updated_at
)
SELECT
  id, store_id, transaction_category_id, label, side, source_type,
  fixed_account_id, NULL, is_active, sort_order, is_default, created_at, updated_at
FROM journal_rules;

DROP TABLE journal_rules;
ALTER TABLE journal_rules_new RENAME TO journal_rules;

PRAGMA legacy_alter_table = OFF;

CREATE INDEX idx_journal_rules_category_order
  ON journal_rules(store_id, transaction_category_id, is_active, sort_order, id);

CREATE UNIQUE INDEX idx_journal_rules_one_default
  ON journal_rules(store_id, transaction_category_id)
  WHERE is_active = 1 AND source_type = 'fixed_account' AND is_default = 1;

CREATE TRIGGER trg_journal_rule_scope_insert
BEFORE INSERT ON journal_rules
WHEN NOT EXISTS (
       SELECT 1 FROM transaction_categories c WHERE c.id = NEW.transaction_category_id AND c.store_id = NEW.store_id
     )
   OR (NEW.fixed_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.fixed_account_id AND a.store_id = NEW.store_id
     ))
   OR (NEW.choice_group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_RULE_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_journal_rule_scope_update
BEFORE UPDATE OF store_id, transaction_category_id, fixed_account_id, choice_group_id ON journal_rules
WHEN NOT EXISTS (
       SELECT 1 FROM transaction_categories c WHERE c.id = NEW.transaction_category_id AND c.store_id = NEW.store_id
     )
   OR (NEW.fixed_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a WHERE a.id = NEW.fixed_account_id AND a.store_id = NEW.store_id
     ))
   OR (NEW.choice_group_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM accounting_choice_groups g WHERE g.id = NEW.choice_group_id AND g.store_id = NEW.store_id
     ))
BEGIN
  SELECT RAISE(ABORT, 'JOURNAL_RULE_SCOPE_MISMATCH');
END;

-- --- accounting_journal_lines: snapshot which group/option produced the line

ALTER TABLE accounting_journal_lines ADD COLUMN choice_group_code TEXT NOT NULL DEFAULT '';
ALTER TABLE accounting_journal_lines ADD COLUMN choice_option_code TEXT NOT NULL DEFAULT '';

-- --- guard: rebuild must be lossless ---------------------------------------

CREATE TABLE choice_groups_migration_guard_20260819 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO choice_groups_migration_guard_20260819 (ok)
SELECT CASE WHEN (
  (SELECT COUNT(*) FROM journal_rules) = (SELECT n FROM journal_rules_row_count_20260819)
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'journal_rules' AND name IN ('idx_journal_rules_category_order', 'idx_journal_rules_one_default')) = 2
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'journal_rules' AND name IN ('trg_journal_rule_scope_insert', 'trg_journal_rule_scope_update')) = 2
) THEN 1 ELSE 0 END;
DROP TABLE choice_groups_migration_guard_20260819;
DROP TABLE journal_rules_row_count_20260819;
