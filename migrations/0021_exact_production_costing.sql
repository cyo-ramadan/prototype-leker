PRAGMA foreign_keys = ON;

-- Exact production costing companion fields.
-- Scale: 1 rupiah = 1,000,000 cost units. Legacy REAL fields remain nullable compatibility columns only.
ALTER TABLE production_runs ADD COLUMN hpp_total_scaled INTEGER CHECK (hpp_total_scaled IS NULL OR hpp_total_scaled >= 0);
ALTER TABLE production_runs ADD COLUMN hpp_per_unit_scaled INTEGER CHECK (hpp_per_unit_scaled IS NULL OR hpp_per_unit_scaled >= 0);
ALTER TABLE production_run_components ADD COLUMN unit_cost_snapshot_scaled INTEGER CHECK (unit_cost_snapshot_scaled IS NULL OR unit_cost_snapshot_scaled >= 0);
ALTER TABLE production_run_components ADD COLUMN total_cost_snapshot_scaled INTEGER CHECK (total_cost_snapshot_scaled IS NULL OR total_cost_snapshot_scaled >= 0);

CREATE INDEX IF NOT EXISTS idx_production_runs_store_costed
  ON production_runs(store_id, hpp_total_scaled, created_at DESC);
