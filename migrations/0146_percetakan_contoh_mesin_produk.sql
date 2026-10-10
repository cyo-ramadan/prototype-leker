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

INSERT INTO print_products (id, store_id, code, name, unit, unit_price_scaled, machine_id, keywords)
SELECT v.id, 'store_cetak01', v.code, v.name, v.unit, v.price, m.id, v.keywords
FROM (
  SELECT 'pprd_cetak01_flx280' AS id, 'FLX280' AS code, 'Banner Flexi 280gr' AS name, 'M2' AS unit,
         22000000000 AS price, 'OUTDOOR' AS machine, 'banner, spanduk, baliho, flexi, mmt' AS keywords
  UNION ALL SELECT 'pprd_cetak01_flx440', 'FLX440', 'Banner Flexi Korcin 440gr', 'M2',
         28000000000, 'OUTDOOR', 'korcin, flexi tebal, banner premium, backdrop'
  UNION ALL SELECT 'pprd_cetak01_a3ap', 'A3AP', 'Print A3+ Art Paper', 'LEMBAR',
         6000000000, 'A3PLUS', 'poster, brosur, flyer, pamflet, a3'
  UNION ALL SELECT 'pprd_cetak01_a3stk', 'A3STK', 'Stiker Vinyl A3+ (kiss cut)', 'LEMBAR',
         10000000000, 'A3PLUS', 'stiker, sticker, label, cutting'
  UNION ALL SELECT 'pprd_cetak01_krtnm', 'KRTNM', 'Kartu Nama 2 Sisi (1 box)', 'PCS',
         35000000000, 'A3PLUS', 'kartu nama, name card, box'
  UNION ALL SELECT 'pprd_cetak01_a4bw', 'A4BW', 'Print Dokumen A4 Hitam Putih', 'LEMBAR',
         500000000, 'DOKUMEN', 'print, dokumen, skripsi, makalah, hitam putih'
  UNION ALL SELECT 'pprd_cetak01_a4clr', 'A4CLR', 'Print Dokumen A4 Warna', 'LEMBAR',
         1500000000, 'DOKUMEN', 'print warna, dokumen warna'
) v
JOIN print_machines m ON m.store_id = 'store_cetak01' AND m.code = v.machine
WHERE NOT EXISTS (SELECT 1 FROM print_products p WHERE p.store_id = 'store_cetak01' AND p.code = v.code);
