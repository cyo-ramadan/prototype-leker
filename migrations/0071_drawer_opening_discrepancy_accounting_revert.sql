PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo (revisi lagi di hari yang sama): seluruh mekanisme
-- "saldo awal laci beda -> auto-permit -> ACC posting jurnal drawer_shortage/
-- drawer_surplus" dari migration 0070_drawer_opening_discrepancy_accounting.sql
-- dibatalkan. Saldo awal laci sekarang
-- read-only, melanjutkan saldo akhir laci sebelumnya (lihat src/cashier-drawer.js
-- di commit yang sama dengan migration ini) -- kalau kas fisik tidak cocok,
-- itu dibahas kasir langsung dengan akuntan di luar sistem ini; akuntan yang
-- bikin jurnalnya sendiri (jurnal manual, atau lewat permit Arus Kas yang
-- sudah ada dan memang perlu ACC akuntan). Tidak ada lagi kategori Jenis
-- Transaksi khusus untuk ini.
--
-- Migration 0070 sudah applied di production -- CLAUDE.md invariant #7
-- melarang menulis ulang migration yang sudah applied, jadi ini migration
-- forward baru yang membongkar scaffolding-nya, bukan edit 0070 itu sendiri.
--
-- coa_<store>_4202 ("Pendapatan Lainnya") SENGAJA TIDAK dihapus/disentuh --
-- akun itu bukan milik migration 0070, dia dipakai bersama sebagai default
-- cash_flow_in sejak migration 0028 dan tetap harus ada untuk kategori itu.
--
-- Satu approval_requests row nyata (purpose DRAWER_OPENING_DISCREPANCY, dibuat
-- 2026-09-04 sebelum revisi ini, di salah satu gerai pilot) sengaja TIDAK
-- disentuh di sini -- itu data kejadian nyata, bukan schema, dan bukan
-- migration ini tempatnya untuk menghapus/mengubah baris data. ACC pada baris
-- itu sekarang akan gagal aman (constraint cash_ledger_entries menolak
-- payload lama yang tidak punya direction/amount) karena
-- buildOperationalPostingStatements sudah kembali ke bentuk normal (tidak ada
-- branch DRAWER_OPENING_DISCREPANCY lagi) -- Admin/Owner tinggal Reject baris
-- itu lewat Approval Queue.

DROP TRIGGER IF EXISTS trg_stores_drawer_discrepancy_defaults_after_insert;

DELETE FROM journal_rules
WHERE transaction_category_id IN (
  SELECT id FROM transaction_categories WHERE code IN ('drawer_shortage', 'drawer_surplus')
);

DELETE FROM transaction_categories WHERE code IN ('drawer_shortage', 'drawer_surplus');
