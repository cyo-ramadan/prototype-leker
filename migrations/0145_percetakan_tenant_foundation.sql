PRAGMA foreign_keys = ON;

-- MAXI-PERCETAKAN-TENANT-20261010 -- ADR-055.
--
-- Bos Cyo, 2026-10-10: "bikin apk seperti cekat ai ... customer pesan2 dari wa dan kirim
-- filenya, terus waktu eksekusi pesan itu tadi langsung berubah jadi task dengan detil
-- rinciannya, dan sudah terotomatisasi harus print dimana, antrian nomor berapa ... ini juga
-- diperlukan untuk tracking agar orderan itu tidak dipalsukan oleh karyawan ... ok bikin
-- tenant baru kusus itu ya."
--
-- Percetakan jadi Tenant baru di platform yang sama (pola migration 0050 Ikan-galeh), bukan
-- database/aplikasi terpisah. edition='LITE', warehouse_enabled=0: tahap ini belum memposting
-- penjualan ke Accounting (lihat ADR-055 "Uang"). Nama gerai boleh diganti Owner nanti.
--
-- Tabel modul diprefiks print_* / wa_* supaya tidak tabrakan dengan tabel Leker. Semuanya
-- membawa store_id (isolasi server-side, invariant #5). Uang scaled INTEGER (invariant #1).
-- Pesan WA masuk dan riwayat order bersifat APPEND-ONLY dan dijaga trigger -- itu inti
-- "order tidak bisa dipalsukan karyawan".
--
-- Additive murni. Tidak menyentuh tenant/entity/store yang sudah ada.

INSERT INTO tenants (id, name)
SELECT 'TEN-CETAK', 'Percetakan'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-CETAK');

INSERT INTO entities (id, name)
SELECT 'ENT-CETAK', 'Percetakan'
WHERE NOT EXISTS (SELECT 1 FROM entities WHERE id = 'ENT-CETAK');

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-CETAK-01', 'ENT-CETAK', 'TEN-CETAK', CURRENT_TIMESTAMP,
       'Onboarding tenant Percetakan (order WA -> task cetak), 2026-10-10'
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy WHERE entity_id = 'ENT-CETAK' AND effective_to IS NULL
);

INSERT INTO stores (id, code, store_name, address, is_active, edition, warehouse_enabled, entity_id)
SELECT 'store_cetak01', 'CETAK01', 'Percetakan', '', 1, 'LITE', 0, 'ENT-CETAK'
WHERE NOT EXISTS (SELECT 1 FROM stores WHERE code = 'CETAK01');

INSERT INTO platform_modules (code, display_name, module_kind)
SELECT 'PERCETAKAN', 'Percetakan: order WA jadi antrian cetak', 'VERTICAL'
WHERE NOT EXISTS (SELECT 1 FROM platform_modules WHERE code = 'PERCETAKAN');

INSERT INTO tenant_module_installations (id, tenant_id, module_code, effective_from, reason, created_by_role, created_by_id)
SELECT 'TMI-CETAK-PERCETAKAN-01', 'TEN-CETAK', 'PERCETAKAN', CURRENT_TIMESTAMP,
       'Tenant Percetakan dibuat khusus untuk modul ini (ADR-055)', 'SYSTEM', 'migration-0145'
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_module_installations
  WHERE tenant_id = 'TEN-CETAK' AND module_code = 'PERCETAKAN' AND effective_to IS NULL
);

-- Mesin cetak per gerai (diisi Admin; contoh: Outdoor/Banner, Digital A3+, Sablon).
CREATE TABLE IF NOT EXISTS print_machines (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, code)
);

-- Daftar produk + harga + mesin tujuan. Harga HANYA dari sini -- AI tidak pernah menentukan
-- harga (ADR-055 D2). unit: M2 (harga per meter persegi), LEMBAR, PCS.
CREATE TABLE IF NOT EXISTS print_products (
  id                 TEXT PRIMARY KEY,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  unit               TEXT NOT NULL CHECK (unit IN ('M2', 'LEMBAR', 'PCS')),
  unit_price_scaled  INTEGER NOT NULL CHECK (unit_price_scaled >= 0),
  machine_id         TEXT NOT NULL REFERENCES print_machines(id),
  keywords           TEXT NOT NULL DEFAULT '',
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, code)
);

