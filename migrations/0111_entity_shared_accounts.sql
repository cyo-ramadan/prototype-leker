PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-20: "central account shared per entity" -- satu Entity
-- (mis. ENT-MILA) bisa punya lebih dari satu "Rekening Bersama" (rekening
-- bank/kas yang dipakai lintas gerai, mis. "Rekening Maxi Malang", atau
-- akun informal seperti "Rekening Bos Cyo"/"Hutang Bos Cyo"). Satu Rekening
-- Bersama = satu saldo total, tapi komposisinya per store_id (siapa yang
-- "punya" berapa dari total itu) harus bisa dipecah.
--
-- SENGAJA di luar Akuntansi (instruksi eksplisit Bos Cyo, "masalah harus
-- diluar akuntansi"): tidak ada tabel ini yang menyentuh chart_of_accounts,
-- journal_rules, atau entity_journal_headers/lines. Ini murni tracking
-- operasional, mengikuti idiom ledger append-only yang sudah dipakai
-- operational_receivables_payables.js / cash_ledger_entries / drawer_close_
-- permits: baris ledger adalah source of truth dan immutable, header mutable
-- (status) dipisah dari efeknya (baris ledger), koreksi lewat baris baru
-- bukan UPDATE.
--
-- Invarian yang dijaga (bukan sekadar didokumentasikan -- lihat
-- src/entity-shared-accounts.js): total riil rekening (dihitung dari baris
-- non-TRANSFER saja) = SUM(saldo per store, dihitung dari SEMUA baris) +
-- SUM(transfer yang masih IN_TRANSIT). Transfer antar store tidak pernah
-- mengubah total riil -- cuma memindahkan komposisi.

CREATE TABLE IF NOT EXISTS entity_shared_accounts (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entity_id, name)
);

CREATE INDEX IF NOT EXISTS idx_entity_shared_accounts_entity
  ON entity_shared_accounts(entity_id, is_active);

