PRAGMA foreign_keys = ON;

-- MAXI-SALE-POSTING-CONFIG-20260819
--
-- Keputusan Bos Cyo, 2026-08-19: untuk saat ini semua barang diwakili satu
-- Jenis Barang, dan persediaannya masuk `1301 Persediaan Bahan`. Pengelompokan
-- yang lebih halus dibuat manual lewat Setting Akuntansi kalau nanti dibutuhkan.
--
-- Migration ini mengisi konfigurasi, bukan jurnal. Tidak ada satu pun baris
-- ditulis ke accounting_journal_headers/lines di sini. Jurnal tetap terbit lewat
-- lane Accounting yang sudah ada (`POST /api/admin/accounting/bridge/sync`),
-- karena Accounting yang memiliki interpretasi — bukan migration (ADR-029, R5).
--
-- Yang diperbaiki: 11 penjualan gagal posting berhari-hari dengan
-- `NEEDS_PRODUCT_KIND` dan `NEEDS_MAPPING`. Penyebabnya konfigurasi yang belum
-- lengkap, bukan bug, dan resolver memang benar menolak menebak akun.

-- 1. Satu Jenis Barang per gerai.
--
-- Gerai yang sudah punya (store_001) dilewati, supaya migration ini tidak
-- menyentuh konfigurasi yang sudah dipakai jurnal pembelian yang sudah posted.
INSERT INTO product_kinds (id, store_id, code, name)
SELECT 'product_kind_' || s.id || '_raw_material', s.id, 'RAW_MATERIAL', 'Bahan Baku'
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM product_kinds k WHERE k.store_id = s.id AND k.code = 'RAW_MATERIAL'
);

-- 2. Pemetaan akunnya: Persediaan 1301, HPP 5101, Pendapatan 4101.
--
-- Akun dicari lewat kode per gerai, bukan id literal, karena tiap gerai punya
-- id akun sendiri (`coa_store_001_1301`). Meng-hardcode id akan mengikat
-- migration ini ke satu gerai dan membuat gerai baru gagal.
INSERT INTO item_categories (
  id, store_id, product_kind_id, name,
  inventory_account_id, cogs_account_id, revenue_account_id
)
SELECT 'itemcat_' || k.id, k.store_id, k.id, k.name, inv.id, cogs.id, rev.id
FROM product_kinds k
JOIN chart_of_accounts inv  ON inv.store_id  = k.store_id AND inv.code  = '1301' AND inv.is_active  = 1
JOIN chart_of_accounts cogs ON cogs.store_id = k.store_id AND cogs.code = '5101' AND cogs.is_active = 1
JOIN chart_of_accounts rev  ON rev.store_id  = k.store_id AND rev.code  = '4101' AND rev.is_active  = 1
WHERE k.code = 'RAW_MATERIAL'
  AND NOT EXISTS (
    SELECT 1 FROM item_categories c
    WHERE c.store_id = k.store_id AND c.product_kind_id = k.id
  );

-- 3. Barang yang belum punya Jenis Barang mengikuti Jenis Barang tunggal itu.
--
-- Hanya yang kosong. Barang yang sudah punya Jenis Barang tidak dipindahkan,
-- supaya migration ini tidak diam-diam mengubah akun persediaan barang yang
-- sudah pernah masuk jurnal.
UPDATE products
SET product_kind_id = (
      SELECT k.id FROM product_kinds k
      WHERE k.store_id = products.store_id AND k.code = 'RAW_MATERIAL'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE (product_kind_id IS NULL OR product_kind_id = '')
  AND EXISTS (
    SELECT 1 FROM product_kinds k
    WHERE k.store_id = products.store_id AND k.code = 'RAW_MATERIAL'
  );

-- 4. Rule `sale` untuk gerai yang belum punya — cermin persis dari store_001.
--
-- Tiap baris dijaga terpisah per source_type, bukan sekali cek per kategori,
-- supaya gerai yang rule-nya baru terisi separuh ikut dilengkapi dan bukan
-- dilewati.
INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || c.store_id || '_sale_payment', c.store_id, c.id,
       'Pembayaran Penjualan', 'DEBIT', 'payment_method', 10
FROM transaction_categories c
WHERE c.code = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM journal_rules r
    WHERE r.transaction_category_id = c.id AND r.source_type = 'payment_method'
  );

INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || c.store_id || '_sale_revenue', c.store_id, c.id,
       'Pendapatan sesuai Jenis Barang', 'CREDIT', 'item_category_revenue', 20
FROM transaction_categories c
WHERE c.code = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM journal_rules r
    WHERE r.transaction_category_id = c.id AND r.source_type = 'item_category_revenue'
  );

INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || c.store_id || '_sale_cogs', c.store_id, c.id,
       'HPP sesuai Jenis Barang', 'DEBIT', 'item_category_cogs', 30
