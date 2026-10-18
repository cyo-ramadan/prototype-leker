-- Validasi QRIS dengan mutasi bank (Bos Cyo, 2026-10-18): "mutasi qris dikirim h+1 dari transaksinya".
-- Admin Entity mengunggah ekspor "Transaction Report by Merchant BCA" (Excel) -- file dibuka di browser,
-- yang tersimpan di sini hanya baris transaksinya. Tiap baris mutasi dicocokkan ke satu uang masuk
-- (qris_masuk) lewat nominal + jam (menit) + dompet pembayar, lalu outlet aslinya (MID -> gerai) dibandingkan
-- dengan gerai yang mengklaim. Klaim salah gerai, uang yang belum diklaim, dan notifikasi yang hilang jadi
-- kelihatan. Tidak menyentuh jurnal/stok.

-- Outlet merchant (MID) -> gerai Leker. Diisi admin sekali di layar Mutasi.
CREATE TABLE IF NOT EXISTS qris_merchant_gerai (
  entity_id TEXT NOT NULL,
  mid TEXT NOT NULL,
  store_id TEXT NOT NULL,
  merchant_name TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_id, mid),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE IF NOT EXISTS qris_mutasi_upload (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  tanggal_dari TEXT NOT NULL,
  tanggal_sampai TEXT NOT NULL,
  jumlah_baris INTEGER NOT NULL DEFAULT 0,
  baris_baru INTEGER NOT NULL DEFAULT 0,
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- amount = rupiah utuh. trx_at = jam transaksi (WIB, presisi menit) dalam ISO UTC. Unggah ulang file yang sama
-- aman: (entity, mid, rrn) unik. masuk_id = uang masuk pasangannya hasil pencocokan (satu lawan satu).
CREATE TABLE IF NOT EXISTS qris_mutasi (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  mid TEXT NOT NULL,
  merchant_name TEXT NOT NULL DEFAULT '',
  nmid TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK (amount > 0),
  trx_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  rrn TEXT NOT NULL,
  approval_code TEXT NOT NULL DEFAULT '',
  payment_type TEXT NOT NULL DEFAULT '',
  payer TEXT NOT NULL DEFAULT '',
  reversal TEXT NOT NULL DEFAULT '',
  masuk_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  UNIQUE (entity_id, mid, rrn),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (upload_id) REFERENCES qris_mutasi_upload(id),
  FOREIGN KEY (masuk_id) REFERENCES qris_masuk(id)
);

CREATE INDEX IF NOT EXISTS idx_qris_mutasi_tanggal ON qris_mutasi(entity_id, business_date);
