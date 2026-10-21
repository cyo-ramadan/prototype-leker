-- Pengaturan Fina (agen HR) per tenant -- paket H1 (contracts/fina-hr-paket-v1.md).
-- Semua aturan HR yang dipakai Fina diatur per entity dan bisa dioverride per gerai. Tidak ada
-- angka KPM yang tertanam di kode selain bawaan FINA_BAWAAN (src/fina-pengaturan.js).
-- store_id '' = bawaan entity; baris per gerai = override. NULL = ikut tingkat di atasnya
-- (gerai -> entity -> FINA_BAWAAN), pola yang sama dengan apresiasi_settings (0162).
-- Tarif & denda TIDAK disimpan di sini: tetap di apresiasi_settings (dibaca saja).
-- Tabel baru membawa entity_id (ADR-030). Tidak ada tabel lama yang diubah.
CREATE TABLE IF NOT EXISTS hr_settings (
  entity_id TEXT NOT NULL,
  store_id TEXT NOT NULL DEFAULT '',
  -- Menit setelah shift mulai tanpa presensi masuk = gerai dianggap kosong.
  deteksi_kosong_menit INTEGER CHECK (deteksi_kosong_menit IS NULL OR deteksi_kosong_menit BETWEEN 1 AND 240),
  -- Jumlah freelance yang ditawari backup sekaligus.
  tawaran_serentak INTEGER CHECK (tawaran_serentak IS NULL OR tawaran_serentak BETWEEN 1 AND 20),
  -- Tidak ada yang bisa backup dalam sekian menit -> lapor admin.
  batas_tunggu_menit INTEGER CHECK (batas_tunggu_menit IS NULL OR batas_tunggu_menit BETWEEN 5 AND 720),
  backup_lintas_gerai INTEGER CHECK (backup_lintas_gerai IS NULL OR backup_lintas_gerai IN (0, 1)),
  -- Masa berlaku SP (hari).
  sp_berlaku_hari INTEGER CHECK (sp_berlaku_hari IS NULL OR sp_berlaku_hari BETWEEN 1 AND 730),
  -- JSON array urutan tingkat, mis. ["TEGURAN","SP1","SP2","SP3"]. NULL = ikut atas.
  sp_tingkat TEXT,
  -- Nama usaha/alamat untuk kop surat. '' = ikut atas (di bawaan entity: kosong).
  kop_surat TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by_role TEXT NOT NULL DEFAULT '',
  updated_by_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (entity_id, store_id)
);
