PRAGMA foreign_keys = ON;

-- Auto Permit -- Bos Cyo 2026-09-04: toggle per gerai yang, kalau nyala,
-- langsung meng-ACC pengajuan approval_requests baru (Arus Kas/Arus Barang/
-- Aset, termasuk Penyesuaian Stok) tanpa menunggu Admin/Owner klik ACC
-- manual. Akuntabilitasnya eksplisit: siapa yang menyalakan toggle dicatat
-- di sini, dan setiap baris approval_requests yang auto-approved menunjuk
-- balik ke akun itu lewat approved_by_role='AUTO_PERMIT' + approved_by_id
-- (lihat ADR-041). Scope-nya CUMA approval_requests -- transaction_void_permits
-- (permit Hapus/koreksi transaksi) sengaja tidak disentuh, beda risk profile.
--
-- enabled_by_* TIDAK ditimpa saat auto_permit_enabled dimatikan -- itu jejak
-- "siapa yang terakhir menyalakan", tetap berguna dibaca meski sedang OFF.
CREATE TABLE IF NOT EXISTS store_approval_settings (
  store_id TEXT PRIMARY KEY,
  auto_permit_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_permit_enabled IN (0, 1)),
  enabled_by_role TEXT,
  enabled_by_id TEXT,
  enabled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);
