PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-18: "masalah user yang uda login gampang ke refresh ini
-- bikin user jadi malas pakai pos ini ... harusnya meskipun dia buka program
-- pos ini 2 tab ga masalah, yang penting di 2 tab itu ga pindah user. mau
-- login juga kadang risih ada permintaan, mau pakai sesi ini, padahal terakhir
-- masih login. tolong masalah ini bener2 diberesin. user udah mulai risih."
--
-- INI YANG PALING DALAM dari rangkaian penyebabnya, dan satu-satunya yang
-- TIDAK kelihatan dari kode aplikasi sama sekali. Trigger dari migration 0011
-- menghapus SELURUH sesi lain milik karyawan itu setiap kali ada sesi baru
-- di-INSERT. Efek nyatanya: begitu karyawan membuka tab kedua (atau login dari
-- HP sementara laptopnya masih terbuka), sesi yang lama langsung dicabut di
-- level database -- tab lama jadi 401 dan dilempar balik ke halaman login,
-- tanpa ada satu baris kode aplikasi pun yang kelihatan melakukannya.
-- Membereskan sisi aplikasi saja (prompt "ambil alih sesi", guard antar tab,
-- token yang tidak lagi hilang saat tab ditutup) TIDAK akan menyelesaikan
-- keluhan Bos Cyo selama trigger ini masih terpasang.
--
-- Kenapa aman dicabut:
--   1. Validasi sesi dan logout dua-duanya per `token_hash`, bukan per akun
--      (src/cashier-auth.js, src/owner-auth.js) -- tiap sesi berdiri sendiri,
--      jadi logout di satu tempat tidak mematikan sesi di tempat lain.
--   2. Sesi tetap kedaluwarsa sendiri 12 jam (SESSION_HOURS), dan baris yang
--      sudah lewat tetap dibersihkan tiap login.
--   3. Akuntabilitas tidak berubah: transaksi dan laci dicatat per KARYAWAN
--      (cashier_id), bukan per sesi -- berapa pun jumlah sesinya, pemiliknya
--      tetap satu orang yang sama.
--   4. Aturan "jangan pindah user di satu browser" tetap ditegakkan, cuma
--      pindah tempat: sekarang di guard sisi klien (public/staff-tab-lock.js)
--      yang membandingkan identitas, bukan dengan mencabut sesi orang lain.
--
-- Yang DILEPAS di sini murni "satu sesi per akun". Sesi pelanggan memang tidak
-- pernah ikut aturan ini sejak awal, jadi tidak ada yang berubah untuk mereka.
DROP TRIGGER IF EXISTS trg_owner_single_session;
DROP TRIGGER IF EXISTS trg_store_admin_single_session;
DROP TRIGGER IF EXISTS trg_cashier_single_session;
