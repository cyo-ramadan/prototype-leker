-- Rekrutmen Fina -- paket H4 (contracts/fina-hr-paket-v1.md): lowongan + pelamar.
-- Lowongan dibuat Admin atau Fina (selalu DRAFT); hanya Admin yang menayangkan (TAYANG) / menutup.
-- Halaman publik /loker?l=<slug> hanya membaca lowongan TAYANG, tanpa data internal.
-- Pelamar mengisi form publik; status pelamar hanya diubah Admin. Nomor WA tidak pernah dikirim ke
-- model (tidak ada rute baca agen untuk pelamar). ADR-030: entity_id ikut.
CREATE TABLE IF NOT EXISTS hr_lowongan (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL UNIQUE,
  posisi TEXT NOT NULL,
  deskripsi TEXT NOT NULL DEFAULT '',
  syarat TEXT NOT NULL DEFAULT '',
  jam_kerja TEXT NOT NULL DEFAULT '',
  gaji_teks TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'TAYANG', 'TUTUP')),
  dibuat_oleh_role TEXT NOT NULL DEFAULT '',
  dibuat_oleh_id TEXT NOT NULL DEFAULT '',
  diubah_oleh_role TEXT NOT NULL DEFAULT '',
  diubah_oleh_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_lowongan_entity ON hr_lowongan (entity_id, status);

CREATE TABLE IF NOT EXISTS hr_pelamar (
  id TEXT PRIMARY KEY,
  lowongan_id TEXT NOT NULL REFERENCES hr_lowongan(id),
  entity_id TEXT NOT NULL,
  nama TEXT NOT NULL,
  no_wa TEXT NOT NULL,
  domisili TEXT NOT NULL DEFAULT '',
  umur INTEGER CHECK (umur IS NULL OR umur BETWEEN 14 AND 80),
  pengalaman TEXT NOT NULL DEFAULT '',
  jawaban TEXT NOT NULL DEFAULT '{}',
  sumber TEXT NOT NULL DEFAULT 'WEB' CHECK (sumber IN ('WEB', 'FB', 'IG', 'WA', 'LAIN')),
  status TEXT NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU', 'SCREENING', 'INTERVIEW', 'DITERIMA', 'DITOLAK')),
  catatan TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  diubah_oleh_role TEXT NOT NULL DEFAULT '',
  diubah_oleh_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_lowongan ON hr_pelamar (lowongan_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_wa ON hr_pelamar (lowongan_id, no_wa, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_ip ON hr_pelamar (ip_hash, created_at);
