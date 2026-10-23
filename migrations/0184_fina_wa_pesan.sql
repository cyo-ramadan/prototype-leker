-- WA Fina lewat gateway lokal (Bos Cyo, 2026-10-22; Sambungan Fina 0183). Terpisah dari
-- wa_inbound_messages milik Percetakan (ADR-055) supaya modul itu tidak berubah.
--
-- hr_wa_masuk : pesan personal yang diteruskan gateway (sekali per id pesan per entity). Pengirim
--               dikenali kode: pelamar (nomor di hr_pelamar) / karyawan (nomor di employees) / asing.
-- hr_wa_keluar: pesan yang disiapkan Fina atau Admin. Hanya DISETUJUI (tombol manusia / "Ya") yang
--               diambil gateway; hasilnya DIKIRIM / GAGAL. Tidak ada broadcast.
CREATE TABLE IF NOT EXISTS hr_wa_masuk (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  wa_id TEXT NOT NULL,
  jid TEXT NOT NULL,
  no_wa TEXT NOT NULL DEFAULT '',
  nama_wa TEXT NOT NULL DEFAULT '',
  teks TEXT NOT NULL DEFAULT '',
  jenis_media TEXT NOT NULL DEFAULT '',
  dikirim_at TEXT,
  diterima_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pengirim TEXT NOT NULL DEFAULT 'ASING' CHECK (pengirim IN ('PELAMAR', 'KARYAWAN', 'ASING')),
  pelamar_id TEXT,
  employee_id TEXT,
  status TEXT NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU', 'DIBACA', 'DIPROSES')),
  UNIQUE (entity_id, wa_id)
);
CREATE INDEX IF NOT EXISTS idx_hr_wa_masuk_entity ON hr_wa_masuk (entity_id, diterima_at);
CREATE INDEX IF NOT EXISTS idx_hr_wa_masuk_no ON hr_wa_masuk (entity_id, no_wa);

CREATE TABLE IF NOT EXISTS hr_wa_keluar (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  no_wa TEXT NOT NULL,
  nama_tujuan TEXT NOT NULL DEFAULT '',
  tujuan_jenis TEXT NOT NULL DEFAULT 'LAIN' CHECK (tujuan_jenis IN ('PELAMAR', 'KARYAWAN', 'LAIN')),
  ref_id TEXT,
  teks TEXT NOT NULL,
  keperluan TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'DISETUJUI', 'DIAMBIL', 'DIKIRIM', 'GAGAL', 'BATAL')),
  dibuat_oleh_role TEXT NOT NULL DEFAULT '',
  dibuat_oleh_id TEXT NOT NULL DEFAULT '',
  disetujui_oleh_role TEXT NOT NULL DEFAULT '',
  disetujui_oleh_id TEXT NOT NULL DEFAULT '',
  disetujui_at TEXT,
  diambil_at TEXT,
  dikirim_at TEXT,
  gagal_alasan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_wa_keluar_antrean ON hr_wa_keluar (entity_id, status, disetujui_at);
CREATE INDEX IF NOT EXISTS idx_hr_wa_keluar_no ON hr_wa_keluar (entity_id, no_wa, dikirim_at);
