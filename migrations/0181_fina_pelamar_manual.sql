-- Pelamar diinput manual dari Entity Admin -> Karyawan -> Pelamar (Bos Cyo, 2026-10-22): calon
-- karyawan tidak selalu datang lewat lowongan /loker. hr_pelamar (0176) mewajibkan lowongan_id,
-- jadi tabel dibangun ulang: lowongan_id boleh NULL, ditambah posisi & gerai tujuan, pencatat, dan
-- sumber MANUAL / EMAIL. Data lama disalin utuh. Tidak ada tabel lain yang merujuk hr_pelamar.
CREATE TABLE hr_pelamar_baru (
  id TEXT PRIMARY KEY,
  lowongan_id TEXT REFERENCES hr_lowongan(id),
  entity_id TEXT NOT NULL,
  nama TEXT NOT NULL,
  no_wa TEXT NOT NULL,
  domisili TEXT NOT NULL DEFAULT '',
  umur INTEGER CHECK (umur IS NULL OR umur BETWEEN 14 AND 80),
  pengalaman TEXT NOT NULL DEFAULT '',
  jawaban TEXT NOT NULL DEFAULT '{}',
  sumber TEXT NOT NULL DEFAULT 'WEB' CHECK (sumber IN ('WEB', 'FB', 'IG', 'WA', 'EMAIL', 'MANUAL', 'LAIN')),
  status TEXT NOT NULL DEFAULT 'BARU' CHECK (status IN ('BARU', 'SCREENING', 'INTERVIEW', 'DITERIMA', 'DITOLAK')),
  catatan TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  posisi TEXT NOT NULL DEFAULT '',
  store_id TEXT NOT NULL DEFAULT '',
  dibuat_oleh_role TEXT NOT NULL DEFAULT '',
  dibuat_oleh_id TEXT NOT NULL DEFAULT '',
  diubah_oleh_role TEXT NOT NULL DEFAULT '',
  diubah_oleh_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO hr_pelamar_baru (id, lowongan_id, entity_id, nama, no_wa, domisili, umur, pengalaman, jawaban, sumber, status, catatan,
  ip_hash, posisi, store_id, diubah_oleh_role, diubah_oleh_id, created_at, updated_at)
SELECT p.id, p.lowongan_id, p.entity_id, p.nama, p.no_wa, p.domisili, p.umur, p.pengalaman, p.jawaban, p.sumber, p.status, p.catatan,
  p.ip_hash, COALESCE(l.posisi, ''), COALESCE(l.store_id, ''), p.diubah_oleh_role, p.diubah_oleh_id, p.created_at, p.updated_at
FROM hr_pelamar p LEFT JOIN hr_lowongan l ON l.id = p.lowongan_id;
DROP TABLE hr_pelamar;
ALTER TABLE hr_pelamar_baru RENAME TO hr_pelamar;
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_lowongan ON hr_pelamar (lowongan_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_wa ON hr_pelamar (lowongan_id, no_wa, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_ip ON hr_pelamar (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_entity ON hr_pelamar (entity_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_pelamar_entity_wa ON hr_pelamar (entity_id, no_wa);
