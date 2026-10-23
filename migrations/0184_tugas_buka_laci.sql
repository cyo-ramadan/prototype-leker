PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-10-23: "setiap cs mau buka laci maka dia wajib stok opname
-- atau penyesuaian stok ... ditambah lagi cek uang laci saat itu juga sama
-- aset, untuk saat ini asetnya cuma appron." Keputusan Bos hari yang sama:
-- laci dibuka dulu, lalu Tugas Buka Laci wajib (stok opname + hitung uang
-- laci + cek aset) -- semua transaksi laci itu ditahan sampai selesai.
-- Saklar tenant 'tugas_buka_laci' (src/tenant-policy.js), bawaan aktif.
--
-- '' = laci ini tidak wajib Tugas Buka Laci (saklar mati, skin tanpa layar
-- kasir biasa, Kantor, atau laci yang dibuka sebelum fitur ini ada).
-- PENDING = wajib dan belum selesai; DONE = selesai.
ALTER TABLE cash_drawer_sessions ADD COLUMN opening_check_status TEXT NOT NULL DEFAULT ''
  CHECK (opening_check_status IN ('', 'PENDING', 'DONE'));

-- Satu baris per laci yang wajib Tugas Buka Laci. Tiga bagian dicatat
-- terpisah (masing-masing *_done_at) karena dikerjakan bertahap di HP.
-- Selisih uang hanya dicatat + admin dikabari; saldo awal laci tetap dari
-- server dan TIDAK ada jurnal otomatis (keputusan 2026-09-04 tetap berlaku:
-- selisih kas dibahas dengan akuntan).
CREATE TABLE IF NOT EXISTS drawer_opening_checks (
  drawer_session_id TEXT PRIMARY KEY REFERENCES cash_drawer_sessions(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  business_date TEXT NOT NULL,
  stock_done_at TEXT,
  stock_item_count INTEGER NOT NULL DEFAULT 0,
  stock_diff_count INTEGER NOT NULL DEFAULT 0,
  stock_session_ids TEXT NOT NULL DEFAULT '[]',
  stock_lines_json TEXT NOT NULL DEFAULT '[]',
  cash_done_at TEXT,
  cash_system_amount INTEGER,
  cash_counted_amount INTEGER,
  cash_difference INTEGER,
  asset_done_at TEXT,
  assets_json TEXT NOT NULL DEFAULT '[]',
  missing_asset_count INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drawer_opening_checks_store_date
  ON drawer_opening_checks(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_drawer_opening_checks_cashier_date
  ON drawer_opening_checks(cashier_id, business_date);

-- Daftar aset yang dicek saat buka laci diatur Admin Gerai di tab Daily Task
-- yang sama (jenis "Aset cek buka laci"), bukan tabel/CRUD baru.
ALTER TABLE daily_task_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'TASK'
  CHECK (kind IN ('TASK', 'ASSET'));

-- Isi awal: Apron untuk setiap gerai yang sudah ada. Gerai baru yang belum
-- punya baris aset sama sekali tetap dicek Apron (bawaan di
-- src/tugas-buka-laci.js).
INSERT OR IGNORE INTO daily_task_templates (id, store_id, title, description, is_active, sort_order, kind)
SELECT 'dailytask_asset_apron_' || id, id, 'Apron', 'Apron ada dan dipakai saat jaga', 1, 0, 'ASSET'
FROM stores;
