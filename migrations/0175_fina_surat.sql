-- Surat teguran / SP yang disiapkan Fina -- paket H3 (contracts/fina-hr-paket-v1.md).
-- Fina hanya membuat DRAFT. Status hanya berubah lewat tombol manusia (Setujui / Batalkan)
-- di Entity Admin; tidak ada jalur agen ke rute itu. Belum dikirim ke CS (fase WA, H5).
-- fakta = JSON hasil rekap masalah CS (bukti yang sama dengan rekap_masalah_cs).
-- Tingkat, kop, dan masa berlaku dari pengaturan Fina (hr_settings, 0174). ADR-030: entity_id ikut.
CREATE TABLE IF NOT EXISTS hr_surat (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  employee_id TEXT,
  tingkat TEXT NOT NULL,
  periode_dari TEXT NOT NULL CHECK (periode_dari GLOB '????-??-??'),
  periode_sampai TEXT NOT NULL CHECK (periode_sampai GLOB '????-??-??'),
  fakta TEXT NOT NULL,
  isi TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'DISETUJUI', 'DIBATALKAN')),
  berlaku_sampai TEXT,
  dibuat_oleh_role TEXT NOT NULL,
  dibuat_oleh_id TEXT NOT NULL,
  disetujui_oleh_role TEXT NOT NULL DEFAULT '',
  disetujui_oleh_id TEXT NOT NULL DEFAULT '',
  disetujui_at TEXT,
  dibatalkan_alasan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_hr_surat_entity_status ON hr_surat (entity_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_hr_surat_account ON hr_surat (account_id, status);
