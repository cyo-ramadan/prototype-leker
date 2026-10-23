-- Sambungan Fina per entity (Bos Cyo, 2026-10-22): WA, email, Instagram, Facebook milik tenant
-- dihubungkan ke Fina dari Entity Admin -> Pengaturan -> Sambungan Fina.
--   WA    : gateway lokal (perangkat tertaut, jalur tidak resmi pilihan Bos) memakai token per entity.
--           Token disimpan sebagai hash; nilai aslinya hanya tampil sekali saat dibuat.
--   EMAIL : penerusan email masuk (butuh domain email di Cloudflare; status disimpan dulu).
--   IG/FB : identitas akun dicatat; otomatisasi terhalang akun Meta (lihat catatan 0148).
-- ADR-030: entity_id ikut. Tidak mengubah wa_channels milik Percetakan (ADR-055).
CREATE TABLE IF NOT EXISTS hr_kanal (
  entity_id TEXT NOT NULL,
  jenis TEXT NOT NULL CHECK (jenis IN ('WA', 'EMAIL', 'IG', 'FB')),
  aktif INTEGER NOT NULL DEFAULT 0 CHECK (aktif IN (0, 1)),
  identitas TEXT NOT NULL DEFAULT '',
  catatan TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL DEFAULT '',
  token_dibuat_at TEXT,
  terakhir_terlihat TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (entity_id, jenis)
);
CREATE INDEX IF NOT EXISTS idx_hr_kanal_token ON hr_kanal (token_hash);
