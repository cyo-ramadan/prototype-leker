-- Dua tabel ("consolidation_group_accounts", "consolidation_account_mapping")
-- ketemu nyangkut langsung di remote D1 production, tanpa pernah tercatat di
-- migration manapun di repo ini dan tidak dipakai kode manapun. Keduanya kosong
-- (0 baris, dicek langsung ke remote sebelum migration ini ditulis).
--
-- PENTING: ini BUKAN "consolidation_groups" dan "consolidation_membership" --
-- dua tabel itu memang resmi, dibuat migration 0039
-- (tenancy_and_consolidation_foundation) sebagai fondasi ADR-030 dan dijaga
-- test/tenancy-foundation.test.js. Migration ini sengaja TIDAK menyentuhnya.
--
-- Dua tabel yatim di sini kemungkinan besar bekas percobaan lanjutan
-- (chart-of-accounts per consolidation group) yang langsung ditembak ke
-- production tanpa pernah diresmikan lewat migration, dan sejak itu diam-diam
-- mengganjal setiap deploy: scripts/verify-remote-schema.mjs sengaja menolak
-- deploy begitu nemuin tabel yang keliatan seperti "buku akun kedua" (kolom
-- type dengan CHECK ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE di luar
-- chart_of_accounts) -- itu persis bentuk consolidation_group_accounts.
--
-- Urutan DROP mengikuti arah foreign key: consolidation_account_mapping
-- (mereferensi consolidation_group_accounts) duluan, baru
-- consolidation_group_accounts.
--
-- IF EXISTS supaya migration ini aman dijalankan di database mana pun yang
-- kebetulan tidak punya sisa tabel ini (lokal, test, atau instalasi production
-- lain yang bersih dari awal).

DROP TABLE IF EXISTS consolidation_account_mapping;
DROP TABLE IF EXISTS consolidation_group_accounts;
