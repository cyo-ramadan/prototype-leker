-- Bos Cyo, 2026-10-19: mutasi QRIS H+1 menjadi hakim. Sistem yang menautkan uang QRIS ke penjualan
-- (CS cukup mengklaim), lalu mencatat kesalahan tiap CS untuk Raport: salah klaim, tidak klaim, dan
-- nominal QRIS tidak sesuai (penjualan QRIS tanpa uang / uang QRIS tanpa penjualan QRIS).

-- Gerai & CS yang mengklaim, disimpan terpisah dari store_id: sistem memindah store_id ke gerai asli
-- menurut mutasi, tapi klaim aslinya tetap jadi bukti untuk catatan "salah klaim".
ALTER TABLE qris_masuk ADD COLUMN klaim_store_id TEXT;
ALTER TABLE qris_masuk ADD COLUMN klaim_cashier_id TEXT;
UPDATE qris_masuk SET klaim_store_id = store_id, klaim_cashier_id = claimed_by_id
WHERE claimed_at IS NOT NULL AND claimed_by_role = 'CASHIER' AND store_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS qris_catatan_cs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('SALAH_KLAIM', 'TIDAK_KLAIM', 'PENJUALAN_TANPA_UANG', 'UANG_TANPA_PENJUALAN')),
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
CREATE INDEX IF NOT EXISTS idx_qris_catatan_cs_tanggal ON qris_catatan_cs(entity_id, business_date);
CREATE INDEX IF NOT EXISTS idx_qris_catatan_cs_kasir ON qris_catatan_cs(cashier_id);
