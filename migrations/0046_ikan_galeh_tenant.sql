PRAGMA foreign_keys = ON;

-- MAXI-IKAN-GALEH-TENANT-20260822
--
-- Ikan-galeh (olshop ikan dari petani) jadi Tenant kedua di platform yang sama,
-- dipisah dari Prototype Leker (TEN-PROTOTYPE) lewat Entity/Tenant (ADR-030) --
-- bukan lewat database terpisah. Keputusan Bos Cyo 2026-08-22, setelah dicek:
-- store_id isolation sendirian tidak cukup begitu ada pelanggan kedua
-- (KNOWN_PITFALLS.md), jadi gerai ini WAJIB lewat entity_id, bukan cuma store_id.
--
-- edition='LITE', warehouse_enabled=0: Galeh tidak butuh Accounting maupun
-- Warehouse (lihat POS_MODULE_INDEPENDENCE.md, ikan-galeh/CLAUDE.md). HPP-nya
-- mode DIRECT_FROM_PURCHASE (ADR-037 SS2.3) -- itu sudah DEFAULT Manufaktur, tidak
-- perlu mode "dropship" baru; dropship di sini murni soal siapa yang membuat baris
-- Pembelian (otomatis dari Sale), bukan cara HPP dihitung.
--
-- Gerai edition=LITE SENGAJA tidak dapat baris product_kinds/item_categories/
-- journal_rules default (0040/0045 seeding-nya gated ke edition='ACCOUNTING')
-- -- itu bukan celah, itu konsep Klasifikasi Accounting yang memang opsional
-- (ADR-025). test/sale-posting-config.test.js dan test/stores-edition.test.js
-- sudah disesuaikan supaya perbandingannya tidak salah kira gerai ini "rusak"
-- karena tidak punya baris-baris itu.
--
-- PENTING -- dicatat di sini supaya tidak diasumsikan salah oleh sesi lain: gerai
-- ini baru AMAN dipakai transaksi sungguhan setelah task papan
-- `karen-BS-DISPATCH-GATING` selesai (gating Accounting di titik panggil). Sampai
-- saat itu, migration ini cuma mendaftarkan data (tenant/entity/store) -- BELUM ada
-- kasir/API yang mengarah ke gerai ini.
--
-- Additive murni. Tidak menyentuh tenant/entity/store Leker yang sudah ada.

INSERT INTO tenants (id, name)
SELECT 'TEN-GALEH', 'Galeh'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-GALEH');

INSERT INTO entities (id, name)
SELECT 'ENT-GALEH', 'Galeh - Olshop Ikan'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-GALEH');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-GALEH-01', 'ENT-GALEH', 'TEN-GALEH', CURRENT_TIMESTAMP,
       'Onboarding Ikan-galeh sebagai tenant kedua platform, 2026-08-22'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-GALEH' AND effective_to IS NULL
);

INSERT INTO stores (id, code, store_name, address, is_active, edition, warehouse_enabled, entity_id)
SELECT 'store_ikan01', 'IKAN01', 'Galeh - Ikan dari Petani', '', 1, 'LITE', 0, 'ENT-GALEH'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'IKAN01');
