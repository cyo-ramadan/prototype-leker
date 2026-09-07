PRAGMA foreign_keys = ON;

-- Transitive dependency note for isolated migration tests: this migration
-- requires 0076, whose Accounting account seeds are edition-gated.
-- Every Admin save creates a new immutable campaign snapshot. The single
-- active campaign is the only configuration exposed to demo/official spins.
CREATE TABLE roda_puter_campaigns (
  id                          TEXT PRIMARY KEY,
  store_id                    TEXT NOT NULL,
  entity_id                   TEXT,
  version                     INTEGER NOT NULL CHECK (version > 0),
  total_weight_basis_points   INTEGER NOT NULL CHECK (total_weight_basis_points = 10000),
  is_active                   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_role             TEXT NOT NULL,
  created_by_id               TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  UNIQUE (store_id, version)
);

CREATE UNIQUE INDEX idx_roda_puter_one_active_campaign_per_store
  ON roda_puter_campaigns(store_id)
  WHERE is_active = 1;

CREATE TABLE roda_puter_rewards (
  id                    TEXT PRIMARY KEY,
  campaign_id           TEXT NOT NULL,
  store_id              TEXT NOT NULL,
  voucher_master_id     TEXT NOT NULL,
  product_id            INTEGER NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  weight_basis_points   INTEGER NOT NULL CHECK (weight_basis_points > 0 AND weight_basis_points <= 10000),
  sort_order            INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at            TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES roda_puter_campaigns(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (voucher_master_id, product_id)
    REFERENCES voucher_master_products(voucher_master_id, product_id) ON DELETE RESTRICT,
  UNIQUE (campaign_id, product_id)
);

CREATE INDEX idx_roda_puter_rewards_campaign_order
  ON roda_puter_rewards(campaign_id, sort_order, id);
CREATE INDEX idx_roda_puter_rewards_store_product
  ON roda_puter_rewards(store_id, product_id, campaign_id);

-- Official spins are append-only facts. UNIQUE(customer_id) is the final
-- server-side lock: repeated or concurrent requests can never create a
-- second official reward for the same member.
CREATE TABLE roda_puter_official_spins (
  id                       TEXT PRIMARY KEY,
  store_id                 TEXT NOT NULL,
  customer_store_id        TEXT NOT NULL,
  entity_id                TEXT,
  customer_id              TEXT NOT NULL UNIQUE,
  registration_request_id  TEXT NOT NULL UNIQUE,
  campaign_id              TEXT NOT NULL,
  reward_id                TEXT NOT NULL,
  voucher_instance_id      TEXT NOT NULL UNIQUE,
  random_basis_points      INTEGER NOT NULL CHECK (random_basis_points >= 0 AND random_basis_points < 10000),
  performed_by_cashier_id  TEXT NOT NULL,
  spun_at                  TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (customer_store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (registration_request_id) REFERENCES customer_registration_requests(id) ON DELETE RESTRICT,
  FOREIGN KEY (campaign_id) REFERENCES roda_puter_campaigns(id) ON DELETE RESTRICT,
  FOREIGN KEY (reward_id) REFERENCES roda_puter_rewards(id) ON DELETE RESTRICT,
  FOREIGN KEY (voucher_instance_id) REFERENCES voucher_instances(id) ON DELETE RESTRICT,
  FOREIGN KEY (performed_by_cashier_id) REFERENCES cashiers(id) ON DELETE RESTRICT
);

CREATE INDEX idx_roda_puter_official_spins_store_time
  ON roda_puter_official_spins(store_id, spun_at DESC, id DESC);

CREATE TRIGGER trg_roda_puter_campaign_scope_insert
BEFORE INSERT ON roda_puter_campaigns
WHEN NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_CAMPAIGN_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_roda_puter_campaign_identity_immutable
BEFORE UPDATE OF
  id, store_id, entity_id, version, total_weight_basis_points,
  created_by_role, created_by_id, created_at
ON roda_puter_campaigns
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_CAMPAIGN_IMMUTABLE');
END;

CREATE TRIGGER trg_roda_puter_campaign_no_reactivation
BEFORE UPDATE OF is_active ON roda_puter_campaigns
WHEN OLD.is_active = 0 AND NEW.is_active = 1
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_CAMPAIGN_REACTIVATION_FORBIDDEN');
END;

CREATE TRIGGER trg_roda_puter_reward_scope_insert
BEFORE INSERT ON roda_puter_rewards
WHEN NOT EXISTS (
       SELECT 1
       FROM roda_puter_campaigns c
       WHERE c.id = NEW.campaign_id AND c.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1
       FROM voucher_master_products vp
       JOIN voucher_masters v
         ON v.id = vp.voucher_master_id
        AND v.store_id = vp.store_id
       JOIN products p
         ON p.id = vp.product_id
        AND p.store_id = vp.store_id
       WHERE vp.voucher_master_id = NEW.voucher_master_id
         AND vp.product_id = NEW.product_id
         AND vp.store_id = NEW.store_id
         AND p.name = NEW.product_name_snapshot
     )
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_REWARD_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_roda_puter_reward_immutable
BEFORE UPDATE ON roda_puter_rewards
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_REWARD_IMMUTABLE');
END;

CREATE TRIGGER trg_roda_puter_reward_delete_forbidden
BEFORE DELETE ON roda_puter_rewards
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_REWARD_DELETE_FORBIDDEN');
END;

CREATE TRIGGER trg_roda_puter_official_spin_guard
BEFORE INSERT ON roda_puter_official_spins
WHEN NOT EXISTS (
       SELECT 1
       FROM customer_registration_requests r
       JOIN customers customer
         ON customer.id = r.customer_id
        AND customer.store_id = NEW.customer_store_id
       JOIN cashiers cashier
         ON cashier.id = NEW.performed_by_cashier_id
        AND cashier.store_id = NEW.store_id
        AND cashier.is_active = 1
       WHERE r.id = NEW.registration_request_id
         AND r.store_id = NEW.store_id
         AND r.status = 'APPROVED'
         AND r.customer_id = NEW.customer_id
         AND r.reviewed_by = NEW.performed_by_cashier_id
         AND customer.id = NEW.customer_id
         AND customer.is_active = 1
         AND NEW.entity_id IS (SELECT entity_id FROM stores WHERE id = NEW.customer_store_id)
     )
   OR NOT EXISTS (
       SELECT 1
       FROM roda_puter_rewards reward
       JOIN roda_puter_campaigns campaign
         ON campaign.id = reward.campaign_id
        AND campaign.store_id = reward.store_id
       JOIN voucher_instances voucher
         ON voucher.id = NEW.voucher_instance_id
        AND voucher.voucher_master_id = reward.voucher_master_id
        AND voucher.master_store_id = reward.store_id
        AND voucher.customer_id = NEW.customer_id
        AND voucher.store_id = NEW.customer_store_id
        AND voucher.distributed_store_id = NEW.store_id
        AND voucher.distributed_by_cashier_id = NEW.performed_by_cashier_id
       WHERE campaign.id = NEW.campaign_id
         AND campaign.store_id = NEW.store_id
         AND campaign.is_active = 1
         AND reward.id = NEW.reward_id
         AND reward.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_OFFICIAL_SPIN_NOT_ALLOWED');
END;

CREATE TRIGGER trg_roda_puter_official_spin_immutable
BEFORE UPDATE ON roda_puter_official_spins
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_OFFICIAL_SPIN_IMMUTABLE');
END;

CREATE TRIGGER trg_roda_puter_official_spin_delete_forbidden
BEFORE DELETE ON roda_puter_official_spins
BEGIN
  SELECT RAISE(ABORT, 'RODA_PUTER_OFFICIAL_SPIN_DELETE_FORBIDDEN');
END;

-- A wheel reward points at one exact product inside its Voucher Master. The
-- existing Voucher redemption path stays canonical; this guard only narrows
-- an official-spin Voucher so another product from the same master cannot be
-- substituted at redemption time.
CREATE TRIGGER trg_roda_puter_official_voucher_product_guard
BEFORE INSERT ON voucher_redemptions
WHEN EXISTS (
       SELECT 1
       FROM roda_puter_official_spins spin
       WHERE spin.voucher_instance_id = NEW.voucher_instance_id
     )
 AND NOT EXISTS (
       SELECT 1
       FROM roda_puter_official_spins spin
       JOIN roda_puter_rewards reward ON reward.id = spin.reward_id
       WHERE spin.voucher_instance_id = NEW.voucher_instance_id
         AND reward.product_id = NEW.product_id
     )
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_NOT_ALLOWED');
END;
