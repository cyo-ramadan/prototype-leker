-- MAXI-PERCETAKAN-TWILIO-20261010 -- ADR-055 D3 (revisi).
--
-- Bos Cyo, 2026-10-10: akun Facebook-nya kena pembatasan iklan sehingga tidak bisa membuat Portofolio
-- Bisnis Meta ("aku ga salah apa2 tapi tetep ga bisa komplain"). Uji coba WA dipindah ke Twilio
-- WhatsApp Sandbox (mitra resmi WhatsApp, daftar tanpa Facebook). wa_channels.provider perlu
-- menerima 'TWILIO'.
--
-- SQLite tidak bisa mengubah CHECK, jadi tabel dibangun ulang dengan isi yang sama persis.
-- wa_inbound_messages.channel_id mereferensikan tabel ini; defer_foreign_keys membuat pemeriksaan
-- FK menunggu sampai akhir transaksi, saat tabel baru (id sama) sudah bernama wa_channels lagi.

PRAGMA defer_foreign_keys = true;

CREATE TABLE wa_channels_baru (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  provider         TEXT NOT NULL CHECK (provider IN ('META_CLOUD', 'SIMULATOR', 'TWILIO')),
  phone_number_id  TEXT NOT NULL,
  display_number   TEXT NOT NULL DEFAULT '',
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, phone_number_id)
);

INSERT INTO wa_channels_baru (id, store_id, provider, phone_number_id, display_number, is_active, created_at)
SELECT id, store_id, provider, phone_number_id, display_number, is_active, created_at FROM wa_channels;

DROP TABLE wa_channels;

ALTER TABLE wa_channels_baru RENAME TO wa_channels;

PRAGMA defer_foreign_keys = false;
