PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-15: kategori dibikin ada sub-kategori -- "yang sekarang
-- itu dijadikan sub kategori aja". Hierarki kategorinya SENDIRI sudah ada
-- lewat categories.parent_category_id (migration 0085, dipakai 73 barang
-- Leker gerai Dermo), tapi baru migration-owned: belum ada pagar yang aman
-- dibuka lewat CRUD Admin (lihat contracts/category-hierarchy-v1.md ->
-- v2). Migration ini TIDAK menambah kolom baru -- cuma menambah dua pagar
-- yang belum ada di 0085, meniru idiom trg_products_kind_scope_insert/
-- update (migration 0019): isolasi store_id, dan larangan kategori jadi
-- induk dirinya sendiri. Aturan "cuma satu tingkat" (kategori yang sudah
-- jadi induk tidak boleh dibikin sub-kategori, dan sebaliknya) divalidasi
-- di API Admin, bukan di trigger -- itu aturan produk yang bisa berubah,
-- bukan invariant data yang harus dikunci di database.
CREATE TRIGGER IF NOT EXISTS trg_categories_parent_scope_insert
BEFORE INSERT ON categories
WHEN NEW.parent_category_id IS NOT NULL
  AND (
    NEW.parent_category_id = NEW.id
    OR NOT EXISTS (
      SELECT 1 FROM categories parent
      WHERE parent.id = NEW.parent_category_id AND parent.store_id = NEW.store_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_PARENT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_parent_scope_update
BEFORE UPDATE OF store_id, parent_category_id ON categories
WHEN NEW.parent_category_id IS NOT NULL
  AND (
    NEW.parent_category_id = NEW.id
    OR NOT EXISTS (
      SELECT 1 FROM categories parent
      WHERE parent.id = NEW.parent_category_id AND parent.store_id = NEW.store_id
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'CATEGORY_PARENT_SCOPE_MISMATCH');
END;
