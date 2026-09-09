PRAGMA foreign_keys = ON;

-- GAME MODULE FOUNDATION — ADR-042 / MAXI_GAME_MODULE_V1
--
-- Additive only. This migration creates the canonical Tenant module registry
-- and provider-neutral Game tables. It deliberately DOES NOT:
--   - auto-enroll any existing Tenant into GAME;
--   - migrate or rewrite roda_puter_* legacy data;
--   - create Voucher/Product/Point foreign keys;
--   - choose an artwork storage provider.

CREATE TABLE IF NOT EXISTS platform_modules (
  code          TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  module_kind   TEXT NOT NULL CHECK (module_kind IN ('CORE', 'HORIZONTAL', 'VERTICAL')),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_modules (code, display_name, module_kind)
SELECT 'GAME', 'Game', 'HORIZONTAL'
WHERE NOT EXISTS (SELECT 1 FROM platform_modules WHERE code = 'GAME');

-- Period table, not a mutable boolean. An open row means installed today.
-- Disable closes the open row; re-enable opens a new row. Closed history is
-- immutable and never deleted.
CREATE TABLE IF NOT EXISTS tenant_module_installations (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  module_code      TEXT NOT NULL,
  effective_from   TEXT NOT NULL,
  effective_to     TEXT,
  reason           TEXT NOT NULL DEFAULT '',
  created_by_role  TEXT NOT NULL,
  created_by_id    TEXT NOT NULL,
  closed_by_role   TEXT,
  closed_by_id     TEXT,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (module_code) REFERENCES platform_modules(code),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK ((effective_to IS NULL AND closed_by_role IS NULL AND closed_by_id IS NULL)
      OR (effective_to IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_module_one_open_period
  ON tenant_module_installations(tenant_id, module_code)
  WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_module_history
  ON tenant_module_installations(tenant_id, module_code, effective_from, effective_to);

CREATE TRIGGER IF NOT EXISTS trg_tenant_module_identity_immutable
BEFORE UPDATE OF id, tenant_id, module_code, effective_from, reason,
                 created_by_role, created_by_id, created_at
ON tenant_module_installations
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MODULE_INSTALLATION_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_module_closed_history_immutable
BEFORE UPDATE ON tenant_module_installations
WHEN OLD.effective_to IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MODULE_INSTALLATION_CLOSED_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_tenant_module_delete_forbidden
BEFORE DELETE ON tenant_module_installations
BEGIN
  SELECT RAISE(ABORT, 'TENANT_MODULE_INSTALLATION_DELETE_FORBIDDEN');
END;

-- Game facts/config anchor to Store + Entity, not Tenant. Tenant ownership can
-- change over time (ADR-030), so historical Game rows must never need rewriting.
CREATE TABLE IF NOT EXISTS game_campaigns (
  id              TEXT PRIMARY KEY,
  store_id        TEXT NOT NULL,
  entity_id       TEXT,
  game_type_code  TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  version         INTEGER NOT NULL CHECK (version > 0),
  client_entry    TEXT NOT NULL DEFAULT '',
  config_json     TEXT NOT NULL DEFAULT '{}',
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_role TEXT NOT NULL,
  created_by_id   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (store_id, game_type_code, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_one_active_campaign_per_store_type
  ON game_campaigns(store_id, game_type_code)
  WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_game_campaigns_store
  ON game_campaigns(store_id, game_type_code, version DESC);

CREATE TABLE IF NOT EXISTS game_outcomes (
  id                    TEXT PRIMARY KEY,
  campaign_id           TEXT NOT NULL,
  label_snapshot        TEXT NOT NULL,
  reward_key            TEXT NOT NULL,
  weight_basis_points   INTEGER,
  artwork_ref           TEXT NOT NULL DEFAULT '',
  sort_order            INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  config_json           TEXT NOT NULL DEFAULT '{}',
  created_at            TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES game_campaigns(id) ON DELETE RESTRICT,
  CHECK (weight_basis_points IS NULL OR (weight_basis_points > 0 AND weight_basis_points <= 10000)),
  UNIQUE (campaign_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_game_outcomes_campaign_order
  ON game_outcomes(campaign_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_game_outcomes_reward_key
  ON game_outcomes(reward_key, campaign_id);

-- Append-only Game fact. player_ref is intentionally opaque so Game does not
-- require Customer module. No Voucher/Product/Point receipt lives here.
CREATE TABLE IF NOT EXISTS game_plays (
  id                   TEXT PRIMARY KEY,
  store_id             TEXT NOT NULL,
  entity_id            TEXT,
  campaign_id          TEXT NOT NULL,
  outcome_id           TEXT NOT NULL,
  player_ref           TEXT,
  play_mode            TEXT NOT NULL CHECK (play_mode IN ('DEMO', 'OFFICIAL')),
  random_basis_points  INTEGER,
  played_at            TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (campaign_id) REFERENCES game_campaigns(id) ON DELETE RESTRICT,
  FOREIGN KEY (outcome_id) REFERENCES game_outcomes(id) ON DELETE RESTRICT,
  CHECK (random_basis_points IS NULL OR (random_basis_points >= 0 AND random_basis_points < 10000))
);

CREATE INDEX IF NOT EXISTS idx_game_plays_store_time
  ON game_plays(store_id, played_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_game_plays_campaign
  ON game_plays(campaign_id, played_at DESC, id DESC);

CREATE TRIGGER IF NOT EXISTS trg_game_campaign_scope_insert
BEFORE INSERT ON game_campaigns
WHEN NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'GAME_CAMPAIGN_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_campaign_identity_immutable
BEFORE UPDATE OF id, store_id, entity_id, game_type_code, display_name, version,
                 client_entry, config_json, created_by_role, created_by_id, created_at
ON game_campaigns
BEGIN
  SELECT RAISE(ABORT, 'GAME_CAMPAIGN_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_campaign_no_reactivation
BEFORE UPDATE OF is_active ON game_campaigns
WHEN OLD.is_active = 0 AND NEW.is_active = 1
BEGIN
  SELECT RAISE(ABORT, 'GAME_CAMPAIGN_REACTIVATION_FORBIDDEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_outcome_immutable
BEFORE UPDATE ON game_outcomes
BEGIN
  SELECT RAISE(ABORT, 'GAME_OUTCOME_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_outcome_delete_forbidden
BEFORE DELETE ON game_outcomes
BEGIN
  SELECT RAISE(ABORT, 'GAME_OUTCOME_DELETE_FORBIDDEN');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_play_scope_insert
BEFORE INSERT ON game_plays
WHEN NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
   OR NOT EXISTS (
       SELECT 1
       FROM game_campaigns campaign
       JOIN game_outcomes outcome ON outcome.campaign_id = campaign.id
       WHERE campaign.id = NEW.campaign_id
         AND campaign.store_id = NEW.store_id
         AND campaign.entity_id IS NEW.entity_id
         AND outcome.id = NEW.outcome_id
     )
BEGIN
  SELECT RAISE(ABORT, 'GAME_PLAY_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_play_immutable
BEFORE UPDATE ON game_plays
BEGIN
  SELECT RAISE(ABORT, 'GAME_PLAY_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_game_play_delete_forbidden
BEFORE DELETE ON game_plays
BEGIN
  SELECT RAISE(ABORT, 'GAME_PLAY_DELETE_FORBIDDEN');
END;
