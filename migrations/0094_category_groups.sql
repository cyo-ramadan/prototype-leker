PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-15: kategori barang sekarang cuma satu tingkat (nempel
-- langsung ke produk sebagai teks bebas). Nambah "Kategori Utama" di
-- atasnya sebagai pengelompokan opsional -- kategori yang sudah ada jadi
-- sub-kategori di bawah kategori utama, tanpa perlu ubah data produk sama
-- sekali (products.category tetap nama sub-kategori apa adanya).
--
-- Kolomnya sengaja dinamai category_group_id, bukan group_id -- di codebase
-- ini group_id sudah punya arti sendiri (Customer Sharing Group, ADR-003)
-- dan test/tenancy-foundation.test.js menjaga supaya nama itu cuma dipakai
-- di satu tabel. Dua konsep beda harus punya nama beda.
CREATE TABLE IF NOT EXISTS category_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  UNIQUE (store_id, name)
);

-- Nullable: kategori yang sudah ada tetap valid tanpa kategori utama
-- ("belum dikelompokkan") sampai Admin menugaskan salah satu grup.
ALTER TABLE categories ADD COLUMN category_group_id INTEGER REFERENCES category_groups(id);

-- FOREIGN KEY di atas cuma menjamin id-nya valid, bukan bahwa grup itu
-- milik gerai yang sama -- SQLite tidak bisa menyandingkan dua kolom di
-- tabel berbeda lewat FK biasa. Trigger ini yang menjaga isolasi store_id
-- (invariant #5), meniru idiom trg_products_kind_scope_insert/update di
-- migration 0019.
CREATE TRIGGER IF NOT EXISTS trg_categories_group_scope_insert
BEFORE INSERT ON categories
WHEN NEW.category_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM category_groups g
    WHERE g.id = NEW.category_group_id AND g.store_id = NEW.store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_GROUP_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_group_scope_update
BEFORE UPDATE OF store_id, category_group_id ON categories
WHEN NEW.category_group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM category_groups g
    WHERE g.id = NEW.category_group_id AND g.store_id = NEW.store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_GROUP_SCOPE_MISMATCH');
END;