-- Append-only. Setiap baris adalah satu pergerakan uang masuk/keluar yang
-- sudah terjadi, dicatat sebagai scaled INTEGER (CLAUDE.md invariant #1).
-- source_type TRANSFER dipakai untuk realokasi antar store lewat
-- entity_shared_account_transfers di bawah; source_type lain (SALE/PURCHASE/
-- EXPENSE) dipakai saat metode pembayaran store itu ditandai sebagai
-- Rekening Bersama ini (lihat payment_methods.shared_account_id).
CREATE TABLE IF NOT EXISTS entity_shared_account_ledger (
  id TEXT PRIMARY KEY,
  shared_account_id TEXT NOT NULL REFERENCES entity_shared_accounts(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('SALE', 'PURCHASE', 'EXPENSE', 'TRANSFER')),
  source_id TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shared_ledger_account_store
  ON entity_shared_account_ledger(shared_account_id, store_id);
CREATE INDEX IF NOT EXISTS idx_shared_ledger_account_created
  ON entity_shared_account_ledger(shared_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_ledger_source
  ON entity_shared_account_ledger(source_type, source_id);

-- Source of truth immutable: koreksi lewat baris baru (offsetting entry),
-- bukan edit baris lama. Sama disiplinnya dengan posted journal Akuntansi
-- (CLAUDE.md invariant #2), walau ledger ini di luar Akuntansi.
CREATE TRIGGER IF NOT EXISTS trg_shared_ledger_immutable_update
BEFORE UPDATE ON entity_shared_account_ledger
BEGIN
  SELECT RAISE(ABORT, 'SHARED_LEDGER_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_shared_ledger_immutable_delete
BEFORE DELETE ON entity_shared_account_ledger
BEGIN
  SELECT RAISE(ABORT, 'SHARED_LEDGER_IMMUTABLE');
END;

-- Header/state-machine dua-fase (in_transit -> completed) untuk transfer
-- antar store, mengikuti pola drawer_close_permits/approval_requests di
-- repo ini: header boleh berubah status, tapi efek uangnya (baris ledger)
-- tetap immutable. Saat create: baris OUT langsung ditulis untuk from_store
-- (komposisinya berkurang seketika) dan jumlahnya "mengambang" di in_transit
-- -- BUKAN milik from_store maupun to_store selama itu. Saat complete: baris
-- IN baru ditulis untuk to_store. Total riil rekening tidak pernah berubah
-- sepanjang proses ini.
CREATE TABLE IF NOT EXISTS entity_shared_account_transfers (
  id TEXT PRIMARY KEY,
  shared_account_id TEXT NOT NULL REFERENCES entity_shared_accounts(id),
  entity_id TEXT NOT NULL REFERENCES entities(id),
  from_store_id TEXT NOT NULL REFERENCES stores(id),
  to_store_id TEXT NOT NULL REFERENCES stores(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT', 'COMPLETED')),
  reason TEXT NOT NULL DEFAULT '',
  out_ledger_id TEXT NOT NULL REFERENCES entity_shared_account_ledger(id),
  in_ledger_id TEXT REFERENCES entity_shared_account_ledger(id),
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_by_role TEXT NOT NULL DEFAULT '',
  completed_by_id TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  CHECK (from_store_id <> to_store_id),
  CHECK ((status = 'IN_TRANSIT' AND in_ledger_id IS NULL) OR (status = 'COMPLETED' AND in_ledger_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_shared_transfers_account_status
  ON entity_shared_account_transfers(shared_account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shared_transfers_from_store
  ON entity_shared_account_transfers(from_store_id, status);
CREATE INDEX IF NOT EXISTS idx_shared_transfers_to_store
  ON entity_shared_account_transfers(to_store_id, status);

-- Fakta inti transfer tidak boleh berubah setelah dibuat -- cuma status/
-- in_ledger_id/completed_* yang mutable, dan cuma sekali (IN_TRANSIT ->
-- COMPLETED, tidak bisa mundur).
CREATE TRIGGER IF NOT EXISTS trg_shared_transfer_core_fields_immutable
BEFORE UPDATE OF shared_account_id, entity_id, from_store_id, to_store_id, amount, out_ledger_id, created_at, created_by_role, created_by_id
ON entity_shared_account_transfers
BEGIN
  SELECT RAISE(ABORT, 'SHARED_TRANSFER_CORE_FIELDS_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_shared_transfer_no_uncomplete
BEFORE UPDATE OF status ON entity_shared_account_transfers
WHEN OLD.status = 'COMPLETED'
BEGIN
  SELECT RAISE(ABORT, 'SHARED_TRANSFER_ALREADY_COMPLETED');
END;

-- Tag opsional: metode pembayaran store mana yang sebenarnya adalah pintu
-- masuk/keluar Rekening Bersama ini. Kolom milik POS Core (sibling dari
-- account_id yang Akuntansi punya di migration 0022) -- src/pos-payment-
-- methods.js sudah menegaskan modul ini TIDAK boleh menyentuh mapping akun
-- Akuntansi, jadi kolom baru ini sengaja independen dari account_id.
ALTER TABLE payment_methods ADD COLUMN shared_account_id TEXT REFERENCES entity_shared_accounts(id);

-- Payment method hanya boleh ditandai ke Rekening Bersama milik ENTITY yang
-- sama dengan store pemilik payment method itu -- mencegah gerai Entity A
-- diam-diam menumpang saldo Entity B (pelanggaran isolasi CLAUDE.md #5, versi
-- lintas-entity dari isolasi store_id).
CREATE TRIGGER IF NOT EXISTS trg_payment_method_shared_account_scope_insert
BEFORE INSERT ON payment_methods
WHEN NEW.shared_account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_shared_accounts sa
    JOIN stores s ON s.entity_id = sa.entity_id
    WHERE sa.id = NEW.shared_account_id AND s.id = NEW.store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_METHOD_SHARED_ACCOUNT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_method_shared_account_scope_update
BEFORE UPDATE OF shared_account_id ON payment_methods
WHEN NEW.shared_account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_shared_accounts sa
    JOIN stores s ON s.entity_id = sa.entity_id
    WHERE sa.id = NEW.shared_account_id AND s.id = NEW.store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'PAYMENT_METHOD_SHARED_ACCOUNT_SCOPE_MISMATCH');
END;
