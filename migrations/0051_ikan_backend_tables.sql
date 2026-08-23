PRAGMA foreign_keys = ON;

-- MAXI-IKAN-BACKEND-PORT-20260823
--
-- Port skema Ikan-galeh (awalnya ikan-galeh/migrations/0001_ikan_galeh_foundation.sql,
-- database terpisah) ke prototype-leker-db supaya bisa hidup di Worker yang sama
-- dengan data yang sudah dipindah lewat migration 0050 (tenant Galeh).
--
-- Tabel di sini SENGAJA diprefiks ikan_* -- Leker sudah punya tabel bernama
-- contacts/products/sales/sale_items/purchases/purchase_items dengan bentuk yang
-- TOTAL BEDA (multi-store POS, bukan olshop dropship). Migrasi tanpa prefiks
-- akan collide/CREATE TABLE gagal atau, lebih buruk, salah pakai tabel Leker.
--
-- store_id ditambahkan (tidak ada di skema aslinya, karena dirancang single-tenant)
-- supaya konsisten dengan pola isolasi Leker (CLAUDE.md invariant #5) dan tidak
-- perlu migrasi ulang kalau kelak ada tenant Ikan kedua. Hari ini nilainya
-- konstan 'store_ikan01' dari kode (lihat src/ikan-*.js).
--
-- Uang tetap scaled INTEGER 1 rupiah = 1.000.000 unit, sama seperti versi asal.

CREATE TABLE IF NOT EXISTS ikan_contacts (
  contact_id      TEXT PRIMARY KEY NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id),
  contact_name    TEXT NOT NULL,
  whatsapp_number TEXT,
  is_customer     INTEGER NOT NULL DEFAULT 0 CHECK (is_customer IN (0,1)),
  is_petani       INTEGER NOT NULL DEFAULT 0 CHECK (is_petani IN (0,1)),
  is_kurir        INTEGER NOT NULL DEFAULT 0 CHECK (is_kurir IN (0,1)),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_contacts_store ON ikan_contacts(store_id);

CREATE TABLE IF NOT EXISTS ikan_products (
  product_id             TEXT PRIMARY KEY NOT NULL,
  store_id               TEXT NOT NULL REFERENCES stores(id),
  product_name           TEXT NOT NULL,
  unit_label              TEXT NOT NULL DEFAULT 'kg',
  sale_price_amount      INTEGER NOT NULL CHECK (sale_price_amount >= 0),
  purchase_price_amount  INTEGER NOT NULL CHECK (purchase_price_amount >= 0),
  is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_products_store ON ikan_products(store_id);

CREATE TABLE IF NOT EXISTS ikan_sales (
  sale_id                 TEXT PRIMARY KEY NOT NULL,
  store_id                TEXT NOT NULL REFERENCES stores(id),
  sale_number             TEXT NOT NULL UNIQUE,
  contact_id              TEXT NOT NULL REFERENCES ikan_contacts(contact_id),
  customer_name_snapshot  TEXT NOT NULL,
  transaction_date        TEXT NOT NULL,
  sale_status             TEXT NOT NULL DEFAULT 'DRAFT' CHECK (sale_status IN ('DRAFT','INVOICE','CANCELLED')),
  is_dropship             INTEGER NOT NULL DEFAULT 1 CHECK (is_dropship IN (0,1)),
  merchandise_amount      INTEGER NOT NULL CHECK (merchandise_amount >= 0),
  discount_amount         INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  total_amount            INTEGER NOT NULL CHECK (total_amount >= 0),
  paid_amount             INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_sales_store ON ikan_sales(store_id);

CREATE TABLE IF NOT EXISTS ikan_sale_items (
  sale_item_id            TEXT PRIMARY KEY NOT NULL,
  sale_id                 TEXT NOT NULL REFERENCES ikan_sales(sale_id),
  product_id              TEXT NOT NULL REFERENCES ikan_products(product_id),
  product_name_snapshot   TEXT NOT NULL,
  quantity                INTEGER NOT NULL CHECK (quantity > 0),
  sale_price_at_time      INTEGER NOT NULL CHECK (sale_price_at_time >= 0),
  purchase_price_at_time  INTEGER NOT NULL CHECK (purchase_price_at_time >= 0),
  purchase_price_source   TEXT NOT NULL DEFAULT 'MASTER_PRODUCT' CHECK (purchase_price_source IN ('MASTER_PRODUCT','MANUAL_OVERRIDE')),
  line_amount              INTEGER NOT NULL CHECK (line_amount >= 0)
);

CREATE TABLE IF NOT EXISTS ikan_sale_payments (
  sale_payment_id  TEXT PRIMARY KEY NOT NULL,
  sale_id          TEXT NOT NULL REFERENCES ikan_sales(sale_id),
  amount           INTEGER NOT NULL CHECK (amount > 0),
  paid_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ikan_purchases (
  purchase_id        TEXT PRIMARY KEY NOT NULL,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  purchase_number    TEXT NOT NULL UNIQUE,
  sale_id            TEXT REFERENCES ikan_sales(sale_id),
  source             TEXT NOT NULL DEFAULT 'DROPSHIP' CHECK (source IN ('DROPSHIP','MANUAL')),
  petani_contact_id  TEXT NOT NULL REFERENCES ikan_contacts(contact_id),
  transaction_date   TEXT NOT NULL,
  total_amount       INTEGER NOT NULL CHECK (total_amount >= 0),
  paid_amount        INTEGER NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_purchases_store ON ikan_purchases(store_id);

CREATE TABLE IF NOT EXISTS ikan_purchase_items (
  purchase_item_id        TEXT PRIMARY KEY NOT NULL,
  purchase_id              TEXT NOT NULL REFERENCES ikan_purchases(purchase_id),
  product_id                TEXT NOT NULL REFERENCES ikan_products(product_id),
  product_name_snapshot     TEXT NOT NULL,
  quantity                  INTEGER NOT NULL CHECK (quantity > 0),
  purchase_price_at_time    INTEGER NOT NULL CHECK (purchase_price_at_time >= 0),
  line_amount                INTEGER NOT NULL CHECK (line_amount >= 0)
);

CREATE TABLE IF NOT EXISTS ikan_purchase_payments (
  purchase_payment_id  TEXT PRIMARY KEY NOT NULL,
  purchase_id           TEXT NOT NULL REFERENCES ikan_purchases(purchase_id),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  paid_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ikan_cost_payables (
  cost_payable_id      TEXT PRIMARY KEY NOT NULL,
  store_id              TEXT NOT NULL REFERENCES stores(id),
  sale_id               TEXT NOT NULL REFERENCES ikan_sales(sale_id),
  cost_name             TEXT NOT NULL,
  payee_contact_id      TEXT REFERENCES ikan_contacts(contact_id),
  payee_name_snapshot   TEXT NOT NULL,
  amount                INTEGER NOT NULL CHECK (amount > 0),
  transaction_date      TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_cost_payables_store ON ikan_cost_payables(store_id);

CREATE TABLE IF NOT EXISTS ikan_cost_payable_payments (
  cost_payable_payment_id  TEXT PRIMARY KEY NOT NULL,
  cost_payable_id           TEXT NOT NULL REFERENCES ikan_cost_payables(cost_payable_id),
  amount                    INTEGER NOT NULL CHECK (amount > 0),
  paid_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS ikan_cash_ledger (
  cash_ledger_id  TEXT PRIMARY KEY NOT NULL,
  store_id        TEXT NOT NULL REFERENCES stores(id),
  direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  amount          INTEGER NOT NULL CHECK (amount > 0),
  source_type     TEXT NOT NULL CHECK (source_type IN ('SALE_PAYMENT','PURCHASE_PAYMENT','COST_PAYABLE_PAYMENT')),
  source_id       TEXT NOT NULL,
  occurred_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ikan_cash_ledger_store ON ikan_cash_ledger(store_id);
