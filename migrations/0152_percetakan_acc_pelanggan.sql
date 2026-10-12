-- MAXI-PERCETAKAN-ACC-PELANGGAN-20261012 -- ADR-055 D14.
--
-- Bos Cyo, 2026-10-12: "aku pikir una baca keseluruhan chat lalu menyimpulkan dan membuatkan draft
-- orderannya ketika si karyawan pencet tombol minta una bikinin draft. setelah draft jadi, draft
-- tersebut dikirim ke customer untuk makesure, kalo ok baru di post sebagai pesanan yang akan di
-- proses ke bagian produksi" -- lalu "ok bikin seperti itu".
--
-- Pola standar software percetakan (penawaran -> ACC pelanggan tercatat -> job ticket -> produksi).
-- Draft tetap berstatus MENUNGGU sampai diposting; tahap ACC dicatat di kolom acc_* (bukan status
-- baru) supaya CHECK lama tidak perlu dibangun ulang:
--   acc_status        '' (belum dikirim) | MENUNGGU_ACC | DISETUJUI
--   acc_items_json    rincian PERSIS yang dikirim ke pelanggan (harga dari master saat dikirim)
--   acc_method        PELANGGAN_WA (pelanggan membalas OK) | MANUAL (karyawan, wajib alasan)
--   acc_reply_message_id  pesan WA pelanggan yang menjadi bukti ACC
-- Additive murni.

ALTER TABLE print_order_drafts ADD COLUMN acc_status TEXT NOT NULL DEFAULT '';
ALTER TABLE print_order_drafts ADD COLUMN acc_items_json TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_total_scaled INTEGER;
ALTER TABLE print_order_drafts ADD COLUMN acc_message_text TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_sent_at TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_sent_by_role TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_sent_by_id TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_approved_at TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_method TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_reply_message_id TEXT;
ALTER TABLE print_order_drafts ADD COLUMN acc_note TEXT;

-- Gerai contoh pindah ke alur ACC (mode MANUAL = draft -> ACC pelanggan -> order). Mode OTOMATIS
-- (langsung jadi order dari pembaca aturan) tetap tersedia sebagai pilihan di Pengaturan.
UPDATE print_settings SET mode = 'MANUAL', updated_by_role = 'SYSTEM', updated_by_id = 'migration-0152'
WHERE store_id = 'store_cetak01' AND mode = 'OTOMATIS';
