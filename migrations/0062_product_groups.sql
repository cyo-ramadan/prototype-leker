PRAGMA foreign_keys = ON;

-- Reusable named sets of products ("Group Barang"), created ad-hoc by
-- Kasir/Admin to re-run a report (starting with Saldo Stok, tombol Laporan)
-- against the same curated list of items without re-picking them every time.
--
-- Column is spelled product_group_id, not group_id -- the bare name group_id
-- is reserved by Customer Sharing Group (ADR-003) and means something
-- entirely different (customers shared across stores under one Owner).
-- test/tenancy-foundation.test.js enforces this convention repo-wide.
CREATE TABLE product_groups (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (store_id, name),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE product_group_items (
  product_group_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_group_id, product_id),
  FOREIGN KEY (product_group_id) REFERENCES product_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_product_groups_store_name ON product_groups(store_id, name);
CREATE INDEX idx_product_group_items_group_order ON product_group_items(product_group_id, sort_order);
