PRAGMA foreign_keys = ON;

-- Tiga gerai baru Leker: Kantor, Pendem, Mandala -- permintaan Bos Cyo 2026-08-25.
-- Masih dalam TEN-PROTOTYPE (tenant yang sama dengan store_001/store_002/M002),
-- masing-masing dapat Entity sendiri -- pola yang sama persis dengan tiga gerai
-- Leker yang sudah ada (satu Entity per gerai, semua di bawah satu Tenant).
--
-- edition='ACCOUNTING', warehouse_enabled=1: sama seperti gerai Leker lain.
-- Trigger AFTER INSERT ON stores (0024/0025/0026/0040/0045/0048/0049) yang
-- menyalakan seluruh chart_of_accounts, payment_methods, transaction_categories,
-- journal_rules (termasuk rule 'sale' lewat trg_sale_category_rules_after_insert),
-- product_kinds, dan item_categories -- terbukti jalan di store_002 (dicek
-- langsung sebelum migration ini ditulis). Tidak ada langkah manual susulan.
--
-- Additive murni. Tidak menyentuh tenant/entity/store yang sudah ada.

INSERT INTO entities (id, name)
SELECT 'ENT-KANTOR', 'Kantor'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-KANTOR');

INSERT INTO entities (id, name)
SELECT 'ENT-PENDEM', 'Pendem'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-PENDEM');

INSERT INTO entities (id, name)
SELECT 'ENT-MANDALA', 'Mandala'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-MANDALA');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-KANTOR-01', 'ENT-KANTOR', 'TEN-PROTOTYPE', CURRENT_TIMESTAMP,
       'Gerai baru Leker (Kantor), 2026-08-25, tenant sama dengan gerai Leker lain'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-KANTOR' AND effective_to IS NULL
);

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-PENDEM-01', 'ENT-PENDEM', 'TEN-PROTOTYPE', CURRENT_TIMESTAMP,
       'Gerai baru Leker (Pendem), 2026-08-25, tenant sama dengan gerai Leker lain'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-PENDEM' AND effective_to IS NULL
);

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-MANDALA-01', 'ENT-MANDALA', 'TEN-PROTOTYPE', CURRENT_TIMESTAMP,
       'Gerai baru Leker (Mandala), 2026-08-25, tenant sama dengan gerai Leker lain'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-MANDALA' AND effective_to IS NULL
);

INSERT INTO stores (id, code, store_name, address, is_active, edition, warehouse_enabled, entity_id)
SELECT 'store_kantor', 'KANTOR', 'Kantor', '', 1, 'ACCOUNTING', 1, 'ENT-KANTOR'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'KANTOR');

INSERT INTO stores (id, code, store_name, address, is_active, edition, warehouse_enabled, entity_id)
SELECT 'store_pendem', 'PENDEM', 'Pendem', '', 1, 'ACCOUNTING', 1, 'ENT-PENDEM'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'PENDEM');

INSERT INTO stores (id, code, store_name, address, is_active, edition, warehouse_enabled, entity_id)
SELECT 'store_mandala', 'MANDALA', 'Mandala', '', 1, 'ACCOUNTING', 1, 'ENT-MANDALA'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'MANDALA');
