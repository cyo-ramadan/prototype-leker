PRAGMA foreign_keys = ON;

-- Percontohan Entity Admin -- permintaan Bos Cyo 2026-09-04, buat coba fitur
-- "pilih gerai" di panel Entity Admin (lihat migration 0063). Supaya store-
-- picker-nya ada lebih dari 1 pilihan, tiga gerai pilot yang tadinya masing-
-- masing punya Entity sendiri (ENT-KANTOR/ENT-PENDEM/ENT-MANDALA, dari
-- migration 0052) digabung ke satu Entity baru ENT-KPM.
--
-- PENTING soal histori: PENDEM sudah punya 21 baris jurnal Accounting + 47
-- stock movement per saat migration ini ditulis. accounting_journal_headers/
-- lines, inventory_stock_balances/ledger_entries, dan stock_movements
-- menyimpan entity_id sebagai snapshot di baris masing-masing (migration
-- 0046) -- BUKAN join hidup ke stores.entity_id. Jadi baris historis PENDEM
-- itu TETAP tercatat di bawah ENT-PENDEM (entity lama), sementara transaksi
-- baru sesudah migration ini ter-posting ke ENT-KPM (entity baru). Ini bukan
-- bug -- konsisten dengan invariant "posted journal immutable" -- tapi wajib
-- diingat kalau nanti ada laporan akuntansi konsolidasi per-Entity: laporan
-- itu perlu tahu cara menggabungkan histori lama + baru, bukan cuma query
-- WHERE entity_id = 'ENT-KPM'. KANTOR dan MANDALA belum punya histori sama
-- sekali jadi tidak kena isu ini. Entity lama (ENT-KANTOR/ENT-PENDEM/
-- ENT-MANDALA) sengaja DIBIARKAN ada (jadi tanpa gerai) -- bukan dihapus,
-- supaya baris historis di atas tetap valid lewat FOREIGN KEY.
--
-- Password plaintext (SHA-256, pola sama seperti hashCredential() di
-- src/owner-auth.js dan seperti migration 0009/0054): dicatat di sini
-- sebagai referensi migrasi, sama seperti precedent sebelumnya. Ganti
-- password ini sebelum dipakai staf sungguhan, bukan percontohan lagi.
--
-- Rika (Akuntan): entityadmin_rika / rika_entity123
-- Alfina (HR):    entityadmin_alfina / alfina_entity123
--
-- Additive murni. Tidak menyentuh entity/store/entity_admin lain yang sudah
-- ada. Bergantung pada migration 0052 (gerai Kantor/Pendem/Mandala) dan 0063
-- (tabel entity_admins) sudah applied duluan.

INSERT INTO entities (id, name)
SELECT 'ENT-KPM', 'Kantor Pendem Mandala'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-KPM');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-KPM-01', 'ENT-KPM', 'TEN-PROTOTYPE', CURRENT_TIMESTAMP,
       'Gabungan pilot Kantor/Pendem/Mandala jadi 1 Entity, buat coba fitur pilih-gerai Entity Admin, 2026-09-04'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-KPM' AND effective_to IS NULL
);

UPDATE stores SET entity_id = 'ENT-KPM'
WHERE code IN ('KANTOR', 'PENDEM', 'MANDALA') AND entity_id != 'ENT-KPM';

-- entityadmin_rika / rika_entity123
INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_rika_pilot', 'ENT-KPM', 'entityadmin_rika',
       '668b9cf5f82061fd19aa6dd5dc7dbe935aeb6b075c975a57aa3632c9953f96b7',
       'Rika (Akuntan)', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'entityadmin_rika' COLLATE NOCASE);

-- entityadmin_alfina / alfina_entity123
INSERT INTO entity_admins (id, entity_id, username, password_hash, display_name, is_active)
SELECT 'entity_admin_alfina_pilot', 'ENT-KPM', 'entityadmin_alfina',
       'c08ef318ae04207342d935b7b111b0d4c8964dfd8ea79ebf2bca3ecb5d2dcc5c',
       'Alfina (HR)', 1
WHERE NOT EXISTS (SELECT 1 FROM entity_admins WHERE username = 'entityadmin_alfina' COLLATE NOCASE);
