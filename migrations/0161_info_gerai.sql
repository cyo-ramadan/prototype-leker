-- Info Gerai (Bos Cyo, 2026-10-16): papan informasi per gerai yang bisa dibuka dari kasir dan
-- Entity Admin. Tiga jenis catatan dalam satu tabel:
--   KONTAK  -- kontak darurat (pemasok es batu, plastik, tukang listrik) + WA/telepon/lokasi.
--   LAPORAN -- masalah yang dilaporkan CS / temuan sidak, punya status sampai Selesai.
--   PANDUAN -- "masalah -> cara mengatasi"; bisa ditulis admin atau lahir dari laporan yang selesai.
-- Sifat (visibility): UMUM = semua (termasuk kasir & agen), ADMIN = admin gerai ke atas,
-- RAHASIA = Entity Admin & Owner saja. store_id NULL = berlaku untuk semua gerai di entity.
-- Murni informasi operasional: tidak menyentuh Accounting, stok, atau gaji.

CREATE TABLE IF NOT EXISTS info_gerai_entries (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('KONTAK', 'LAPORAN', 'PANDUAN')),
  visibility TEXT NOT NULL DEFAULT 'UMUM' CHECK (visibility IN ('UMUM', 'ADMIN', 'RAHASIA')),
  category TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- KONTAK
  phone TEXT NOT NULL DEFAULT '',
  maps_url TEXT NOT NULL DEFAULT '',
  open_hours TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  supplier_id TEXT,
  -- LAPORAN
  severity TEXT CHECK (severity IS NULL OR severity IN ('MERAH', 'KUNING', 'HIJAU')),
  status TEXT CHECK (status IS NULL OR status IN ('BARU', 'DILIHAT', 'DITANGANI', 'SELESAI')),
  source TEXT NOT NULL DEFAULT 'ADMIN' CHECK (source IN ('CS', 'SIDAK', 'ADMIN')),
  resolution TEXT NOT NULL DEFAULT '',
  resolved_at TEXT,
  resolved_by_name TEXT NOT NULL DEFAULT '',
  -- PANDUAN yang lahir dari laporan menyimpan asalnya.
  source_entry_id TEXT,
  photo_data TEXT,
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  CHECK ((kind = 'LAPORAN') = (status IS NOT NULL)),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (source_entry_id) REFERENCES info_gerai_entries(id)
);

CREATE INDEX IF NOT EXISTS idx_info_gerai_entries_scope
  ON info_gerai_entries(entity_id, store_id, kind, is_active);
CREATE INDEX IF NOT EXISTS idx_info_gerai_entries_open_reports
  ON info_gerai_entries(entity_id, status) WHERE kind = 'LAPORAN' AND is_active = 1;

-- Aktivitas di sebuah catatan: catatan tambahan, "saya juga lihat" (laporan), dan nilai
-- membantu/kurang jelas (panduan). Riwayat perubahan status juga dicatat di sini.
CREATE TABLE IF NOT EXISTS info_gerai_activity (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CATATAN', 'SAYA_JUGA', 'MEMBANTU', 'KURANG_JELAS', 'STATUS')),
  body TEXT NOT NULL DEFAULT '',
  actor_role TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES info_gerai_entries(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE INDEX IF NOT EXISTS idx_info_gerai_activity_entry
  ON info_gerai_activity(entry_id, created_at);
