PRAGMA foreign_keys = ON;

-- HPP (Average Cost) history: a read-only audit trail of every products.average_cost
-- change, so Admin can see how a barang's cost moved over time instead of only its
-- current value. Deliberately a NEW table/name, independent from any earlier
-- attempt -- see the schema-drift issue on the Workboard for that history; this
-- migration does not touch or assume anything about it.
--
-- Written by the three call sites that already mutate products.average_cost
-- (Purchase moving-average, Production consuming materials, Purchase-correction
-- reversal). Each snapshot is inserted right after its UPDATE, in the same
-- batch, reading the resulting value straight from `products` -- no formula is
-- duplicated here, so this table can never disagree with the authoritative
-- average_cost it is recording.
CREATE TABLE product_average_cost_snapshots (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  average_cost_scaled INTEGER NOT NULL CHECK (average_cost_scaled >= 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('PURCHASE', 'PRODUCTION', 'CORRECTION')),
  source_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX idx_product_average_cost_snapshots_store_product_created
  ON product_average_cost_snapshots(store_id, product_id, created_at DESC, id DESC);
