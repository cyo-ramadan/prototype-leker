PRAGMA foreign_keys = ON;

-- MAXI-PERCETAKAN-CONTOH-20261010 -- ADR-055.
--
-- Bos Cyo, 2026-10-10: daftar mesin/produk/harga "kamu karang sendiri dulu cari referensi yang
-- pas". Isi awal gerai CETAK01 supaya layar Percetakan dan Una langsung bisa dicoba. Ini DATA
-- CONTOH, bukan harga Bos Cyo: Owner/Admin menggantinya dari layar Pengaturan (upsert per kode).
--
-- Referensi harga (listing marketplace Indonesia, dibaca 2026-10-10):
--   banner flexi korcin 440gr Rp28.000/m2, print A3+ Rp6.000/lembar, stiker vinyl A3+ kiss cut
--   Rp9.000-12.000, kartu nama 2 sisi Rp35.000. Flexi 280gr, print dokumen A4 = perkiraan umum.
-- Harga scaled INTEGER: 1 rupiah = 1.000.000 (invariant #1).
--
-- Hanya mengisi kalau kode belum ada, jadi aman diulang dan tidak menimpa isian Admin.

INSERT INTO print_machines (id, store_id, code, name, sort_order)
SELECT 'pmac_cetak01_outdoor', 'store_cetak01', 'OUTDOOR', 'Outdoor (banner/spanduk)', 1
WHERE NOT EXISTS (SELECT 1 FROM print_machines WHERE store_id = 'store_cetak01' AND code = 'OUTDOOR');

INSERT INTO print_machines (id, store_id, code, name, sort_order)
SELECT 'pmac_cetak01_a3plus', 'store_cetak01', 'A3PLUS', 'Digital A3+ (poster/stiker/kartu nama)', 2
WHERE NOT EXISTS (SELECT 1 FROM print_machines WHERE store_id = 'store_cetak01' AND code = 'A3PLUS');

INSERT INTO print_machines (id, store_id, code, name, sort_order)
SELECT 'pmac_cetak01_dokumen', 'store_cetak01', 'DOKUMEN', 'Printer dokumen A4', 3
WHERE NOT EXISTS (SELECT 1 FROM print_machines WHERE store_id = 'store_cetak01' AND code = 'DOKUMEN');

-- Satu INSERT per produk: D1 menolak SELECT gabungan (UNION ALL) yang panjang dengan
-- "too many terms in compound SELECT" -- SQLite lokal tidak punya batas itu (2026-10-10).
INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_flx280', 'store_cetak01', 'FLX280', 'Banner Flexi 280gr', 'M2', 22000000000, 'pmac_cetak01_outdoor',
       'banner, spanduk, baliho, flexi, mmt'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'FLX280')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_outdoor');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_flx440', 'store_cetak01', 'FLX440', 'Banner Flexi Korcin 440gr', 'M2', 28000000000, 'pmac_cetak01_outdoor',
       'banner korcin, flexi korcin, korcin, flexi 440, flexi tebal, banner premium, backdrop'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'FLX440')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_outdoor');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_a3ap', 'store_cetak01', 'A3AP', 'Print A3+ Art Paper', 'LEMBAR', 6000000000, 'pmac_cetak01_a3plus',
       'poster, brosur, flyer, pamflet, a3'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'A3AP')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_a3plus');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_a3stk', 'store_cetak01', 'A3STK', 'Stiker Vinyl A3+ (kiss cut)', 'LEMBAR', 10000000000, 'pmac_cetak01_a3plus',
       'stiker, sticker, label, cutting, vinyl, kiss cut'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'A3STK')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_a3plus');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_krtnm', 'store_cetak01', 'KRTNM', 'Kartu Nama 2 Sisi (1 box)', 'PCS', 35000000000, 'pmac_cetak01_a3plus',
       'kartu nama, name card, namecard'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'KRTNM')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_a3plus');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_a4bw', 'store_cetak01', 'A4BW', 'Print Dokumen A4 Hitam Putih', 'LEMBAR', 500000000, 'pmac_cetak01_dokumen',
       'print, dokumen, skripsi, makalah, hitam putih'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'A4BW')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_dokumen');

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT 'pprd_cetak01_a4clr', 'store_cetak01', 'A4CLR', 'Print Dokumen A4 Warna', 'LEMBAR', 1500000000, 'pmac_cetak01_dokumen',
       'print warna, dokumen warna, warna'
WHERE NOT EXISTS (SELECT 1 FROM print_products WHERE store_id = 'store_cetak01' AND code = 'A4CLR')
  AND EXISTS (SELECT 1 FROM print_machines WHERE id = 'pmac_cetak01_dokumen');

-- Bos Cyo, 2026-10-10: "yang paling penting ini otomatisasi task nya". Gerai contoh langsung
-- di mode OTOMATIS: chat yang terbaca lengkap jadi order + antrian tanpa ditekan karyawan.
INSERT INTO print_settings (store_id, mode, updated_by_role, updated_by_id)
SELECT 'store_cetak01', 'OTOMATIS', 'SYSTEM', 'migration-0146'
WHERE NOT EXISTS (SELECT 1 FROM print_settings WHERE store_id = 'store_cetak01');
