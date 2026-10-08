-- Bos Cyo, 2026-10-08: foto bukti setoran disimpan di storage (R2) begitu aktif, waktu transfer
-- terbaca otomatis dari foto (boleh diisi manual, laporan menandainya), dan pondasi cek otomatis
-- ke mutasi bank (penyedia mutasi/API bank menyusul). Hanya MENAMBAH kolom/tabel; tidak ada data
-- lama yang diubah.

-- Foto di R2 (kunci objek). Foto lama tetap di proof_photo (BLOB D1) dan tetap terbaca.
ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_photo_key TEXT;
-- Waktu transfer menurut bukti (ISO UTC) dan asal isiannya: 'OTOMATIS' (terbaca dari foto, tidak
-- diubah CS), 'MANUAL' (diketik/diubah CS), '' (kiriman lama tanpa isian ini).
ALTER TABLE operational_receivable_payable_payments ADD COLUMN transfer_at TEXT;
ALTER TABLE operational_receivable_payable_payments ADD COLUMN transfer_at_source TEXT NOT NULL DEFAULT '';
-- Hasil baca foto apa adanya (nominal, bank, nomor referensi) untuk dicocokkan Admin.
ALTER TABLE operational_receivable_payable_payments ADD COLUMN proof_read_json TEXT;
-- Status cek ke mutasi bank. Sekarang: BELUM_DICEK sampai Admin memutuskan (DICEK_ADMIN).
-- Nanti: COCOK / TIDAK_COCOK dari penyedia mutasi (verification_provider + verification_ref).
ALTER TABLE operational_receivable_payable_payments ADD COLUMN verification_status TEXT NOT NULL DEFAULT 'BELUM_DICEK';
ALTER TABLE operational_receivable_payable_payments ADD COLUMN verification_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE operational_receivable_payable_payments ADD COLUMN verification_ref TEXT;
ALTER TABLE operational_receivable_payable_payments ADD COLUMN verified_at TEXT;

-- Hasil baca otomatis per foto (sidik SHA-256 isi foto). Saat setoran dikirim, server
-- menghitung sidik foto yang sama: kalau waktu yang dikirim persis sama dengan hasil baca,
-- asalnya OTOMATIS; kalau beda/tidak ada bacaan, MANUAL. Klien tidak bisa mengaku "otomatis".
CREATE TABLE IF NOT EXISTS setoran_bukti_bacaan (
  photo_sha256 TEXT NOT NULL,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  cashier_id   TEXT NOT NULL,
  result_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (photo_sha256, cashier_id)
);

-- Pondasi cek otomatis: baris mutasi rekening yang nanti dikirim penyedia mutasi (webhook) atau
-- API bank. Uang dalam scaled INTEGER (invariant #1); pemilik buku = entity (ADR-030).
CREATE TABLE IF NOT EXISTS bank_mutation_entries (
  id                 TEXT PRIMARY KEY,
  entity_id          TEXT NOT NULL REFERENCES entities(id),
  shared_account_id  TEXT REFERENCES entity_shared_accounts(id),
  provider           TEXT NOT NULL,
  provider_ref       TEXT NOT NULL,
  direction          TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  amount_scaled      INTEGER NOT NULL CHECK (amount_scaled > 0),
  occurred_at        TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  raw_json           TEXT,
  matched_payment_id TEXT,
  matched_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX IF NOT EXISTS idx_bank_mutation_entries_match
  ON bank_mutation_entries(entity_id, direction, amount_scaled, occurred_at);
