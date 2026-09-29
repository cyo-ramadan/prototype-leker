PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-19: "tambahkan juga di portal staff tombol manual book"
-- -- dikonfirmasi: halaman baru, Admin isi sendiri (bukan link dokumen
-- eksternal). Lingkupnya dua lapis (dikonfirmasi lewat tanya balik Hana):
-- "diisi dari entity saja untuk info entity, tapi admin store tetap bisa
-- nambahin untuk info khusus store itu" -- jadi DUA tabel terpisah, bukan
-- satu tabel dengan store_id nullable, karena granularitasnya beda: konten
-- entity SELALU satu untuk semua gerai (diedit Owner/Entity Admin saja),
-- konten store SELALU tambahan khusus gerai itu (diedit Admin Gerai gerai
-- itu sendiri). Portal Staf menampilkan gabungan keduanya: bagian Entity
-- dulu, lalu bagian Store.
--
-- Bukan data akuntansi -- satu baris aktif per lingkup, ditimpa saat
-- diedit (BUKAN histori/immutable seperti journal).
CREATE TABLE IF NOT EXISTS entity_manual_book (
  entity_id TEXT PRIMARY KEY REFERENCES entities(id),
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS store_manual_book (
  store_id TEXT PRIMARY KEY REFERENCES stores(id),
  content TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
