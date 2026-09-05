PRAGMA foreign_keys = ON;

-- 2026-09-05, Bos Cyo: "buku Entity" -- langkah pertama dari rencana R/K
-- Kantor Pusat-Cabang (rekening utama Entity, hutang/piutang antar gerai)
-- dan sekaligus tempat mendarat gaji karyawan tingkat Entity (OB kantor,
-- dst) yang sejak migration 0072 sudah bisa didaftarkan tapi belum punya
-- buku buat dicatat.
--
-- Cermin persis dari mesin Akuntansi per-gerai (chart_of_accounts,
-- accounting_journal_headers/lines, accounting_sequences, migration
-- 0022/0024/0026) -- tapi entity_id sebagai kunci, bukan store_id, dan
-- SENGAJA lebih sederhana:
--
-- - Tanpa toleransi Penyesuaian (SYSTEM_ADJUSTMENT_POLICY): itu jalan
--   keluar spesifik buat pembulatan POS (CLAUDE.md invariant #3 tegas:
--   toleransi itu bukan karpet nutup error). Semua jurnal di buku Entity
--   untuk sekarang murni manual (source_system selalu 'MANUAL'), jadi wajib
--   balance PAS, tanpa jalan pintas.
-- - Tanpa choice_group/choice_option: itu konsep Setting Akuntansi per-gerai
--   (accounting_choice_options), Entity belum punya itu.
--
-- Fungsi murni (validateJournalLines, scaledAmountToExactString, dst) dari
-- src/accounting-ledger.js dipakai ulang apa adanya di src/entity-ledger.js
-- -- sudah entity-agnostic, tidak menyentuh store_id sama sekali, jadi aman
-- dipakai bersama tanpa duplikasi logic.

CREATE TABLE IF NOT EXISTS entity_accounting_sequences (
  entity_id TEXT NOT NULL,
  sequence_key TEXT NOT NULL CHECK (sequence_key IN ('ACCOUNT_CODE', 'JOURNAL_NUMBER')),
  last_value INTEGER NOT NULL DEFAULT 0 CHECK (last_value >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity_id, sequence_key),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE TABLE IF NOT EXISTS entity_chart_of_accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  subtype TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (entity_id, code)
);

CREATE INDEX IF NOT EXISTS idx_entity_coa_entity_type_active
  ON entity_chart_of_accounts(entity_id, type, is_active, code);

CREATE TABLE IF NOT EXISTS entity_journal_headers (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
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
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (reversal_of_journal_id) REFERENCES entity_journal_headers(id) ON DELETE RESTRICT,
  UNIQUE (entity_id, journal_number),
  UNIQUE (entity_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_entity_journal_headers_entity_date
  ON entity_journal_headers(entity_id, business_date DESC, journal_number DESC);

CREATE TABLE IF NOT EXISTS entity_journal_lines (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  journal_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  account_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (journal_id) REFERENCES entity_journal_headers(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES entity_chart_of_accounts(id) ON DELETE RESTRICT,
  UNIQUE (entity_id, journal_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_entity_journal_lines_account
  ON entity_journal_lines(entity_id, account_id, journal_id);

CREATE TRIGGER IF NOT EXISTS trg_entity_journal_line_scope_insert
BEFORE INSERT ON entity_journal_lines
WHEN NOT EXISTS (
       SELECT 1 FROM entity_journal_headers h
       WHERE h.id = NEW.journal_id AND h.entity_id = NEW.entity_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM entity_chart_of_accounts a
       WHERE a.id = NEW.account_id AND a.entity_id = NEW.entity_id
     )
BEGIN
  SELECT RAISE(ABORT, 'ENTITY_JOURNAL_SCOPE_MISMATCH');
END;

-- Sama seperti jurnal per-gerai: posted = immutable, koreksi lewat reversal.
CREATE TRIGGER IF NOT EXISTS trg_entity_journal_header_immutable_update
BEFORE UPDATE ON entity_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_journal_header_immutable_delete
BEFORE DELETE ON entity_journal_headers
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_journal_line_immutable_update
BEFORE UPDATE ON entity_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_entity_journal_line_immutable_delete
BEFORE DELETE ON entity_journal_lines
BEGIN
  SELECT RAISE(ABORT, 'POSTED_JOURNAL_IMMUTABLE');
END;
