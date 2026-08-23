PRAGMA foreign_keys = ON;

-- MAXI-CONSOLIDATION-SCHEMA-MAPPING-20260823
-- ADR-030 step 5: consolidation stays read-side. Entity books keep their local
-- Chart of Accounts; this schema only supplies a temporal group CoA and mapping.

CREATE TABLE IF NOT EXISTS consolidation_group_accounts (
  id TEXT PRIMARY KEY,
  consolidation_group_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id) ON DELETE CASCADE,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_consolidation_group_accounts_open_code
  ON consolidation_group_accounts (consolidation_group_id, code)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_consolidation_group_accounts_period
  ON consolidation_group_accounts (consolidation_group_id, effective_from, effective_to, code);

CREATE TABLE IF NOT EXISTS consolidation_account_mapping (
  id TEXT PRIMARY KEY,
  consolidation_group_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  consolidation_group_account_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (consolidation_group_id) REFERENCES consolidation_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (consolidation_group_account_id) REFERENCES consolidation_group_accounts(id) ON DELETE RESTRICT,
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- One local account may resolve to only one group account at a time inside the
-- same consolidation group. History is closed and reopened, never overwritten.
CREATE UNIQUE INDEX IF NOT EXISTS idx_consolidation_account_mapping_open_source
  ON consolidation_account_mapping (consolidation_group_id, store_id, account_id)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_consolidation_account_mapping_period
  ON consolidation_account_mapping (
    consolidation_group_id, store_id, account_id, effective_from, effective_to
  );
