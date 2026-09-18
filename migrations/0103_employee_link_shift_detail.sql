PRAGMA foreign_keys = ON;

-- Detail shift per TAUTAN (bukan per karyawan) -- Bos Cyo, 2026-09-18: "kasi
-- kolom gaji per jam, dan jam kerjanya (dari dan sampai), jenis pekerjaan...
-- satu nama bisa ditautkan di beberapa akun ya. misal ani dia di gerai dermo
-- kerja sebagai shift 1, tapi juga jadi shift 3 dimana memiliki jam kerja
-- yang beda tergantung ngisi detilnya."
--
-- Sengaja ditaruh di employee_account_links, BUKAN di employees. Satu orang
-- (employees) sudah bisa punya beberapa tautan aktif sekaligus (tidak ada
-- constraint yang membatasi itu -- yang dibatasi cuma satu akun cuma boleh
-- satu pemegang aktif, lihat idx_employee_link_one_active_holder di migration
-- 0072). Kalau detail shift ditaruh di employees, Ani cuma bisa punya SATU
-- gaji/jam kerja untuk seluruh tautannya -- padahal shift 1 dan shift 3 jelas
-- beda jam, mungkin juga beda gaji per jam dan jenis pekerjaannya. Menaruhnya
-- di link membuat tiap penugasan (assignment) berdiri sendiri, persis
-- kebutuhan yang diminta.
--
-- hourly_wage_scaled: skala 1.000.000 = 1 rupiah, pola yang sama dengan
-- semua nilai uang authoritative lain di sistem ini (CLAUDE.md invariant #1)
-- -- gaji per jam dipakai menghitung nominal gaji sungguhan nantinya, jadi
-- tidak boleh floating-point sejak awal disimpan, walau perhitungan
-- payroll-nya sendiri belum dibangun di migration ini.
--
-- shift_start/shift_end: jam mulai/selesai kerja, format "HH:MM" 24 jam,
-- wall-clock lokal gerai (tidak perlu timezone -- ini jadwal kerja, bukan
-- timestamp kejadian). Dua-duanya nullable: kosong berarti belum diisi
-- detailnya, bukan berarti shift 24 jam atau shift kosong.
--
-- job_type: teks bebas ("Kasir Shift Pagi", "Pramuniaga", dst) -- SENGAJA
-- bukan enum. account_type (CASHIER/STORE_ADMIN/ENTITY_ADMIN) sudah menjawab
-- "akun jenis apa"; job_type ini menjawab pertanyaan yang beda, "kerjanya
-- ngapain" -- dua gerai bisa punya sebutan berbeda untuk kasir yang sama.
--
-- Trigger trg_employee_link_history_immutable (migration 0072) TIDAK
-- terpicu oleh UPDATE ke tiga kolom ini -- WHEN clause-nya cuma menjaga
-- employee_id/entity_id/account_type/account_id/effective_from/store_id,
-- jadi detail shift tetap boleh diedit selama tautannya masih aktif
-- (effective_to IS NULL), tanpa perlu menutup lalu membuka tautan baru
-- cuma untuk mengoreksi jam kerja.
ALTER TABLE employee_account_links ADD COLUMN hourly_wage_scaled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employee_account_links ADD COLUMN shift_start TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_account_links ADD COLUMN shift_end TEXT NOT NULL DEFAULT '';
ALTER TABLE employee_account_links ADD COLUMN job_type TEXT NOT NULL DEFAULT '';
