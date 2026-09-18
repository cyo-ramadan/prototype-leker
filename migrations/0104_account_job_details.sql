PRAGMA foreign_keys = ON;

-- Koreksi Bos Cyo, 2026-09-18: "hana kamu salah naruh, harus nya detil itu
-- tadi kamu taruh di user kasir/staf. bukan malah di nama orangnya ...
-- tombol karyawan itu yang aku maksudkan nama orang, sedangkan yang ada di
-- master kasir itu adalah employed atau pekerjaannya."
--
-- Migration 0103 menaruh detail shift (gaji per jam, jam kerja, jenis
-- pekerjaan) di employee_account_links -- alasannya waktu itu: satu
-- karyawan dengan beberapa akun (Ani shift 1 vs shift 3) butuh detail beda
-- per akun, dan menaruhnya di TAUTAN otomatis meniru filosofi "riwayat
-- menempel ke siapa yang memegang SAAT itu" dari migration 0072.
--
-- Itu salah baca maksud Bos Cyo. Mental model yang benar: "Karyawan"
-- (employees) murni IDENTITAS ORANG -- nama, telepon, alamat, nomor
-- identitas. "Kasir/Staf" (akunnya) adalah JABATAN itu sendiri -- "Kasir
-- Shift 1" adalah jabatan dengan jam & gaji yang melekat padanya, siapa pun
-- yang sedang memegangnya. Detail shift itu properti JABATAN (akun), bukan
-- properti tautan person-ke-akun. Contoh Bos Cyo sendiri (shift 1 dan shift
-- 3 Ani) sebenarnya sudah dua AKUN BERBEDA -- jadi menaruh detail di level
-- akun tetap otomatis mendukung "detail beda per shift" tanpa perlu tautan
-- sama sekali.
--
-- account_job_details -- satu baris per (account_type, account_id), lepas
-- total dari employee_account_links. Sengaja BERTAHAN walau akun dioper ke
-- karyawan lain (itu memang sifat jabatan, bukan sifat orang, per definisi
-- Bos Cyo di atas) -- kalau gaji jabatan itu perlu diubah waktu ganti
-- pemegang, itu keputusan Admin yang mengedit manual lewat Master Kasir,
-- bukan sesuatu yang di-reset otomatis oleh sistem.
CREATE TABLE IF NOT EXISTS account_job_details (
  account_type TEXT NOT NULL CHECK (account_type IN ('CASHIER', 'STORE_ADMIN', 'ENTITY_ADMIN')),
  account_id TEXT NOT NULL,
  hourly_wage_scaled INTEGER NOT NULL DEFAULT 0,
  shift_start TEXT NOT NULL DEFAULT '',
  shift_end TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_type, account_id)
);

-- Empat kolom senama di employee_account_links (migration 0103) berhenti
-- dipakai kode mulai migration ini -- SENGAJA TIDAK di-DROP. Dicek langsung
-- ke produksi sebelum migration ini ditulis: 5 tautan aktif, tidak satu pun
-- terisi (fiturnya baru live beberapa jam, belum sempat dipakai). Tapi
-- `ALTER TABLE ... DROP COLUMN` belum pernah dipakai di migration manapun
-- di repo ini, dan tabel employee_account_links punya dua trigger aktif
-- (trg_employee_link_scope_insert, trg_employee_link_history_immutable) --
-- tidak ada manfaat mengambil risiko itu untuk pembersihan yang sifatnya
-- kosmetik. Kolomnya dibiarkan menganggur, selalu default kosong/nol.
