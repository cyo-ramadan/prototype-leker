PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "tambahkan juga tombol anoncement" -- dikonfirmasi:
-- papan pengumuman SEARAH (Admin/Owner tulis, staf cuma baca), lingkupnya
-- "sama seperti manual book yang aku jelasin": entity-wide (Owner/Entity
-- Admin bikin, berlaku semua gerai) DITAMBAH per-gerai (Admin Gerai bikin
-- khusus gerainya). Beda dari Manual Book, pengumuman itu daftar/list
-- (banyak baris dari waktu ke waktu), bukan satu dokumen -- jadi satu
-- tabel dengan store_id NULLABLE: NULL = entity-wide (tampil di semua
-- gerai entity itu), terisi = cuma tampil di gerai itu.
--
-- Tidak ada endpoint edit isi (title/body) yang sudah tayang -- salah
-- ketik dibereskan dengan menonaktifkan (is_active=0) lalu buat baru,
-- supaya staf tidak bingung isi berubah diam-diam tanpa jejak.
CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  store_id TEXT REFERENCES stores(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('OWNER', 'ENTITY_ADMIN', 'ADMIN')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_announcements_entity_active_created
  ON announcements(entity_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_store_active_created
  ON announcements(store_id, is_active, created_at DESC);
