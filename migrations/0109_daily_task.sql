PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "portal staf kasih tombol daily task ya, nanti
-- isi2nya aku mau kasih seperti pakai appron, bersih2, tes rasa2 ...
-- pengaturan task juga di set up oleh admin dari panel nya." Isi contoh
-- (apron/bersih-bersih/tes rasa) TIDAK di-hardcode -- Admin Gerai mengisi
-- daftar tugas hariannya sendiri lewat daily_task_templates, satu gerai
-- satu daftar (tidak otomatis dibagi ke gerai lain dalam entity yang sama).
CREATE TABLE IF NOT EXISTS daily_task_templates (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_daily_task_templates_store
  ON daily_task_templates(store_id, is_active, sort_order);

-- Satu baris per (template, kasir, tanggal bisnis Jakarta) -- UNIQUE
-- constraint yang menjaga idempotensi "tandai selesai" di level database,
-- bukan cuma dicegah di UI. business_date dipakai (bukan created_at mentah)
-- supaya checklist otomatis kosong lagi di hari berikutnya tanpa job
-- pembersihan apa pun -- baris lama tetap ada sebagai histori, cuma tidak
-- pernah muncul lagi di checklist "hari ini" begitu tanggalnya lewat.
CREATE TABLE IF NOT EXISTS daily_task_completions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES daily_task_templates(id),
  cashier_id TEXT NOT NULL REFERENCES cashiers(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (template_id, cashier_id, business_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_task_completions_lookup
  ON daily_task_completions(cashier_id, business_date);
