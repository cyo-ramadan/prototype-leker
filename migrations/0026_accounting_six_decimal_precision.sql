PRAGMA foreign_keys = ON;

-- Accounting exact journal precision.
-- Canonical amount unit: 1 rupiah = 1,000,000 scaled units (6 decimal places).
-- Existing posted journals are converted exactly from whole-rupiah amount_minor values.

DROP TRIGGER IF EXISTS trg_accounting_journal_line_scope_insert;
DROP TRIGGER IF EXISTS trg_accounting_posted_line_immutable_update;
DROP TRIGGER IF EXISTS trg_accounting_posted_line_immutable_delete;
DROP INDEX IF EXISTS idx_accounting_journal_lines_account;

ALTER TABLE accounting_journal_lines RENAME TO accounting_journal_lines_legacy_0026;

CREATE TABLE accounting_journal_lines (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  account_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
  is_system_generated INTEGER NOT NULL DEFAULT 0 CHECK (is_system_generated IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (store_id, journal_id, line_number)
);

INSERT INTO accounting_journal_lines (
  id, store_id, journal_id, line_number, account_id, side,
  amount_scaled, is_system_generated, description, created_at
)
SELECT
  id, store_id, journal_id, line_number, account_id, side,
  amount_minor * 1000000, 0, description, created_at
FROM accounting_journal_lines_legacy_0026;

DROP TABLE accounting_journal_lines_legacy_0026;

CREATE INDEX IF NOT EXISTS idx_accounting_journal_lines_account
  ON accounting_journal_lines(store_id, account_id, journal_id);

CREATE TRIGGER IF NOT EXISTS trg_accounting_journal_line_scope_insert
BEFORE INSERT ON accounting_journal_lines
WHEN NOT EXISTS (
       SELECT 1 FROM accounting_journal_headers h
       WHERE h.id = NEW.journal_id AND h.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM chart_of_accounts a
       WHERE a.id = NEW.account_id AND a.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'ACCOUNTING_JOURNAL_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_posted_line_immutable_update
BEFORE UPDATE ON accounting_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_posted_line_immutable_delete
BEFORE DELETE ON accounting_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

-- Dedicated system-owned Equity account for approved automatic balancing adjustments.
-- It is intentionally separate from the owner's primary Modal account.
INSERT OR IGNORE INTO chart_of_accounts (
  id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at
)
SELECT
  'coa_system_adjustment_' || id,
  id,
  'SYS-ADJ',
  'Penyesuaian',
  'EQUITY',
  'ROUNDING_ADJUSTMENT',
  1,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_system_adjustment
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (
    id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at
  ) VALUES (
    'coa_system_adjustment_' || NEW.id,
    NEW.id,
    'SYS-ADJ',
    'Penyesuaian',
    'EQUITY',
    'ROUNDING_ADJUSTMENT',
    1,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  );
END;