-- Nomor WA bisnis milik gerai. Webhook menerima phone_number_id dari penyedia; gerai
-- diresolusi dari sini, TIDAK PERNAH dari isi pesan (ADR-044 D3 / invariant #5).
CREATE TABLE IF NOT EXISTS wa_channels (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  provider         TEXT NOT NULL CHECK (provider IN ('META_CLOUD', 'SIMULATOR')),
  phone_number_id  TEXT NOT NULL,
  display_number   TEXT NOT NULL DEFAULT '',
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, phone_number_id)
);

-- Log mentah tiap pesan WA masuk. Ditulis HANYA oleh webhook (atau simulator untuk uji).
-- Append-only: tidak bisa diedit atau dihapus siapa pun lewat aplikasi.
CREATE TABLE IF NOT EXISTS wa_inbound_messages (
  id                   TEXT PRIMARY KEY,
  store_id             TEXT NOT NULL REFERENCES stores(id),
  channel_id           TEXT NOT NULL REFERENCES wa_channels(id),
  provider             TEXT NOT NULL,
  provider_message_id  TEXT NOT NULL,
  from_number          TEXT NOT NULL,
  from_name            TEXT NOT NULL DEFAULT '',
  kind                 TEXT NOT NULL,
  body_text            TEXT NOT NULL DEFAULT '',
  media_id             TEXT,
  media_mime           TEXT,
  media_file_name      TEXT,
  sent_at              TEXT NOT NULL,
  raw_sha256           TEXT NOT NULL,
  received_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider, provider_message_id)
);
CREATE INDEX IF NOT EXISTS idx_wa_inbound_store_from ON wa_inbound_messages(store_id, from_number, sent_at);

CREATE TRIGGER IF NOT EXISTS trg_wa_inbound_no_update
BEFORE UPDATE ON wa_inbound_messages
BEGIN SELECT RAISE(ABORT, 'wa_inbound_messages append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_wa_inbound_no_delete
BEFORE DELETE ON wa_inbound_messages
BEGIN SELECT RAISE(ABORT, 'wa_inbound_messages append-only'); END;

-- File kiriman pelanggan. Satu baris per pesan bermedia. Status berubah sekali:
-- MENUNGGU -> TERSIMPAN (R2) atau GAGAL. sha256 = sidik isi file, bukti file tidak ditukar.
CREATE TABLE IF NOT EXISTS print_files (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  message_id  TEXT NOT NULL UNIQUE REFERENCES wa_inbound_messages(id),
  status      TEXT NOT NULL DEFAULT 'MENUNGGU' CHECK (status IN ('MENUNGGU', 'TERSIMPAN', 'GAGAL')),
  r2_key      TEXT,
  sha256      TEXT,
  size_bytes  INTEGER,
  mime        TEXT NOT NULL DEFAULT '',
  file_name   TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  stored_at   TEXT
);

-- Usulan order hasil baca AI (Una) dari satu/lebih pesan. Belum jadi order sebelum manusia
-- mengonfirmasi (ADR-044 D1).
CREATE TABLE IF NOT EXISTS print_order_drafts (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  from_number      TEXT NOT NULL,
  message_ids_json TEXT NOT NULL,
  proposal_json    TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('AI', 'MANUAL')),
  ai_model         TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'MENUNGGU' CHECK (status IN ('MENUNGGU', 'DIKONFIRMASI', 'DITOLAK')),
  decided_by_role  TEXT,
  decided_by_id    TEXT,
  decided_at       TEXT,
  order_id         TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_print_order_drafts_store ON print_order_drafts(store_id, status, created_at);

-- Order cetak. status adalah cache dari event terakhir di print_order_events (sumber kebenaran).
CREATE TABLE IF NOT EXISTS print_orders (
  id                 TEXT PRIMARY KEY,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  order_no           TEXT NOT NULL,
  business_date      TEXT NOT NULL,
  customer_phone     TEXT NOT NULL,
  customer_name      TEXT NOT NULL DEFAULT '',
  source             TEXT NOT NULL CHECK (source IN ('WA', 'WALKIN')),
  draft_id           TEXT REFERENCES print_order_drafts(id),
  status             TEXT NOT NULL,
  total_scaled       INTEGER NOT NULL CHECK (total_scaled >= 0),
  due_at             TEXT,
  note               TEXT NOT NULL DEFAULT '',
  created_by_role    TEXT NOT NULL,
  created_by_id      TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, order_no)
);
CREATE INDEX IF NOT EXISTS idx_print_orders_customer ON print_orders(store_id, customer_phone, created_at);
CREATE INDEX IF NOT EXISTS idx_print_orders_status ON print_orders(store_id, status, created_at);

