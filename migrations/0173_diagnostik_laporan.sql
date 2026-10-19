-- Bos Cyo, 2026-10-19: hasil halaman /diagnostik dikirim ke server supaya Eskor (agen programmer)
-- bisa menganalisis HP CS yang bermasalah (mis. tombol Kolam QRIS tidak muncul) tanpa CS memotret
-- layar. Tidak ada token/kata sandi; IP hanya disimpan sebagai hash untuk membatasi kiriman.
CREATE TABLE IF NOT EXISTS diagnostik_laporan (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cashier_id TEXT,
  cashier_name TEXT NOT NULL DEFAULT '',
  store_code TEXT NOT NULL DEFAULT '',
  isp TEXT NOT NULL DEFAULT '',
  asn INTEGER,
  colo TEXT NOT NULL DEFAULT '',
  kota TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  gagal INTEGER NOT NULL DEFAULT 0,
  catatan TEXT NOT NULL DEFAULT '',
  hasil_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnostik_laporan_created ON diagnostik_laporan(created_at);
CREATE INDEX IF NOT EXISTS idx_diagnostik_laporan_ip ON diagnostik_laporan(ip_hash, created_at);
