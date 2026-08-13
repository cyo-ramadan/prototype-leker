PRAGMA foreign_keys = ON;

-- Prototype composition host for the canonical Accounting capability.
-- Public integration still follows the canonical Accounting contract; these are Leker-local storage names.

CREATE TABLE IF NOT EXISTS accounting_sequences (
  store_id TEXT NOT NULL,
  sequence_key TEXT NOT NULL CHECK (sequence_key IN ('ACCOUNT_CODE', 'JOURNAL_NUMBER')),
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, sequence_key),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS accounting_journal_headers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  journal_number TEXT NOT NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  occurred_at TEXT NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'IDR' CHECK (currency_code = 'IDR'),
  source_system TEXT NOT NULL,
  source_reference_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  description TEXT NOT NULL,
  journal_status TEXT NOT NULL DEFAULT 'POSTED' CHECK (journal_status = 'POSTED'),
  posted_at TEXT NOT NULL,
  reversal_of_journal_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (reversal_of_journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  UNIQUE (store_id, journal_number),
  UNIQUE (store_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_accounting_journal_headers_store_date
  ON accounting_journal_headers(store_id, business_date DESC, journal_number DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_journal_headers_source
  ON accounting_journal_headers(store_id, source_system, source_reference_id);

CREATE TABLE IF NOT EXISTS accounting_journal_lines (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  account_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (store_id, journal_id, line_number)
);

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

CREATE TRIGGER IF NOT EXISTS trg_accounting_posted_header_immutable_update
BEFORE UPDATE ON accounting_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_accounting_posted_header_immutable_delete
BEFORE DELETE ON accounting_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
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

INSERT OR IGNORE INTO accounting_sequences (store_id, sequence_key, last_value)
SELECT id, 'ACCOUNT_CODE', 0 FROM stores;
INSERT OR IGNORE INTO accounting_sequences (store_id, sequence_key, last_value)
SELECT id, 'JOURNAL_NUMBER', 0 FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_seed_accounting_workspace_sequences
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO accounting_sequences (store_id, sequence_key, last_value)
  VALUES (NEW.id, 'ACCOUNT_CODE', 0);
  INSERT OR IGNORE INTO accounting_sequences (store_id, sequence_key, last_value)
  VALUES (NEW.id, 'JOURNAL_NUMBER', 0);
END;
