PRAGMA foreign_keys = ON;

-- Production Panel V2 keeps Recipe/BOM immutable and stores the actual execution snapshot.
-- Product-kind snapshots make the post-commit Warehouse -> Accounting bridge deterministic
-- even when Master Barang classification changes later.
ALTER TABLE production_runs ADD COLUMN template_modified INTEGER NOT NULL DEFAULT 0 CHECK (template_modified IN (0, 1));
ALTER TABLE production_runs ADD COLUMN output_product_kind_id TEXT;
ALTER TABLE production_runs ADD COLUMN output_product_kind_code TEXT NOT NULL DEFAULT '';
ALTER TABLE production_runs ADD COLUMN output_product_kind_name TEXT NOT NULL DEFAULT '';

ALTER TABLE production_run_components ADD COLUMN component_product_kind_id TEXT;
ALTER TABLE production_run_components ADD COLUMN component_product_kind_code TEXT NOT NULL DEFAULT '';
ALTER TABLE production_run_components ADD COLUMN component_product_kind_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_production_runs_store_kind_created
  ON production_runs(store_id, output_product_kind_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_components_kind_run
  ON production_run_components(store_id, component_product_kind_id, production_run_id);
