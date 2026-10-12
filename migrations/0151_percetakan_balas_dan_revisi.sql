PRAGMA foreign_keys = ON;

-- MAXI-PERCETAKAN-BALAS-REVISI-20261012 -- ADR-055 D10/D11.
--
-- Bos Cyo, 2026-10-12: "aku mau demo karyawan bisa sambil balas chat nya juga" dan "biar aja
-- karyawan lewat wa mengkoreksinya, yang penting kan ke record, bahwa mesin create, karyawan revisi.
-- langsung diteruskan ke antrean cetak."
--
-- 1. Balasan karyawan ke pelanggan dikirim dari Layar Cetak lewat WhatsApp Cloud API (nomor yang
--    tersambung API tidak bisa dibuka di aplikasi WA biasa). Setiap balasan -- terkirim atau gagal --
--    dicatat append-only, sama seperti pesan masuk: siapa, kapan, ke siapa, isinya apa.
-- 2. Revisi order tidak mengubah order lama (item dibekukan, rantai hash). Order lama ditutup dengan
--    status DIREVISI dan order baru dibuat; keduanya saling menunjuk lewat kolom di bawah. Tidak perlu
--    tabel baru: status order adalah teks bebas yang dijaga kode (src/percetakan.js).
--
-- Additive murni.

CREATE TABLE IF NOT EXISTS wa_outbound_messages (
  id                   TEXT PRIMARY KEY,
  store_id             TEXT NOT NULL REFERENCES stores(id),
  channel_id           TEXT NOT NULL REFERENCES wa_channels(id),
  provider             TEXT NOT NULL,
  to_number            TEXT NOT NULL,
  body_text            TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('TERKIRIM', 'GAGAL')),
  provider_message_id  TEXT,
  error                TEXT NOT NULL DEFAULT '',
  sent_by_role         TEXT NOT NULL,
  sent_by_id           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_wa_outbound_store_to ON wa_outbound_messages(store_id, to_number, created_at);

CREATE TRIGGER IF NOT EXISTS trg_wa_outbound_no_update
BEFORE UPDATE ON wa_outbound_messages
BEGIN SELECT RAISE(ABORT, 'wa_outbound_messages append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_wa_outbound_no_delete
BEFORE DELETE ON wa_outbound_messages
BEGIN SELECT RAISE(ABORT, 'wa_outbound_messages append-only'); END;

-- 3. Log Mesin (Bos Cyo, 2026-10-12): "file2 yang diproses oleh mesin cetak juga ada record nya dan
--    harus file yang sudah didaftarkan antrian. kalo ada file yang di print engga sesuai daftar antri
--    boleh juga tapi ada catatannya." Agen cetak melaporkan setiap file yang masuk mesin:
--    ANTRIAN = dikirim agen dari tiket antrian; LUAR_ANTRIAN = file muncul di hot folder bukan dari
--    agen (ditaruh operator sendiri). Append-only; alasan operator ditambahkan sebagai baris catatan.
CREATE TABLE IF NOT EXISTS print_machine_jobs (
  id           TEXT PRIMARY KEY,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  machine_id   TEXT NOT NULL REFERENCES print_machines(id),
  source       TEXT NOT NULL CHECK (source IN ('ANTRIAN', 'LUAR_ANTRIAN')),
  ticket_id    TEXT REFERENCES print_queue_tickets(id),
  order_id     TEXT REFERENCES print_orders(id),
  file_name    TEXT NOT NULL DEFAULT '',
  sha256       TEXT,
  size_bytes   INTEGER,
  detected_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_print_machine_jobs_store ON print_machine_jobs(store_id, created_at);

CREATE TRIGGER IF NOT EXISTS trg_print_machine_jobs_no_update
BEFORE UPDATE ON print_machine_jobs
BEGIN SELECT RAISE(ABORT, 'print_machine_jobs append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_machine_jobs_no_delete
BEFORE DELETE ON print_machine_jobs
BEGIN SELECT RAISE(ABORT, 'print_machine_jobs append-only'); END;

CREATE TABLE IF NOT EXISTS print_machine_job_notes (
  id          TEXT PRIMARY KEY,
  job_id      TEXT NOT NULL REFERENCES print_machine_jobs(id),
  store_id    TEXT NOT NULL REFERENCES stores(id),
  note        TEXT NOT NULL,
  actor_role  TEXT NOT NULL,
  actor_id    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TRIGGER IF NOT EXISTS trg_print_machine_job_notes_no_update
BEFORE UPDATE ON print_machine_job_notes
BEGIN SELECT RAISE(ABORT, 'print_machine_job_notes append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_machine_job_notes_no_delete
BEFORE DELETE ON print_machine_job_notes
BEGIN SELECT RAISE(ABORT, 'print_machine_job_notes append-only'); END;

-- Order hasil revisi menunjuk order asalnya (order asal berstatus DIREVISI, dan event DIREVISI-nya
-- menyimpan id order baru di payload_json).
ALTER TABLE print_orders ADD COLUMN revised_from_order_id TEXT REFERENCES print_orders(id);
