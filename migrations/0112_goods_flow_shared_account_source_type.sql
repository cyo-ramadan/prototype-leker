PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-21: Arus Barang (GOODS_FLOW, bukan Penyesuaian Stok) yang
-- gerainya punya Rekening Bersama sekarang boleh otomatis memindahkan saldo
-- Rekening Bersama gerai itu senilai HPP barang yang bergerak -- lihat
-- src/operational-posting.js. Baris ledger untuk pergerakan ini perlu
-- source_type baru, 'GOODS_FLOW', tapi migrations/0111_entity_shared_accounts.sql
-- sudah applied (CLAUDE.md invariant 7: tidak ditulis ulang) dan SQLite tidak
-- bisa ALTER TABLE untuk melebarkan CHECK constraint -- jadi tabelnya
-- dibangun ulang: tabel baru, salin semua baris apa adanya, drop, rename,
-- lalu buat ulang 3 index + 2 trigger immutability yang sama persis seperti
-- semula (lihat migrations/0043_choice_option_account_optional.sql untuk pola
-- yang sama persis dipakai sebelumnya di repo ini).

CREATE TABLE entity_shared_account_ledger_row_count_20260921 (n INTEGER NOT NULL);
INSERT INTO entity_shared_account_ledger_row_count_20260921 (n) SELECT COUNT(*) FROM entity_shared_account_ledger;

CREATE TABLE entity_shared_account_ledger_new (
  id TEXT PRIMARY KEY,
  shared_account_id TEXT NOT NULL REFERENCES entity_shared_accounts(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('SALE', 'PURCHASE', 'EXPENSE', 'TRANSFER', 'GOODS_FLOW')),
  source_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO entity_shared_account_ledger_new (
  id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note, created_by_role, created_by_id, created_at
)
SELECT
  id, shared_account_id, entity_id, store_id, direction, amount, source_type, source_id, note, created_by_role, created_by_id, created_at
FROM entity_shared_account_ledger;

DROP TABLE entity_shared_account_ledger;
ALTER TABLE entity_shared_account_ledger_new RENAME TO entity_shared_account_ledger;

CREATE INDEX idx_shared_ledger_account_store
  ON entity_shared_account_ledger(shared_account_id, store_id);
CREATE INDEX idx_shared_ledger_account_created
  ON entity_shared_account_ledger(shared_account_id, created_at DESC);
CREATE INDEX idx_shared_ledger_source
  ON entity_shared_account_ledger(source_type, source_id);

CREATE TRIGGER trg_shared_ledger_immutable_update
BEFORE UPDATE ON entity_shared_account_ledger
BEGIN
  SELECT RAISE(ABORT, 'SHARED_LEDGER_IMMUTABLE');
END;

CREATE TRIGGER trg_shared_ledger_immutable_delete
BEFORE DELETE ON entity_shared_account_ledger
BEGIN
  SELECT RAISE(ABORT, 'SHARED_LEDGER_IMMUTABLE');
END;

CREATE TABLE goods_flow_shared_account_guard_20260921 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO goods_flow_shared_account_guard_20260921 (ok)
SELECT CASE WHEN (
  (SELECT COUNT(*) FROM entity_shared_account_ledger) = (SELECT n FROM entity_shared_account_ledger_row_count_20260921)
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'index' AND tbl_name = 'entity_shared_account_ledger' AND name IN ('idx_shared_ledger_account_store', 'idx_shared_ledger_account_created', 'idx_shared_ledger_source')) = 3
  AND (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = 'entity_shared_account_ledger' AND name IN ('trg_shared_ledger_immutable_update', 'trg_shared_ledger_immutable_delete')) = 2
) THEN 1 ELSE 0 END;
DROP TABLE goods_flow_shared_account_guard_20260921;
DROP TABLE entity_shared_account_ledger_row_count_20260921;