-- Harga dan ukuran dibekukan saat order dibuat (bukan dibaca ulang dari print_products).
CREATE TABLE IF NOT EXISTS print_order_items (
  id                 TEXT PRIMARY KEY,
  order_id           TEXT NOT NULL REFERENCES print_orders(id),
  store_id           TEXT NOT NULL REFERENCES stores(id),
  line_no            INTEGER NOT NULL,
  product_id         TEXT NOT NULL REFERENCES print_products(id),
  product_name       TEXT NOT NULL,
  machine_id         TEXT NOT NULL REFERENCES print_machines(id),
  unit               TEXT NOT NULL,
  qty                INTEGER NOT NULL CHECK (qty > 0),
  width_cm           INTEGER,
  height_cm          INTEGER,
  unit_price_scaled  INTEGER NOT NULL CHECK (unit_price_scaled >= 0),
  subtotal_scaled    INTEGER NOT NULL CHECK (subtotal_scaled >= 0),
  file_id            TEXT REFERENCES print_files(id),
  note               TEXT NOT NULL DEFAULT '',
  UNIQUE (order_id, line_no)
);

CREATE TRIGGER IF NOT EXISTS trg_print_order_items_no_update
BEFORE UPDATE ON print_order_items
BEGIN SELECT RAISE(ABORT, 'print_order_items dibekukan; koreksi lewat order baru'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_order_items_no_delete
BEFORE DELETE ON print_order_items
BEGIN SELECT RAISE(ABORT, 'print_order_items dibekukan; koreksi lewat order baru'); END;

-- Nomor antrian per mesin per tanggal bisnis. UNIQUE menjaga dua item tidak dapat nomor sama.
CREATE TABLE IF NOT EXISTS print_queue_tickets (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id),
  machine_id     TEXT NOT NULL REFERENCES print_machines(id),
  business_date  TEXT NOT NULL,
  queue_no       INTEGER NOT NULL CHECK (queue_no > 0),
  order_item_id  TEXT NOT NULL UNIQUE REFERENCES print_order_items(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (store_id, machine_id, business_date, queue_no)
);

-- Riwayat order: rantai hash per order. hash = SHA-256(prev_hash + isi event). Menyisipkan,
-- mengubah, atau menghapus event di tengah membuat rantai putus dan ketahuan
-- (GET /api/percetakan/orders/:id/verify). UPDATE/DELETE ditolak trigger.
CREATE TABLE IF NOT EXISTS print_order_events (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES print_orders(id),
  store_id      TEXT NOT NULL REFERENCES stores(id),
  seq           INTEGER NOT NULL CHECK (seq > 0),
  event_type    TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  actor_id      TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  photo_key     TEXT,
  -- Event DIBUAT menyimpan {"snapshot": sha256 isi order + item}; mengubah harga/jumlah
  -- langsung di database membuat snapshot tidak cocok lagi.
  payload_json  TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL,
  prev_hash     TEXT NOT NULL,
  hash          TEXT NOT NULL,
  UNIQUE (order_id, seq)
);

CREATE TRIGGER IF NOT EXISTS trg_print_order_events_no_update
BEFORE UPDATE ON print_order_events
BEGIN SELECT RAISE(ABORT, 'print_order_events append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_print_order_events_no_delete
BEFORE DELETE ON print_order_events
BEGIN SELECT RAISE(ABORT, 'print_order_events append-only'); END;
