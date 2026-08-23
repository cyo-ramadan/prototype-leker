PRAGMA defer_foreign_keys = ON;
-- D1 keeps foreign keys enabled inside its implicit migration transaction; this
-- pragma is a local-SQLite fallback so the same rebuild is executable by repo tests.
PRAGMA foreign_keys = OFF;

CREATE TABLE tenancy_ledger_row_counts_20260822 (
  header_count INTEGER NOT NULL,
  line_count INTEGER NOT NULL
);
INSERT INTO tenancy_ledger_row_counts_20260822 (header_count, line_count)
SELECT
  (SELECT COUNT(*) FROM accounting_journal_headers),
  (SELECT COUNT(*) FROM accounting_journal_lines);

-- Posted journals are immutable through unconditional BEFORE UPDATE triggers.
-- Rebuild them instead of UPDATE-backfilling, while preserving the exact current
-- schema and appending entity_id as the new additive field.
CREATE TABLE accounting_journal_headers_new_0046 (
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
  entity_id TEXT REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (reversal_of_journal_id) REFERENCES accounting_journal_headers_new_0046(id) ON DELETE RESTRICT,
  UNIQUE (store_id, journal_number),
  UNIQUE (store_id, idempotency_key)
);

INSERT INTO accounting_journal_headers_new_0046 (
  id, store_id, journal_number, business_date, occurred_at, currency_code,
  source_system, source_reference_id, correlation_id, idempotency_key,
  description, journal_status, posted_at, reversal_of_journal_id, created_at,
  entity_id
)
SELECT
  h.id, h.store_id, h.journal_number, h.business_date, h.occurred_at, h.currency_code,
  h.source_system, h.source_reference_id, h.correlation_id, h.idempotency_key,
  h.description, h.journal_status, h.posted_at, h.reversal_of_journal_id, h.created_at,
  (SELECT s.entity_id FROM stores s WHERE s.id = h.store_id)
FROM accounting_journal_headers h;

CREATE TABLE accounting_journal_lines_new_0046 (
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
  choice_group_code TEXT NOT NULL DEFAULT '',
  choice_option_code TEXT NOT NULL DEFAULT '',
  entity_id TEXT REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers_new_0046(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (store_id, journal_id, line_number)
);

INSERT INTO accounting_journal_lines_new_0046 (
  id, store_id, journal_id, line_number, account_id, side, amount_scaled,
  is_system_generated, description, created_at, choice_group_code,
  choice_option_code, entity_id
)
SELECT
  l.id, l.store_id, l.journal_id, l.line_number, l.account_id, l.side, l.amount_scaled,
  l.is_system_generated, l.description, l.created_at, l.choice_group_code,
  l.choice_option_code,
  (SELECT s.entity_id FROM stores s WHERE s.id = l.store_id)
FROM accounting_journal_lines l;

DROP TABLE accounting_journal_lines;
DROP TABLE accounting_journal_headers;
ALTER TABLE accounting_journal_headers_new_0046 RENAME TO accounting_journal_headers;
ALTER TABLE accounting_journal_lines_new_0046 RENAME TO accounting_journal_lines;

CREATE INDEX idx_accounting_journal_headers_store_date
  ON accounting_journal_headers(store_id, business_date DESC, journal_number DESC);
CREATE INDEX idx_accounting_journal_headers_source
  ON accounting_journal_headers(store_id, source_system, source_reference_id);
CREATE INDEX idx_accounting_journal_lines_account
  ON accounting_journal_lines(store_id, account_id, journal_id);

CREATE TRIGGER trg_accounting_journal_line_scope_insert
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

CREATE TRIGGER trg_accounting_posted_header_immutable_update
BEFORE UPDATE ON accounting_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER trg_accounting_posted_header_immutable_delete
BEFORE DELETE ON accounting_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER trg_accounting_posted_line_immutable_update
BEFORE UPDATE ON accounting_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER trg_accounting_posted_line_immutable_delete
BEFORE DELETE ON accounting_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

ALTER TABLE inventory_stock_balances ADD COLUMN entity_id TEXT REFERENCES entities(id);
UPDATE inventory_stock_balances
SET entity_id = (SELECT s.entity_id FROM stores s WHERE s.id = inventory_stock_balances.store_id);

ALTER TABLE inventory_ledger_entries ADD COLUMN entity_id TEXT REFERENCES entities(id);
UPDATE inventory_ledger_entries
SET entity_id = (SELECT s.entity_id FROM stores s WHERE s.id = inventory_ledger_entries.store_id);

ALTER TABLE stock_movements ADD COLUMN entity_id TEXT REFERENCES entities(id);
UPDATE stock_movements
SET entity_id = (SELECT s.entity_id FROM stores s WHERE s.id = stock_movements.store_id);

CREATE TABLE tenancy_ledger_entity_guard_20260822 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO tenancy_ledger_entity_guard_20260822 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM accounting_journal_headers) = (SELECT header_count FROM tenancy_ledger_row_counts_20260822)
  AND (SELECT COUNT(*) FROM accounting_journal_lines) = (SELECT line_count FROM tenancy_ledger_row_counts_20260822)
  AND NOT EXISTS (
    SELECT 1 FROM accounting_journal_headers h
    LEFT JOIN stores s ON s.id = h.store_id
    WHERE h.entity_id IS NULL OR s.entity_id IS NULL OR h.entity_id <> s.entity_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM accounting_journal_lines l
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE l.entity_id IS NULL OR s.entity_id IS NULL OR l.entity_id <> s.entity_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM inventory_stock_balances b
    LEFT JOIN stores s ON s.id = b.store_id
    WHERE b.entity_id IS NULL OR s.entity_id IS NULL OR b.entity_id <> s.entity_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM inventory_ledger_entries l
    LEFT JOIN stores s ON s.id = l.store_id
    WHERE l.entity_id IS NULL OR s.entity_id IS NULL OR l.entity_id <> s.entity_id
  )
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements m
    LEFT JOIN stores s ON s.id = m.store_id
    WHERE m.entity_id IS NULL OR s.entity_id IS NULL OR m.entity_id <> s.entity_id
  )
THEN 1 ELSE 0 END;

DROP TABLE tenancy_ledger_entity_guard_20260822;
DROP TABLE tenancy_ledger_row_counts_20260822;

PRAGMA foreign_keys = ON;
PRAGMA defer_foreign_keys = OFF;