FROM transaction_categories c
WHERE c.code = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM journal_rules r
    WHERE r.transaction_category_id = c.id AND r.source_type = 'item_category_cogs'
  );

INSERT INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || c.store_id || '_sale_inventory', c.store_id, c.id,
       'Persediaan Keluar sesuai Jenis Barang', 'CREDIT', 'item_category_inventory', 40
FROM transaction_categories c
WHERE c.code = 'sale'
  AND NOT EXISTS (
    SELECT 1 FROM journal_rules r
    WHERE r.transaction_category_id = c.id AND r.source_type = 'item_category_inventory'
  );

-- 5. Gerai yang dibuat setelah ini ikut terkonfigurasi sendiri.
--
-- Tanpa ini, migration di atas hanya menambal gerai yang sudah ada, dan gerai
-- berikutnya lahir dengan cacat yang sama persis: `sale` terdaftar di Setting
-- Akuntansi, tampak siap, tetapi tidak punya satu pun rule sehingga tidak satu
-- pun penjualan bisa terbit. Itulah yang terjadi pada G002.
--
-- Trigger dipasang pada `transaction_categories`, mengikuti idiom
-- `trg_purchase_category_rules_after_insert` di migration 0029, dan bukan pada
-- `stores`, karena pada titik itu chart of accounts gerai sudah terbentuk.
-- Insert `product_kinds` di bawah otomatis memicu
-- `trg_product_kinds_seed_accounting_mapping` yang membuat pemetaan akunnya.
CREATE TRIGGER IF NOT EXISTS trg_sale_category_rules_after_insert
AFTER INSERT ON transaction_categories
WHEN NEW.code = 'sale'
BEGIN
  INSERT OR IGNORE INTO product_kinds (id, store_id, code, name)
  VALUES ('product_kind_' || NEW.store_id || '_raw_material', NEW.store_id, 'RAW_MATERIAL', 'Bahan Baku');

  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_sale_payment', NEW.store_id, NEW.id,
          'Pembayaran Penjualan', 'DEBIT', 'payment_method', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_sale_revenue', NEW.store_id, NEW.id,
          'Pendapatan sesuai Jenis Barang', 'CREDIT', 'item_category_revenue', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_sale_cogs', NEW.store_id, NEW.id,
          'HPP sesuai Jenis Barang', 'DEBIT', 'item_category_cogs', 30);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
  VALUES ('jrule_' || NEW.store_id || '_sale_inventory', NEW.store_id, NEW.id,
          'Persediaan Keluar sesuai Jenis Barang', 'CREDIT', 'item_category_inventory', 40);
END;

-- 6. Guard.
--
-- Migration yang "berhasil" tetapi meninggalkan konfigurasi separuh jadi adalah
-- persis cara 11 penjualan itu bisa gagal berhari-hari tanpa ketahuan. Kalau
-- salah satu prasyarat posting penjualan masih bolong sesudah langkah 1-4,
-- migration ini gagal di sini dan deploy berhenti.
CREATE TABLE IF NOT EXISTS sale_posting_config_guard_20260819 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM sale_posting_config_guard_20260819;
INSERT INTO sale_posting_config_guard_20260819 (ok)
SELECT CASE WHEN (
  -- tidak ada barang aktif tanpa Jenis Barang
  (SELECT COUNT(*) FROM products WHERE is_active = 1 AND (product_kind_id IS NULL OR product_kind_id = '')) = 0
  -- tiap Jenis Barang yang dipakai barang aktif punya pemetaan akun lengkap
  AND (
    SELECT COUNT(*) FROM products p
    WHERE p.is_active = 1
      AND NOT EXISTS (
        SELECT 1 FROM item_categories c
        WHERE c.store_id = p.store_id AND c.product_kind_id = p.product_kind_id AND c.is_active = 1
          AND c.inventory_account_id <> '' AND c.cogs_account_id <> ''
          AND c.revenue_account_id IS NOT NULL AND c.revenue_account_id <> ''
      )
  ) = 0
  -- tiap kategori `sale` aktif punya minimal satu Debit dan satu Kredit aktif
  AND (
    SELECT COUNT(*) FROM transaction_categories c
    WHERE c.code = 'sale' AND c.is_active = 1
      AND (
        (SELECT COUNT(*) FROM journal_rules r
         WHERE r.transaction_category_id = c.id AND r.is_active = 1 AND r.side = 'DEBIT') = 0
        OR (SELECT COUNT(*) FROM journal_rules r
            WHERE r.transaction_category_id = c.id AND r.is_active = 1 AND r.side = 'CREDIT') = 0
      )
  ) = 0
) THEN 1 ELSE 0 END;
DROP TABLE sale_posting_config_guard_20260819;
