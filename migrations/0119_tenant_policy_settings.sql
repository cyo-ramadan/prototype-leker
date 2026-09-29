PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24 (koreksi atas migration 0118): "setting2 jangan
-- ditaruh disitu. jadi model setting2 sebenernya aku siapkan untuk beda
-- tenant apabila mereka memiliki kebijakan kusus ... hal ini berlaku juga
-- nanti untuk setting2 lainnya. intinya opsi on/off nya itu adalah
-- kebijakan suatu tenant."
--
-- migration 0118 menaruh saklar sebagai kolom di `stores` -- persis pola
-- yang sudah ditandai salah di ADR-040 ("Saklar yang ada itu per-gerai,
-- bukan per-tenant, dan cuma dua ... satu kolom boolean per modul tidak
-- bertahan sampai sepuluh modul, dan levelnya gerai, bukan tenant") dan
-- keputusan D3-nya: "Modul aktif dicatat per tenant, di tabel, bukan di
-- kolom." Tabel ini itu -- generik, satu baris per (tenant, kunci
-- kebijakan), supaya "setting2 lainnya" yang Bos Cyo maksud tidak butuh
-- migration baru tiap kali nambah satu saklar.
--
-- stores.attendance_schedule_gate_enabled (migration 0118) SENGAJA
-- DIBIARKAN, bukan dicabut lewat rebuild tabel -- `stores` punya 10
-- trigger AFTER INSERT yang menyemai default Chart of Accounts, payment
-- methods, transaction categories, journal rules, item types, units, dan
-- cost master tiap kali gerai baru dibuat. Rebuild tabel (pola migration
-- 0112/0116) TIDAK memindahkan trigger secara otomatis -- kalau dilakukan
-- di sini tanpa menulis ulang kesepuluhnya persis sama, gerai baru
-- berikutnya diam-diam kehilangan seluruh bootstrap akuntansinya. Ini
-- persis yang diperingatkan ADR-040 D3 sendiri: "Menghapus lebih awal
-- adalah cara paling gampang mematikan gerai yang sedang jalan." Kolom itu
-- cukup berhenti dibaca/ditulis kode aplikasi (lihat src/cashier-auth.js) --
-- jadi kolom mati, sama seperti stores.edition/warehouse_enabled yang
-- ADR-040 sendiri sebut dibiarkan sampai terbukti tidak ada jalur baca lagi.
CREATE TABLE tenant_policy_settings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (tenant_id, setting_key)
);
