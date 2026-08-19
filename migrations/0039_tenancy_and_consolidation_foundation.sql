PRAGMA foreign_keys = ON;

-- MAXI-TENANCY-FOUNDATION-20260818
-- Foundation for ADR-030. Purely additive: no existing table is rebuilt and no
-- existing column changes meaning. Leker keeps behaving exactly as it does today
-- while the tenancy dimension it will need is put in place.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- entities deliberately has no tenant_id column.
--
-- An entity's owning tenant changes when two MAXI customers merge. Storing that
-- link here would make a merge an UPDATE across the ledger's owner, and would
-- destroy the record of which customer owned the entity in each past period.
-- Ownership over time is entity_tenancy's job, not a column's.
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entity_tenancy (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- An entity belongs to at most one customer at any moment. A merge closes the
-- open row and opens a new one; it never edits history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_tenancy_open
  ON entity_tenancy (entity_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_entity_tenancy_tenant_period
  ON entity_tenancy (tenant_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS consolidation_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

-- The column is consolidation_group_id, not group_id. Customer Sharing Group
-- (ADR-003) already owns the bare name group_id for an unrelated concept, and a
-- schema where "group" means two things is exactly the ambiguity C6 forbids.
CREATE TABLE IF NOT EXISTS consolidation_membership (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  consolidation_group_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consolidation_membership_open
  ON consolidation_membership (entity_id, consolidation_group_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_consolidation_membership_group_period
  ON consolidation_membership (consolidation_group_id, effective_from, effective_to);

-- Gerai gains its books owner. Nullable, so nothing that reads stores today breaks.
ALTER TABLE stores ADD COLUMN entity_id TEXT REFERENCES entities(id);

-- Backfill. Today a gerai already owns its own Accounting configuration and its
-- own posted journals, so gerai is the de facto books owner; one entity per
-- existing store records that fact rather than inventing a new structure.
INSERT INTO tenants (id, name)
SELECT 'TEN-PROTOTYPE', 'Prototype Leker'
WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 'TEN-PROTOTYPE');

INSERT INTO entities (id, name)
SELECT 'ENT-' || s.code, s.store_name
FROM stores s
WHERE NOT EXISTS (SELECT 1 FROM entities e WHERE e.id = 'ENT-' || s.code);

UPDATE stores SET entity_id = 'ENT-' || code WHERE entity_id IS NULL;

INSERT INTO entity_tenancy (id, entity_id, tenant_id, effective_from, reason)
SELECT 'TNC-' || s.code, 'ENT-' || s.code, 'TEN-PROTOTYPE', CURRENT_TIMESTAMP, 'ADR-030 backfill'
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM entity_tenancy t WHERE t.entity_id = 'ENT-' || s.code AND t.effective_to IS NULL
);

-- Fail the migration rather than leave a gerai without a books owner: an
-- unlinked store would be invisible to every future tenant-scoped query.
CREATE TABLE IF NOT EXISTS tenancy_backfill_guard_20260818 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM tenancy_backfill_guard_20260818;
INSERT INTO tenancy_backfill_guard_20260818 (ok)
SELECT CASE WHEN EXISTS (SELECT 1 FROM stores WHERE entity_id IS NULL) THEN 0 ELSE 1 END;
DROP TABLE tenancy_backfill_guard_20260818;
