-- QRIS Otomatis (Bos Cyo, 2026-10-16): uang QRIS yang benar-benar masuk dicatat dari notifikasi
-- aplikasi merchant (GoBiz, bank, dll.) di SATU HP penerima milik pemilik -- bukan HP CS. HP itu
-- meneruskan notifikasinya (MacroDroid/aplikasi penerus) ke POST /api/qris/masuk. Leker lalu
-- membunyikan notifikasi di kasir gerai itu, dan setiap penjualan QRIS harus ditautkan ke satu
-- uang masuk. Penjualan QRIS tanpa uang masuk tetap "Belum tertaut"; uang masuk tanpa penjualan
-- juga terlihat. Murni operasional: tidak menyentuh Accounting, stok, atau jurnal.

-- HP penerima. Token disimpan sebagai hash; nilai aslinya hanya tampil sekali saat dibuat.
-- store_id NULL = penerima untuk semua gerai di entity; gerainya ditebak dari kata kunci gerai.
CREATE TABLE IF NOT EXISTS qris_penerima (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  last_seen_at TEXT,
  last_result TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_qris_penerima_entity ON qris_penerima(entity_id, is_active);

-- Setelan per gerai: cara bayar mana yang dihitung QRIS, dan kata kunci (nama merchant/NMID)
-- yang muncul di teks notifikasi untuk penerima semua-gerai.
CREATE TABLE IF NOT EXISTS qris_gerai_setelan (
  store_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  payment_method_code TEXT NOT NULL DEFAULT '',
  kata_kunci TEXT NOT NULL DEFAULT '',
  updated_by_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- Uang masuk. amount = rupiah utuh, sama satuannya dengan sales.total_amount (QRIS rupiah tanpa sen).
-- Satu uang masuk hanya bisa menaut ke satu penjualan (sale_id UNIQUE), dan sebaliknya.
CREATE TABLE IF NOT EXISTS qris_masuk (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  store_id TEXT,
  penerima_id TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL CHECK (source IN ('NOTIF_HP', 'MANUAL', 'GATEWAY')),
  app TEXT NOT NULL DEFAULT '',
  raw_title TEXT NOT NULL DEFAULT '',
  raw_text TEXT NOT NULL DEFAULT '',
  ref TEXT,
  received_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BELUM' CHECK (status IN ('BELUM', 'TERTAUT', 'DIABAIKAN')),
  sale_id TEXT UNIQUE,
  link_mode TEXT CHECK (link_mode IS NULL OR link_mode IN ('OTOMATIS', 'CS', 'ADMIN')),
  linked_at TEXT,
  linked_by_role TEXT NOT NULL DEFAULT '',
  linked_by_name TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- Dompet/bank pembayar yang tertulis di notifikasi ("dari DANA") -- bantu CS mengenali pembeli.
  sumber_bayar TEXT NOT NULL DEFAULT '',
  -- Kolam bersama (Bos Cyo, 2026-10-17): notifikasi satu akun merchant untuk banyak outlet tidak
  -- menyebut outletnya, jadi uang masuk menunggu di kolam (store_id NULL) sampai CS gerai yang
  -- pembelinya membayar mengklaimnya. Klaim mengisi store_id + siapa/kapan.
  claimed_at TEXT,
  claimed_by_role TEXT NOT NULL DEFAULT '',
  claimed_by_id TEXT NOT NULL DEFAULT '',
  claimed_by_name TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK ((status = 'TERTAUT') = (sale_id IS NOT NULL)),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (penerima_id) REFERENCES qris_penerima(id),
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qris_masuk_ref ON qris_masuk(entity_id, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qris_masuk_store_date ON qris_masuk(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_qris_masuk_open ON qris_masuk(entity_id, status) WHERE status = 'BELUM';
CREATE INDEX IF NOT EXISTS idx_qris_masuk_kolam ON qris_masuk(entity_id, received_at) WHERE store_id IS NULL;
