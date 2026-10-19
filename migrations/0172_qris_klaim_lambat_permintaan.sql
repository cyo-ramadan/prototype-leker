-- Bos Cyo, 2026-10-19 (lanjutan 0171): variabel KPI QRIS tambahan dan permintaan klaim antar-CS.
-- 1. klaim_at: kapan CS mengklaim (klaim asli, tidak diubah sistem/admin) -> "klaim lambat" (> 10 menit
--    sejak notifikasi muncul di MAXI).
-- 2. Catatan CS baru: KLAIM_LAMBAT dan SELISIH_KLAIM (total klaim CS sehari != total penjualan QRIS-nya).
-- 3. qris_klaim_permintaan: CS gerai lain bilang "uang ini dari pembeliku"; CS yang mengklaim memilih
--    melepas atau mempertahankan klaimnya. Mutasi bank H+1 tetap hakim terakhir.

ALTER TABLE qris_masuk ADD COLUMN klaim_at TEXT;
UPDATE qris_masuk SET klaim_at = claimed_at WHERE klaim_store_id IS NOT NULL AND claimed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS qris_catatan_cs_baru (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('SALAH_KLAIM', 'TIDAK_KLAIM', 'PENJUALAN_TANPA_UANG', 'UANG_TANPA_PENJUALAN', 'KLAIM_LAMBAT', 'SELISIH_KLAIM')),
  store_id TEXT,
  cashier_id TEXT,
  cashier_name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL,
  waktu TEXT NOT NULL,
  mutasi_id TEXT,
  masuk_id TEXT,
  sale_id TEXT,
  keterangan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
INSERT INTO qris_catatan_cs_baru (id, entity_id, business_date, jenis, store_id, cashier_id, cashier_name, amount, waktu, mutasi_id, masuk_id, sale_id, keterangan, created_at)
SELECT id, entity_id, business_date, jenis, store_id, cashier_id, cashier_name, amount, waktu, mutasi_id, masuk_id, sale_id, keterangan, created_at FROM qris_catatan_cs;
DROP TABLE qris_catatan_cs;
ALTER TABLE qris_catatan_cs_baru RENAME TO qris_catatan_cs;
CREATE INDEX IF NOT EXISTS idx_qris_catatan_cs_tanggal ON qris_catatan_cs(entity_id, business_date);
CREATE INDEX IF NOT EXISTS idx_qris_catatan_cs_kasir ON qris_catatan_cs(cashier_id);

CREATE TABLE IF NOT EXISTS qris_klaim_permintaan (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  masuk_id TEXT NOT NULL,
  dari_store_id TEXT NOT NULL,
  dari_role TEXT NOT NULL DEFAULT '',
  dari_cashier_id TEXT,
  dari_name TEXT NOT NULL DEFAULT '',
  ke_store_id TEXT NOT NULL,
  ke_cashier_id TEXT,
  ke_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'MENUNGGU' CHECK (status IN ('MENUNGGU', 'DILEPAS', 'DIPERTAHANKAN', 'BATAL')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by_name TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (masuk_id) REFERENCES qris_masuk(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qris_klaim_permintaan_terbuka ON qris_klaim_permintaan(masuk_id) WHERE status = 'MENUNGGU';
CREATE INDEX IF NOT EXISTS idx_qris_klaim_permintaan_ke ON qris_klaim_permintaan(ke_store_id, status);
