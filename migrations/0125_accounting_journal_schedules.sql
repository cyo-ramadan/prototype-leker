PRAGMA foreign_keys = ON;

-- ADR-049, Bos Cyo 2026-09-28: "Pembuat & Split Jurnal Beban" -- mengganti pekerjaan
-- akuntan manusia untuk dua hal: (1) beban rutin/berulang (Beban Lapak, Listrik, WiFi,
-- dst) yang jurnalnya dibuat sistem tiap jatuh tempo, dan (2) memecah satu jurnal (mis.
-- Deposit Lapak) jadi beban harian merata selama periode manfaatnya. Satu mesin jadwal
-- dipakai untuk dua-duanya, dibedakan `kind`.
--
-- Posting SELALU lewat postAccountingJournal() (src/accounting-ledger.js) -- tabel di
-- sini cuma menyimpan RENCANA, bukan jurnal itu sendiri (invariant #4: Accounting
-- satu-satunya yang memposting jurnal).

CREATE TABLE accounting_journal_schedules (
  id                    TEXT PRIMARY KEY,
  store_id              TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('RECURRING', 'SPLIT')),
  name                  TEXT NOT NULL,
  debit_account_id      TEXT NOT NULL,
  credit_account_id     TEXT NOT NULL,
  amount_scaled         INTEGER CHECK (amount_scaled IS NULL OR amount_scaled > 0),
  total_amount_scaled   INTEGER CHECK (total_amount_scaled IS NULL OR total_amount_scaled > 0),
  start_date            TEXT NOT NULL CHECK (start_date GLOB '????-??-??'),
  end_date              TEXT CHECK (end_date IS NULL OR end_date GLOB '????-??-??'),
  recurrence_type       TEXT NOT NULL CHECK (recurrence_type IN ('DAILY', 'WEEKLY_ON_DAY', 'MONTHLY_ON_DAY')),
  recurrence_value      INTEGER NOT NULL DEFAULT 0,
  total_occurrences     INTEGER CHECK (total_occurrences IS NULL OR total_occurrences > 0),
  auto_create           INTEGER NOT NULL DEFAULT 0 CHECK (auto_create IN (0, 1)),
  source_journal_id     TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  occurrences_generated INTEGER NOT NULL DEFAULT 0,
  last_generated_date   TEXT,
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (debit_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (credit_account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT
);

CREATE INDEX idx_accounting_journal_schedules_active
  ON accounting_journal_schedules(store_id, is_active, kind);

CREATE TABLE accounting_journal_schedule_occurrences (
  id               TEXT PRIMARY KEY,
  schedule_id      TEXT NOT NULL REFERENCES accounting_journal_schedules(id) ON DELETE RESTRICT,
  store_id         TEXT NOT NULL,
  occurrence_date  TEXT NOT NULL CHECK (occurrence_date GLOB '????-??-??'),
  amount_scaled    INTEGER NOT NULL CHECK (amount_scaled > 0),
  status           TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'POSTED', 'SKIPPED')),
  journal_id       TEXT REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (schedule_id, occurrence_date)
);

CREATE INDEX idx_accounting_journal_schedule_occurrences_due
  ON accounting_journal_schedule_occurrences(store_id, status, occurrence_date);
