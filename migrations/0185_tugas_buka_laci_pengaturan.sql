PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-10-24: "daily task ini bisa dibikin lewat tombol2 admin kan?
-- engga dipaten di sourcecode kan? ... harusnya di pengaturan sih." Isi
-- Tugas Buka Laci (migration 0184) diatur Admin Gerai per gerai di Pengaturan
-- -> Tugas Harian & Buka Laci, bukan tetap di kode. Saklar tenant
-- 'tugas_buka_laci' (Owner) tetap saklar induk.
--
-- Tidak ada baris = bawaan: tiga langkah wajib, daftar opname otomatis semua
-- Bahan + Bahan Setengah Jadi (perilaku 0184).
-- stock_mode MATERIALS = otomatis ikut jenis barang (barang baru ikut masuk);
-- CUSTOM = hanya barang di stock_product_ids_json yang dipilih Admin.
CREATE TABLE IF NOT EXISTS store_opening_check_settings (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  stock_enabled INTEGER NOT NULL DEFAULT 1 CHECK (stock_enabled IN (0, 1)),
  cash_enabled INTEGER NOT NULL DEFAULT 1 CHECK (cash_enabled IN (0, 1)),
  asset_enabled INTEGER NOT NULL DEFAULT 1 CHECK (asset_enabled IN (0, 1)),
  stock_mode TEXT NOT NULL DEFAULT 'MATERIALS' CHECK (stock_mode IN ('MATERIALS', 'CUSTOM')),
  stock_product_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT ''
);

-- Langkah yang dimatikan Admin saat laci dibuka dicatat di sini (mis.
-- 'cash,assets') dan *_done_at-nya diisi saat itu juga, supaya laporan laci
-- bisa menulis "tidak diwajibkan" alih-alih "belum dikerjakan".
ALTER TABLE drawer_opening_checks ADD COLUMN skipped_parts TEXT NOT NULL DEFAULT '';
