PRAGMA foreign_keys = ON;

-- Voucher is an operational fact. ACCOUNTING stores receive the two fixed
-- accounts consumed by src/accounting-voucher-bridge.js; other editions keep
-- the same distribution, redemption, and stock path without journal effects.

CREATE TABLE voucher_masters (
  id              TEXT PRIMARY KEY,
  store_id        TEXT NOT NULL,
  entity_id       TEXT,
  name            TEXT NOT NULL,
  active_from     TEXT NOT NULL CHECK (LENGTH(active_from) = 10),
  active_until    TEXT NOT NULL CHECK (LENGTH(active_until) = 10 AND active_until >= active_from),
  usage_quota     INTEGER NOT NULL CHECK (usage_quota > 0),
  redeemed_count  INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0 AND redeemed_count <= usage_quota),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by_role TEXT NOT NULL,
  created_by_id   TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE TABLE voucher_master_products (
  voucher_master_id TEXT NOT NULL,
  store_id          TEXT NOT NULL,
  product_id        INTEGER NOT NULL,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  PRIMARY KEY (voucher_master_id, product_id),
  FOREIGN KEY (voucher_master_id) REFERENCES voucher_masters(id) ON DELETE CASCADE,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
);

CREATE TABLE voucher_instances (
  id                        TEXT PRIMARY KEY,
  code                      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  voucher_master_id         TEXT NOT NULL,
  master_store_id           TEXT NOT NULL,
  store_id                  TEXT NOT NULL,
  entity_id                 TEXT,
  customer_id               TEXT NOT NULL,
  customer_name_snapshot    TEXT NOT NULL,
  distributed_store_id      TEXT NOT NULL,
  distributed_by_cashier_id TEXT NOT NULL,
  status                    TEXT NOT NULL DEFAULT 'UNUSED' CHECK (status IN ('UNUSED', 'REDEEMED', 'CANCELLED')),
  distributed_at            TEXT NOT NULL,
  redeemed_at               TEXT,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (voucher_master_id) REFERENCES voucher_masters(id) ON DELETE RESTRICT,
  FOREIGN KEY (master_store_id) REFERENCES stores(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (distributed_store_id) REFERENCES stores(id),
  FOREIGN KEY (distributed_by_cashier_id) REFERENCES cashiers(id) ON DELETE RESTRICT
);

CREATE TABLE voucher_redemptions (
  id                         TEXT PRIMARY KEY,
  voucher_instance_id        TEXT NOT NULL UNIQUE,
  voucher_master_id          TEXT NOT NULL,
  store_id                   TEXT NOT NULL,
  entity_id                  TEXT,
  customer_id                TEXT NOT NULL,
  customer_store_id          TEXT NOT NULL,
  product_id                 INTEGER NOT NULL,
  product_name               TEXT NOT NULL,
  quantity                   INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
  unit_cost_snapshot_scaled  INTEGER NOT NULL CHECK (unit_cost_snapshot_scaled >= 0),
  total_cost_snapshot_scaled INTEGER NOT NULL CHECK (total_cost_snapshot_scaled >= 0),
  drawer_session_id          TEXT NOT NULL,
  cashier_id                 TEXT NOT NULL,
  redeemed_at                TEXT NOT NULL,
  FOREIGN KEY (voucher_instance_id) REFERENCES voucher_instances(id) ON DELETE RESTRICT,
  FOREIGN KEY (voucher_master_id) REFERENCES voucher_masters(id) ON DELETE RESTRICT,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY (customer_store_id) REFERENCES stores(id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT,
  FOREIGN KEY (drawer_session_id) REFERENCES cash_drawer_sessions(id) ON DELETE RESTRICT,
  FOREIGN KEY (cashier_id) REFERENCES cashiers(id) ON DELETE RESTRICT,
  CHECK (total_cost_snapshot_scaled = unit_cost_snapshot_scaled * quantity)
);

CREATE INDEX idx_voucher_masters_store_active_dates
  ON voucher_masters(store_id, is_active, active_from, active_until);
CREATE INDEX idx_voucher_master_products_store_product
  ON voucher_master_products(store_id, product_id, voucher_master_id);
CREATE INDEX idx_voucher_instances_customer_status
  ON voucher_instances(store_id, customer_id, status, distributed_at DESC);
CREATE INDEX idx_voucher_instances_master_status
  ON voucher_instances(master_store_id, voucher_master_id, status, distributed_at DESC);
CREATE INDEX idx_voucher_redemptions_store_time
  ON voucher_redemptions(store_id, redeemed_at DESC, id DESC);

CREATE TRIGGER trg_voucher_master_scope_insert
BEFORE INSERT ON voucher_masters
WHEN NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_MASTER_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_voucher_master_scope_update
BEFORE UPDATE OF store_id, entity_id ON voucher_masters
WHEN NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_MASTER_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_voucher_master_product_scope_insert
BEFORE INSERT ON voucher_master_products
WHEN NOT EXISTS (
       SELECT 1 FROM voucher_masters v
       WHERE v.id = NEW.voucher_master_id AND v.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_PRODUCT_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_voucher_master_product_scope_update
BEFORE UPDATE OF voucher_master_id, store_id, product_id ON voucher_master_products
WHEN NOT EXISTS (
       SELECT 1 FROM voucher_masters v
       WHERE v.id = NEW.voucher_master_id AND v.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM products p
       WHERE p.id = NEW.product_id AND p.store_id = NEW.store_id
     )
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_PRODUCT_SCOPE_MISMATCH');
END;

-- voucher_instances.store_id deliberately snapshots the customer's home
-- store, while master_store_id/distributed_store_id preserve where the
-- promotion belongs and which cashier distributed it.
CREATE TRIGGER trg_voucher_instance_scope_insert
BEFORE INSERT ON voucher_instances
WHEN NOT EXISTS (
       SELECT 1 FROM voucher_masters v
       WHERE v.id = NEW.voucher_master_id AND v.store_id = NEW.master_store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM customers c
       WHERE c.id = NEW.customer_id AND c.store_id = NEW.store_id
     )
   OR NOT EXISTS (
       SELECT 1 FROM cashiers c
       WHERE c.id = NEW.distributed_by_cashier_id AND c.store_id = NEW.distributed_store_id
     )
   OR NEW.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = NEW.store_id)
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_INSTANCE_SCOPE_MISMATCH');
END;

CREATE TRIGGER trg_voucher_instance_identity_immutable
BEFORE UPDATE OF
  id, code, voucher_master_id, master_store_id, store_id, entity_id,
  customer_id, customer_name_snapshot, distributed_store_id,
  distributed_by_cashier_id, distributed_at
ON voucher_instances
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_INSTANCE_IDENTITY_IMMUTABLE');
END;

CREATE TRIGGER trg_voucher_instance_redeemed_requires_fact
BEFORE UPDATE OF status ON voucher_instances
WHEN NEW.status = 'REDEEMED'
 AND NOT EXISTS (
   SELECT 1 FROM voucher_redemptions r
   WHERE r.voucher_instance_id = NEW.id
 )
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_FACT_REQUIRED');
END;

CREATE TRIGGER trg_voucher_instance_redeemed_immutable
BEFORE UPDATE ON voucher_instances
WHEN OLD.status = 'REDEEMED'
  AND (NEW.status <> OLD.status OR NEW.redeemed_at IS NOT OLD.redeemed_at)
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_IMMUTABLE');
END;

-- Server validation supplies friendly errors. These database guards close
-- the race window so two cashiers cannot consume one instance or the final
-- quota slot concurrently.
CREATE TRIGGER trg_voucher_redemption_guard
BEFORE INSERT ON voucher_redemptions
WHEN NOT EXISTS (
  SELECT 1
  FROM voucher_instances i
  JOIN voucher_masters v ON v.id = i.voucher_master_id
  JOIN voucher_master_products vp
    ON vp.voucher_master_id = v.id
   AND vp.store_id = v.store_id
   AND vp.product_id = NEW.product_id
  JOIN products p ON p.id = NEW.product_id AND p.store_id = v.store_id
  WHERE i.id = NEW.voucher_instance_id
    AND i.voucher_master_id = NEW.voucher_master_id
    AND i.master_store_id = NEW.store_id
    AND i.customer_id = NEW.customer_id
    AND i.store_id = NEW.customer_store_id
    AND i.status = 'UNUSED'
    AND v.is_active = 1
    AND NEW.entity_id IS (SELECT entity_id FROM stores WHERE id = NEW.store_id)
    AND EXISTS (
      SELECT 1 FROM cash_drawer_sessions d
      WHERE d.id = NEW.drawer_session_id
        AND d.store_id = NEW.store_id
        AND d.cashier_id = NEW.cashier_id
        AND d.status = 'OPEN'
    )
    AND SUBSTR(NEW.redeemed_at, 1, 10) BETWEEN v.active_from AND v.active_until
    AND v.redeemed_count < v.usage_quota
    AND p.name = NEW.product_name
    AND p.average_cost = NEW.unit_cost_snapshot_scaled
)
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_NOT_ALLOWED');
END;

CREATE TRIGGER trg_voucher_redemption_apply
AFTER INSERT ON voucher_redemptions
BEGIN
  UPDATE voucher_instances
  SET status = 'REDEEMED', redeemed_at = NEW.redeemed_at, updated_at = NEW.redeemed_at
  WHERE id = NEW.voucher_instance_id AND status = 'UNUSED';

  UPDATE voucher_masters
  SET redeemed_count = redeemed_count + 1, updated_at = NEW.redeemed_at
  WHERE id = NEW.voucher_master_id AND redeemed_count < usage_quota;
END;

CREATE TRIGGER trg_voucher_redemption_immutable_update
BEFORE UPDATE ON voucher_redemptions
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_IMMUTABLE');
END;

CREATE TRIGGER trg_voucher_redemption_immutable_delete
BEFORE DELETE ON voucher_redemptions
BEGIN
  SELECT RAISE(ABORT, 'VOUCHER_REDEMPTION_IMMUTABLE');
END;

-- 1304 and 6105 are the first unused codes in the canonical Inventory and
-- operating-expense ranges at migration time. Fail closed if a live store
-- has already customized either code instead of silently wiring the rule to
-- somebody else's account.
CREATE TABLE voucher_account_code_guard_0076 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO voucher_account_code_guard_0076 (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM stores s
  JOIN chart_of_accounts a ON a.store_id = s.id
  WHERE s.edition = 'ACCOUNTING'
    AND (
      (a.code = '1304' AND (
        a.id <> 'coa_' || s.id || '_1304'
        OR a.name <> 'Persediaan - Vocer Promosi'
        OR a.type <> 'ASSET'
        OR COALESCE(a.subtype, '') <> 'INVENTORY'
      ))
      OR (a.id = 'coa_' || s.id || '_1304' AND (
        a.code <> '1304'
        OR a.name <> 'Persediaan - Vocer Promosi'
        OR a.type <> 'ASSET'
        OR COALESCE(a.subtype, '') <> 'INVENTORY'
      ))
      OR (a.code = '6105' AND (
        a.id <> 'coa_' || s.id || '_6105'
        OR a.name <> 'Beban Promosi'
        OR a.type <> 'EXPENSE'
        OR COALESCE(a.subtype, '') <> 'PROMOTIONAL_EXPENSE'
      ))
      OR (a.id = 'coa_' || s.id || '_6105' AND (
        a.code <> '6105'
        OR a.name <> 'Beban Promosi'
        OR a.type <> 'EXPENSE'
        OR COALESCE(a.subtype, '') <> 'PROMOTIONAL_EXPENSE'
      ))
    )
) THEN 1 ELSE 0 END;
DROP TABLE voucher_account_code_guard_0076;

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || id || '_1304', id, '1304', 'Persediaan - Vocer Promosi', 'ASSET', 'INVENTORY', 1
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || id || '_6105', id, '6105', 'Beban Promosi', 'EXPENSE', 'PROMOTIONAL_EXPENSE', 1
FROM stores WHERE edition = 'ACCOUNTING';

DROP TRIGGER IF EXISTS trg_stores_voucher_accounting_defaults_after_insert;
CREATE TRIGGER trg_stores_voucher_accounting_defaults_after_insert
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
  VALUES ('coa_' || NEW.id || '_1304', NEW.id, '1304', 'Persediaan - Vocer Promosi', 'ASSET', 'INVENTORY', 1);

  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
  VALUES ('coa_' || NEW.id || '_6105', NEW.id, '6105', 'Beban Promosi', 'EXPENSE', 'PROMOTIONAL_EXPENSE', 1);

END;
