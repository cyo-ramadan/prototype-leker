PRAGMA foreign_keys = ON;

-- MAXI-STORE-PROVISIONING-DRIFT-20260825
--
-- Ditemukan Hana saat mencoba membuat gerai baru (Kantor/Pendem/Mandala,
-- migration 0052): INSERT INTO stores untuk edition='ACCOUNTING' gagal dengan
-- ITEM_CATEGORY_SCOPE_MISMATCH -- persis bug yang migration 0048 bilang sudah
-- diperbaiki, tapi ternyata belum, di production.
--
-- Root cause, dicek langsung lewat sqlite_schema (bukan diasumsikan dari ledger
-- -- CLAUDE.md invariant #7): ledger `d1_migrations` mencatat 0048 applied
-- 2026-08-22 16:26:21, TAPI trigger yang seharusnya dibuat migration itu
-- (`trg_payment_methods_seed_raw_material_product_kind`, AFTER INSERT ON
-- payment_methods WHEN code='CASH') TIDAK ADA di production. Sebagai
-- gantinya ada `trg_stores_seed_raw_material_product_kind` (AFTER INSERT ON
-- stores, tanpa gate edition) -- persis trigger yang komentar migration 0048
-- sendiri bilang JANGAN dipakai ("Do not seed the kind directly from AFTER
-- INSERT ON stores"). Trigger ini TIDAK ADA di satu pun file migration di
-- git history (`git log --all -S` nol hasil) -- artinya dibuat manual
-- langsung ke production di luar migration, lalu tidak pernah tercatat.
-- Ledger applied tidak membuktikan schema object masih lengkap, seperti yang
-- sudah ditulis di CLAUDE.md sebelum temuan ini.
--
-- Fix: buang trigger yang tidak tercatat itu, pasang lagi trigger yang
-- migration 0048 seharusnya sudah pasang -- byte-for-byte sama dengan definisi
-- di 0048, cuma dipasang ulang di sini karena migration yang sudah applied
-- tidak boleh ditulis ulang (invariant #7).

DROP TRIGGER IF EXISTS trg_stores_seed_raw_material_product_kind;

CREATE TRIGGER IF NOT EXISTS trg_payment_methods_seed_raw_material_product_kind
AFTER INSERT ON payment_methods
WHEN NEW.code = 'CASH'
  AND NOT EXISTS (
    SELECT 1
    FROM product_kinds k
    WHERE k.store_id = NEW.store_id
      AND k.code = 'RAW_MATERIAL'
  )
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES (
    'product_kind_' || NEW.store_id || '_raw_material',
    NEW.store_id,
    'RAW_MATERIAL',
    'Bahan Baku'
  );
END;
