PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-09-08: onboard seven new KPM outlets from the current Pendem
-- store-scoped master/configuration state. The authoritative Entity is resolved
-- from store_pendem at migration time. This intentionally does not rename,
-- replace, or otherwise mutate Pendem's Entity identity (ADR-030).
--
-- Onboarding actor: ENT-KPM Entity Admin Rika (`entity_admin_rika_pilot`).
-- `stores` itself has no creator column, so records created by this onboarding
-- that expose provenance fields use ENTITY_ADMIN + entity_admin_rika_pilot.
-- The guard below fails closed unless Rika is active in Pendem's current Entity.
--
-- CLONED: store edition/warehouse flag/logo, item types, units, categories,
-- suppliers/contacts, product kinds, Product Master commercial/operational
-- fields, active recipes/BOM, product groups, Accounting settings, Warehouse
-- settings, Cost Master, customer-sharing membership, approval policy, active
-- Voucher Master configuration, and active Roda Puter configuration.
--
-- RESET / NOT CLONED: customers, cashiers, employees, sessions/drawers, orders,
-- sales, purchases, expenses/income, approvals/history, journals, stock balances,
-- stock movements, production runs, HPP/average-cost history, voucher instances/
-- redemptions, official spins, warehouse principal access, and any other business
-- fact/history. New product average_cost/last_purchase_price and their timestamps
-- start at zero/NULL while catalog purchase_price and price follow Pendem.
--
-- New stores are intentionally created through stores INSERTs first so every
-- repository provisioning trigger runs. The configuration copied below then
-- aligns the new stores to Pendem through natural keys (code/name), never by
-- reusing Pendem-local foreign-key ids.

CREATE TABLE clone_targets_0080 (
  ordinal INTEGER PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL
);

INSERT INTO clone_targets_0080 (ordinal, store_id, code, store_name) VALUES
  (1, 'store_sugiono', 'SUGIONO', 'Sugiono'),
  (2, 'store_genengan', 'GENENGAN', 'Genengan'),
  (3, 'store_ngijo', 'NGIJO', 'Ngijo'),
  (4, 'store_beji', 'BEJI', 'Beji'),
  (5, 'store_tlekung', 'TLEKUNG', 'Tlekung'),
  (6, 'store_dermo', 'DERMO', 'Dermo'),
  (7, 'store_kaliurang', 'KALIURANG', 'Kaliurang');

CREATE TABLE clone_pendem_guard_0080 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO clone_pendem_guard_0080 (ok)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM stores p
  JOIN entity_admins ea
    ON ea.id = 'entity_admin_rika_pilot'
   AND ea.entity_id = p.entity_id
   AND ea.is_active = 1
  WHERE p.id = 'store_pendem'
    AND p.code = 'PENDEM'
    AND p.entity_id IS NOT NULL
) THEN 1 ELSE 0 END;
DROP TABLE clone_pendem_guard_0080;

INSERT INTO stores (
  id, code, store_name, address, logo_data, is_active,
  edition, warehouse_enabled, entity_id, created_at, updated_at
)
SELECT
  t.store_id, t.code, t.store_name, '', p.logo_data, 1,
  p.edition, p.warehouse_enabled, p.entity_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN stores p
WHERE p.id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.id = t.store_id OR s.code = t.code);

-- Operational master registries.
UPDATE item_types
SET
  name = (SELECT s.name FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  can_sell = (SELECT s.can_sell FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  can_purchase = (SELECT s.can_purchase FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  can_produce = (SELECT s.can_produce FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  can_consume = (SELECT s.can_consume FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  track_stock = (SELECT s.track_stock FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  is_active = (SELECT s.is_active FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM item_types s WHERE s.store_id = 'store_pendem' AND s.code = item_types.code);

INSERT INTO item_types (
  id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume,
  track_stock, is_active, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_itemtype_' || s.id,
  t.store_id, s.code, s.name, s.can_sell, s.can_purchase, s.can_produce,
  s.can_consume, s.track_stock, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN item_types s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (
    SELECT 1 FROM item_types x WHERE x.store_id = t.store_id AND x.code = s.code
  );

UPDATE units
SET
  name = (SELECT s.name FROM units s WHERE s.store_id = 'store_pendem' AND s.code = units.code),
  symbol = (SELECT s.symbol FROM units s WHERE s.store_id = 'store_pendem' AND s.code = units.code),
  decimal_scale = (SELECT s.decimal_scale FROM units s WHERE s.store_id = 'store_pendem' AND s.code = units.code),
  is_active = (SELECT s.is_active FROM units s WHERE s.store_id = 'store_pendem' AND s.code = units.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM units s WHERE s.store_id = 'store_pendem' AND s.code = units.code);

INSERT INTO units (id, store_id, code, name, symbol, decimal_scale, is_active, created_at, updated_at)
SELECT
  'clone0080_' || t.store_id || '_unit_' || s.id,
  t.store_id, s.code, s.name, s.symbol, s.decimal_scale, s.is_active,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN units s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM units x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE product_kinds
SET
  name = (SELECT s.name FROM product_kinds s WHERE s.store_id = 'store_pendem' AND s.code = product_kinds.code),
  is_active = (SELECT s.is_active FROM product_kinds s WHERE s.store_id = 'store_pendem' AND s.code = product_kinds.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM product_kinds s WHERE s.store_id = 'store_pendem' AND s.code = product_kinds.code);

INSERT INTO product_kinds (id, store_id, code, name, is_active, created_at, updated_at)
SELECT
  'clone0080_' || t.store_id || '_kind_' || s.id,
  t.store_id, s.code, s.name, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN product_kinds s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM product_kinds x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE categories
SET
  display_order = (SELECT s.display_order FROM categories s WHERE s.store_id = 'store_pendem' AND s.name = categories.name),
  is_active = (SELECT s.is_active FROM categories s WHERE s.store_id = 'store_pendem' AND s.name = categories.name),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM categories s WHERE s.store_id = 'store_pendem' AND s.name = categories.name);

INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
SELECT t.store_id, s.name, s.display_order, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN categories s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.store_id = t.store_id AND x.name = s.name);

INSERT INTO suppliers (id, store_id, name, phone, address, notes, is_active, created_at, updated_at)
SELECT
  'clone0080_' || t.store_id || '_supplier_' || s.id,
  t.store_id, s.name, s.phone, s.address, s.notes, s.is_active,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN suppliers s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.store_id = t.store_id AND x.name = s.name);

INSERT INTO contacts (id, store_id, name, phone, email, notes, created_at, updated_at)
SELECT
  'clone0080_' || t.store_id || '_contact_' || s.id,
  t.store_id, s.name, s.phone, s.email, s.notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN contacts s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.store_id = t.store_id AND x.name = s.name AND x.phone = s.phone);

CREATE TABLE clone_product_map_0080 (
  target_store_id TEXT NOT NULL,
  source_product_id INTEGER NOT NULL,
  new_product_id INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_product_id)
);

INSERT INTO clone_product_map_0080 (target_store_id, source_product_id, new_product_id)
SELECT
  t.store_id,
  p.id,
  (SELECT COALESCE(MAX(id), 0) FROM products)
    + ROW_NUMBER() OVER (ORDER BY t.ordinal, p.id)
FROM clone_targets_0080 t
CROSS JOIN products p
WHERE p.store_id = 'store_pendem';

INSERT INTO products (
  id, store_id, name, purchase_price, price, category, emoji, image_data,
  display_order, is_active, created_at, updated_at,
  item_type_id, base_unit_id,
  points_per_unit, production_mode, recipe_link_enabled, stock_tracking_enabled,
  linked_recipe_id, product_kind_id,
  average_cost, last_purchase_price, cost_updated_at, last_purchase_at
)
SELECT
  m.new_product_id,
  m.target_store_id,
  p.name,
  p.purchase_price,
  p.price,
  p.category,
  p.emoji,
  p.image_data,
  p.display_order,
  p.is_active,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  tit.id,
  tu.id,
  p.points_per_unit,
  p.production_mode,
  p.recipe_link_enabled,
  p.stock_tracking_enabled,
  NULL,
  tk.id,
  0,
  0,
  NULL,
  NULL
FROM clone_product_map_0080 m
JOIN products p ON p.id = m.source_product_id AND p.store_id = 'store_pendem'
LEFT JOIN item_types sit ON sit.id = p.item_type_id AND sit.store_id = 'store_pendem'
LEFT JOIN item_types tit ON tit.store_id = m.target_store_id AND tit.code = sit.code
LEFT JOIN units su ON su.id = p.base_unit_id AND su.store_id = 'store_pendem'
LEFT JOIN units tu ON tu.store_id = m.target_store_id AND tu.code = su.code
LEFT JOIN product_kinds sk ON sk.id = p.product_kind_id AND sk.store_id = 'store_pendem'
LEFT JOIN product_kinds tk ON tk.store_id = m.target_store_id AND tk.code = sk.code
WHERE NOT EXISTS (SELECT 1 FROM products x WHERE x.id = m.new_product_id);

CREATE TABLE clone_recipe_map_0080 (
  target_store_id TEXT NOT NULL,
  source_recipe_id TEXT NOT NULL,
  new_recipe_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_recipe_id)
);

INSERT INTO clone_recipe_map_0080 (target_store_id, source_recipe_id, new_recipe_id)
SELECT
  t.store_id,
  r.id,
  'clone0080_' || t.store_id || '_recipe_' || r.id
FROM clone_targets_0080 t
CROSS JOIN manufacturing_recipes r
WHERE r.store_id = 'store_pendem' AND r.status = 'ACTIVE';

INSERT INTO manufacturing_recipes (
  id, store_id, output_product_id, output_unit_id, output_quantity,
  revision, status, notes, created_by_role, created_by_id, created_at, archived_at
)
SELECT
  rm.new_recipe_id,
  rm.target_store_id,
  opm.new_product_id,
  tu.id,
  r.output_quantity,
  r.revision,
  'ACTIVE',
  r.notes,
  'ENTITY_ADMIN',
  'entity_admin_rika_pilot',
  CURRENT_TIMESTAMP,
  NULL
FROM clone_recipe_map_0080 rm
JOIN manufacturing_recipes r ON r.id = rm.source_recipe_id AND r.store_id = 'store_pendem'
JOIN clone_product_map_0080 opm
  ON opm.target_store_id = rm.target_store_id AND opm.source_product_id = r.output_product_id
JOIN units su ON su.id = r.output_unit_id AND su.store_id = 'store_pendem'
JOIN units tu ON tu.store_id = rm.target_store_id AND tu.code = su.code;

INSERT INTO manufacturing_recipe_components (
  id, recipe_id, store_id, component_product_id, component_unit_id,
  quantity, display_order
)
SELECT
  'clone0080_' || rm.target_store_id || '_component_' || c.id,
  rm.new_recipe_id,
  rm.target_store_id,
  cpm.new_product_id,
  tu.id,
  c.quantity,
  c.display_order
FROM clone_recipe_map_0080 rm
JOIN manufacturing_recipe_components c
  ON c.recipe_id = rm.source_recipe_id AND c.store_id = 'store_pendem'
JOIN clone_product_map_0080 cpm
  ON cpm.target_store_id = rm.target_store_id AND cpm.source_product_id = c.component_product_id
JOIN products tp
  ON tp.id = cpm.new_product_id AND tp.store_id = rm.target_store_id
JOIN units tu
  ON tu.id = tp.base_unit_id AND tu.store_id = rm.target_store_id;

UPDATE products
SET linked_recipe_id = (
  SELECT rm.new_recipe_id
  FROM clone_product_map_0080 pm
  JOIN products sp ON sp.id = pm.source_product_id AND sp.store_id = 'store_pendem'
  JOIN clone_recipe_map_0080 rm
    ON rm.target_store_id = pm.target_store_id AND rm.source_recipe_id = sp.linked_recipe_id
  WHERE pm.new_product_id = products.id
)
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (
    SELECT 1
    FROM clone_product_map_0080 pm
    JOIN products sp ON sp.id = pm.source_product_id AND sp.store_id = 'store_pendem'
    JOIN clone_recipe_map_0080 rm
      ON rm.target_store_id = pm.target_store_id AND rm.source_recipe_id = sp.linked_recipe_id
    WHERE pm.new_product_id = products.id
  );

CREATE TABLE clone_product_group_map_0080 (
  target_store_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  new_group_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_group_id)
);

INSERT INTO clone_product_group_map_0080 (target_store_id, source_group_id, new_group_id)
SELECT t.store_id, g.id, 'clone0080_' || t.store_id || '_pgroup_' || g.id
FROM clone_targets_0080 t
CROSS JOIN product_groups g
WHERE g.store_id = 'store_pendem';

INSERT INTO product_groups (id, store_id, name, created_by_role, created_by_id, created_at)
SELECT m.new_group_id, m.target_store_id, g.name, 'ENTITY_ADMIN', 'entity_admin_rika_pilot', CURRENT_TIMESTAMP
FROM clone_product_group_map_0080 m
JOIN product_groups g ON g.id = m.source_group_id AND g.store_id = 'store_pendem';

INSERT INTO product_group_items (product_group_id, product_id, sort_order)
SELECT gm.new_group_id, pm.new_product_id, i.sort_order
FROM clone_product_group_map_0080 gm
JOIN product_group_items i ON i.product_group_id = gm.source_group_id
JOIN clone_product_map_0080 pm
  ON pm.target_store_id = gm.target_store_id AND pm.source_product_id = i.product_id;

-- Accounting Settings. New stores have no facts, so clear disposable child
-- trigger seeds and rebuild them from Pendem. Provisioned Chart of Accounts
-- rows are intentionally PRESERVED: active repository triggers still resolve
-- system account ids using canonical `coa_<store>_<code>` identities. Existing
-- accounts are aligned to Pendem by code; only Pendem-only custom accounts get
-- new clone-local ids. This keeps CASH/RAW_MATERIAL provisioning FK-safe.
-- Deprecated connector compatibility tables remain on canonical trigger defaults;
-- they are not runtime Accounting authority.
DELETE FROM journal_rules WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM accounting_choice_options WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM accounting_choice_groups WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM item_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM payment_methods WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM transaction_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

UPDATE chart_of_accounts
SET
  name = (SELECT s.name FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code),
  type = (SELECT s.type FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code),
  subtype = (SELECT s.subtype FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code),
  is_active = (SELECT s.is_active FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code),
  review_required = (SELECT s.review_required FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM chart_of_accounts s WHERE s.store_id = 'store_pendem' AND s.code = chart_of_accounts.code);

INSERT INTO chart_of_accounts (
  id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_coa_' || s.code,
  t.store_id, s.code, s.name, s.type, s.subtype, s.is_active, s.review_required,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN chart_of_accounts s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE payment_methods
SET is_default = 0
WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

UPDATE payment_methods
SET
  name = (SELECT s.name FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code),
  account_id = (
    SELECT ta.id
    FROM payment_methods s
    LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_pendem'
    LEFT JOIN chart_of_accounts ta ON ta.store_id = payment_methods.store_id AND ta.code = sa.code
    WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code
  ),
  is_active = (SELECT s.is_active FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code);

INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default, created_at, updated_at)
SELECT
  'clone0080_' || t.store_id || '_payment_' || s.code,
  t.store_id, s.code, s.name, ta.id, s.is_active, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN payment_methods s
LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_pendem'
LEFT JOIN chart_of_accounts ta ON ta.store_id = t.store_id AND ta.code = sa.code
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM payment_methods x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE payment_methods
SET
  name = (SELECT s.name FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code),
  account_id = (
    SELECT ta.id
    FROM payment_methods s
    LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_pendem'
    LEFT JOIN chart_of_accounts ta ON ta.store_id = payment_methods.store_id AND ta.code = sa.code
    WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code
  ),
  is_active = (SELECT s.is_active FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM payment_methods s WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code);

UPDATE payment_methods
SET is_default = COALESCE((
  SELECT s.is_default FROM payment_methods s
  WHERE s.store_id = 'store_pendem' AND s.code = payment_methods.code
), 0)
WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

UPDATE transaction_categories
SET
  name = (SELECT s.name FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  involves_payment = (SELECT s.involves_payment FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  involves_item_category = (SELECT s.involves_item_category FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  is_active = (SELECT s.is_active FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  description = (SELECT s.description FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  registered_by_module = (SELECT s.registered_by_module FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0080)
  AND EXISTS (SELECT 1 FROM transaction_categories s WHERE s.store_id = 'store_pendem' AND s.code = transaction_categories.code);

INSERT INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category,
  is_active, description, registered_by_module, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_txcat_' || s.code,
  t.store_id, s.code, s.name, s.involves_payment, s.involves_item_category,
  s.is_active, s.description, s.registered_by_module, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN transaction_categories s
WHERE s.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM transaction_categories x WHERE x.store_id = t.store_id AND x.code = s.code);

DELETE FROM item_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

INSERT INTO item_categories (
  id, store_id, product_kind_id, name,
  inventory_account_id, cogs_account_id, revenue_account_id,
  is_active, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_itemcat_' || sc.id,
  t.store_id,
  tk.id,
  sc.name,
  tai.id,
  tac.id,
  tar.id,
  sc.is_active,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN item_categories sc
JOIN product_kinds sk ON sk.id = sc.product_kind_id AND sk.store_id = 'store_pendem'
JOIN product_kinds tk ON tk.store_id = t.store_id AND tk.code = sk.code
JOIN chart_of_accounts sai ON sai.id = sc.inventory_account_id AND sai.store_id = 'store_pendem'
JOIN chart_of_accounts tai ON tai.store_id = t.store_id AND tai.code = sai.code
JOIN chart_of_accounts sac ON sac.id = sc.cogs_account_id AND sac.store_id = 'store_pendem'
JOIN chart_of_accounts tac ON tac.store_id = t.store_id AND tac.code = sac.code
LEFT JOIN chart_of_accounts sar ON sar.id = sc.revenue_account_id AND sar.store_id = 'store_pendem'
LEFT JOIN chart_of_accounts tar ON tar.store_id = t.store_id AND tar.code = sar.code
WHERE sc.store_id = 'store_pendem';

DELETE FROM accounting_choice_options
WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM accounting_choice_groups
WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

CREATE TABLE clone_choice_group_map_0080 (
  target_store_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  new_group_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_group_id)
);

INSERT INTO clone_choice_group_map_0080 (target_store_id, source_group_id, new_group_id)
SELECT t.store_id, g.id, 'clone0080_' || t.store_id || '_choice_' || g.code
FROM clone_targets_0080 t
CROSS JOIN accounting_choice_groups g
WHERE g.store_id = 'store_pendem';

INSERT INTO accounting_choice_groups (
  id, store_id, entity_id, code, name, is_active, created_at, updated_at
)
SELECT
  m.new_group_id,
  m.target_store_id,
  CASE WHEN g.entity_id IS NULL THEN NULL ELSE (SELECT entity_id FROM stores WHERE id = m.target_store_id) END,
  g.code, g.name, g.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_choice_group_map_0080 m
JOIN accounting_choice_groups g ON g.id = m.source_group_id AND g.store_id = 'store_pendem';

INSERT INTO accounting_choice_options (
  id, choice_group_id, store_id, code, name, account_id,
  is_default, sort_order, is_active, created_at, updated_at
)
SELECT
  'clone0080_' || gm.target_store_id || '_choiceopt_' || o.id,
  gm.new_group_id,
  gm.target_store_id,
  o.code,
  o.name,
  ta.id,
  o.is_default,
  o.sort_order,
  o.is_active,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_choice_group_map_0080 gm
JOIN accounting_choice_options o ON o.choice_group_id = gm.source_group_id AND o.store_id = 'store_pendem'
LEFT JOIN chart_of_accounts sa ON sa.id = o.account_id AND sa.store_id = 'store_pendem'
LEFT JOIN chart_of_accounts ta ON ta.store_id = gm.target_store_id AND ta.code = sa.code;

DELETE FROM journal_rules WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

INSERT INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type,
  fixed_account_id, choice_group_id, is_active, sort_order, is_default,
  created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_jrule_' || r.id,
  t.store_id,
  ttc.id,
  r.label,
  r.side,
  r.source_type,
  ta.id,
  tcg.id,
  r.is_active,
  r.sort_order,
  r.is_default,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN journal_rules r
JOIN transaction_categories stc ON stc.id = r.transaction_category_id AND stc.store_id = 'store_pendem'
JOIN transaction_categories ttc ON ttc.store_id = t.store_id AND ttc.code = stc.code
LEFT JOIN chart_of_accounts sa ON sa.id = r.fixed_account_id AND sa.store_id = 'store_pendem'
LEFT JOIN chart_of_accounts ta ON ta.store_id = t.store_id AND ta.code = sa.code
LEFT JOIN accounting_choice_groups scg ON scg.id = r.choice_group_id AND scg.store_id = 'store_pendem'
LEFT JOIN accounting_choice_groups tcg ON tcg.store_id = t.store_id AND tcg.code = scg.code
WHERE r.store_id = 'store_pendem';

-- Warehouse configuration. Principal access is deliberately not inherited.
DELETE FROM warehouse_access WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM warehouse_stock_opname_settings WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
DELETE FROM warehouses WHERE store_id IN (SELECT store_id FROM clone_targets_0080);

CREATE TABLE clone_warehouse_map_0080 (
  target_store_id TEXT NOT NULL,
  source_warehouse_id TEXT NOT NULL,
  new_warehouse_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_warehouse_id)
);

INSERT INTO clone_warehouse_map_0080 (target_store_id, source_warehouse_id, new_warehouse_id)
SELECT t.store_id, w.id, 'clone0080_' || t.store_id || '_warehouse_' || w.code
FROM clone_targets_0080 t
CROSS JOIN warehouses w
WHERE w.store_id = 'store_pendem';

INSERT INTO warehouses (
  id, store_id, code, name, location_name, is_active, created_at, updated_at
)
SELECT
  m.new_warehouse_id, m.target_store_id, w.code, w.name, w.location_name,
  w.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_warehouse_map_0080 m
JOIN warehouses w ON w.id = m.source_warehouse_id AND w.store_id = 'store_pendem';

INSERT INTO warehouse_stock_opname_settings (
  warehouse_id, store_id, quantity_tolerance, percentage_tolerance_bps,
  schedule_type, schedule_day, requires_approval, updated_at
)
SELECT
  wm.new_warehouse_id, wm.target_store_id,
  s.quantity_tolerance, s.percentage_tolerance_bps,
  s.schedule_type, s.schedule_day, s.requires_approval, CURRENT_TIMESTAMP
FROM clone_warehouse_map_0080 wm
JOIN warehouse_stock_opname_settings s
  ON s.warehouse_id = wm.source_warehouse_id AND s.store_id = 'store_pendem';

-- Other safe store-scoped configuration/master data.
INSERT INTO cost_types (
  id, store_id, code, name, accounting_component_rule_id, is_active, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_costtype_' || c.id,
  t.store_id, c.code, c.name,
  NULL,
  c.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN cost_types c
WHERE c.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM cost_types x WHERE x.store_id = t.store_id AND x.code = c.code);

INSERT INTO cost_masters (
  id, store_id, name, contact, outgoing_amount, incoming_amount,
  cost_type_id, cost_group, is_active, created_at, updated_at
)
SELECT
  'clone0080_' || t.store_id || '_costmaster_' || c.id,
  t.store_id, c.name, c.contact, c.outgoing_amount, c.incoming_amount,
  tc.id, c.cost_group, c.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN cost_masters c
JOIN cost_types sct ON sct.id = c.cost_type_id AND sct.store_id = 'store_pendem'
JOIN cost_types tc ON tc.store_id = t.store_id AND tc.code = sct.code
WHERE c.store_id = 'store_pendem'
  AND NOT EXISTS (SELECT 1 FROM cost_masters x WHERE x.store_id = t.store_id AND x.name = c.name);

INSERT OR IGNORE INTO customer_share_group_stores (group_id, store_id, created_at)
SELECT g.group_id, t.store_id, CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN customer_share_group_stores g
WHERE g.store_id = 'store_pendem';

DELETE FROM store_approval_settings WHERE store_id IN (SELECT store_id FROM clone_targets_0080);
INSERT INTO store_approval_settings (
  store_id, auto_permit_enabled, enabled_by_role, enabled_by_id,
  enabled_at, updated_at
)
SELECT
  t.store_id,
  s.auto_permit_enabled,
  CASE WHEN s.auto_permit_enabled = 1 THEN 'ENTITY_ADMIN' ELSE NULL END,
  CASE WHEN s.auto_permit_enabled = 1 THEN 'entity_admin_rika_pilot' ELSE NULL END,
  CASE WHEN s.auto_permit_enabled = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
  CURRENT_TIMESTAMP
FROM clone_targets_0080 t
CROSS JOIN store_approval_settings s
WHERE s.store_id = 'store_pendem';

-- Promotion configuration. Runtime distribution/redemption/spin facts reset.
CREATE TABLE clone_voucher_master_map_0080 (
  target_store_id TEXT NOT NULL,
  source_voucher_master_id TEXT NOT NULL,
  new_voucher_master_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_voucher_master_id)
);

INSERT INTO clone_voucher_master_map_0080 (
  target_store_id, source_voucher_master_id, new_voucher_master_id
)
SELECT
  t.store_id,
  v.id,
  'clone0080_' || t.store_id || '_voucher_' || v.id
FROM clone_targets_0080 t
CROSS JOIN voucher_masters v
WHERE v.store_id = 'store_pendem'
  AND (
    v.is_active = 1
    OR EXISTS (
      SELECT 1
      FROM roda_puter_rewards rr
      JOIN roda_puter_campaigns rc ON rc.id = rr.campaign_id
      WHERE rc.store_id = 'store_pendem' AND rc.is_active = 1
        AND rr.voucher_master_id = v.id
    )
  );

INSERT INTO voucher_masters (
  id, store_id, entity_id, name, active_from, active_until, usage_quota,
  redeemed_count, is_active, created_by_role, created_by_id, created_at, updated_at
)
SELECT
  m.new_voucher_master_id,
  m.target_store_id,
  (SELECT entity_id FROM stores WHERE id = m.target_store_id),
  v.name,
  v.active_from,
  v.active_until,
  v.usage_quota,
  0,
  v.is_active,
  'ENTITY_ADMIN',
  'entity_admin_rika_pilot',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_voucher_master_map_0080 m
JOIN voucher_masters v ON v.id = m.source_voucher_master_id AND v.store_id = 'store_pendem';

INSERT INTO voucher_master_products (
  voucher_master_id, store_id, product_id, sort_order, created_at
)
SELECT
  vm.new_voucher_master_id,
  vm.target_store_id,
  pm.new_product_id,
  vp.sort_order,
  CURRENT_TIMESTAMP
FROM clone_voucher_master_map_0080 vm
JOIN voucher_master_products vp
  ON vp.voucher_master_id = vm.source_voucher_master_id AND vp.store_id = 'store_pendem'
JOIN clone_product_map_0080 pm
  ON pm.target_store_id = vm.target_store_id AND pm.source_product_id = vp.product_id;

CREATE TABLE clone_roda_campaign_map_0080 (
  target_store_id TEXT NOT NULL,
  source_campaign_id TEXT NOT NULL,
  new_campaign_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_campaign_id)
);

INSERT INTO clone_roda_campaign_map_0080 (target_store_id, source_campaign_id, new_campaign_id)
SELECT
  t.store_id, c.id, 'clone0080_' || t.store_id || '_roda_' || c.id
FROM clone_targets_0080 t
CROSS JOIN roda_puter_campaigns c
WHERE c.store_id = 'store_pendem' AND c.is_active = 1;

INSERT INTO roda_puter_campaigns (
  id, store_id, entity_id, version, total_weight_basis_points,
  is_active, created_by_role, created_by_id, created_at
)
SELECT
  cm.new_campaign_id,
  cm.target_store_id,
  (SELECT entity_id FROM stores WHERE id = cm.target_store_id),
  c.version,
  c.total_weight_basis_points,
  1,
  'ENTITY_ADMIN',
  'entity_admin_rika_pilot',
  CURRENT_TIMESTAMP
FROM clone_roda_campaign_map_0080 cm
JOIN roda_puter_campaigns c ON c.id = cm.source_campaign_id AND c.store_id = 'store_pendem';

INSERT INTO roda_puter_rewards (
  id, campaign_id, store_id, voucher_master_id, product_id,
  product_name_snapshot, weight_basis_points, sort_order, created_at
)
SELECT
  'clone0080_' || cm.target_store_id || '_reward_' || r.id,
  cm.new_campaign_id,
  cm.target_store_id,
  vm.new_voucher_master_id,
  pm.new_product_id,
  tp.name,
  r.weight_basis_points,
  r.sort_order,
  CURRENT_TIMESTAMP
FROM clone_roda_campaign_map_0080 cm
JOIN roda_puter_rewards r
  ON r.campaign_id = cm.source_campaign_id AND r.store_id = 'store_pendem'
JOIN clone_voucher_master_map_0080 vm
  ON vm.target_store_id = cm.target_store_id AND vm.source_voucher_master_id = r.voucher_master_id
JOIN clone_product_map_0080 pm
  ON pm.target_store_id = cm.target_store_id AND pm.source_product_id = r.product_id
JOIN products tp ON tp.id = pm.new_product_id AND tp.store_id = cm.target_store_id;

-- One dedicated Admin Gerai per outlet. Only SHA-256 hashes are versioned.
-- Plaintext credentials are delivered directly to Bos Cyo outside the repo.
INSERT INTO store_admins (
  id, store_id, username, password_hash, display_name, is_active, created_at, updated_at
) VALUES
  ('admin_sugiono_0080', 'store_sugiono', 'admin_sugiono',
   '110c12315f02eaf733284d9d437505c8462ef88391c97ae04243a4890efb8211',
   'Admin Sugiono', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_genengan_0080', 'store_genengan', 'admin_genengan',
   '101c6b2ce8fa812011cbf7460ecfd28809af7742e20a32da99c5571f308b91dd',
   'Admin Genengan', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_ngijo_0080', 'store_ngijo', 'admin_ngijo',
   '4b303bcf686da5dfc2065128ef1f842c3c621ea319d808f5d92d1337ca968e8d',
   'Admin Ngijo', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_beji_0080', 'store_beji', 'admin_beji',
   '5f42b2575639439c820d061fa3c6fc6fb1b753b70a9f74fa8dee6ffb80f540ee',
   'Admin Beji', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_tlekung_0080', 'store_tlekung', 'admin_tlekung',
   'acc91057d6218b1680f06578cafe22d6a81ec098010ee68e63010b807ab32478',
   'Admin Tlekung', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_dermo_0080', 'store_dermo', 'admin_dermo',
   '3a3f6c64edb339f297431d264c37986d2da1558e9ceee0cd7baa6a2c37b70c65',
   'Admin Dermo', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('admin_kaliurang_0080', 'store_kaliurang', 'admin_kaliurang',
   '3d05964a5bf916298e082cec1184b5a71ed1719553df1cb4014b4f386df80d5a',
   'Admin Kaliurang', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Fail-closed postconditions. Do not accept a partial batch or leaked history.
CREATE TABLE clone_result_guard_0080 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO clone_result_guard_0080 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM stores s JOIN clone_targets_0080 t ON t.store_id = s.id) = 7
  AND NOT EXISTS (
    SELECT 1
    FROM stores s
    JOIN clone_targets_0080 t ON t.store_id = s.id
    WHERE s.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = 'store_pendem')
       OR s.edition IS NOT (SELECT edition FROM stores WHERE id = 'store_pendem')
       OR s.warehouse_enabled IS NOT (SELECT warehouse_enabled FROM stores WHERE id = 'store_pendem')
  )
  AND (SELECT COUNT(*) FROM store_admins a JOIN clone_targets_0080 t ON t.store_id = a.store_id) = 7
  AND NOT EXISTS (
    SELECT 1 FROM clone_targets_0080 t
    WHERE (SELECT COUNT(*) FROM products p WHERE p.store_id = t.store_id)
       <> (SELECT COUNT(*) FROM products p WHERE p.store_id = 'store_pendem')
  )
  AND NOT EXISTS (
    SELECT 1 FROM clone_targets_0080 t
    WHERE (SELECT COUNT(*) FROM manufacturing_recipes r WHERE r.store_id = t.store_id AND r.status = 'ACTIVE')
       <> (SELECT COUNT(*) FROM manufacturing_recipes r WHERE r.store_id = 'store_pendem' AND r.status = 'ACTIVE')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM clone_targets_0080 t
    JOIN chart_of_accounts source_account ON source_account.store_id = 'store_pendem'
    WHERE NOT EXISTS (
      SELECT 1 FROM chart_of_accounts target_account
      WHERE target_account.store_id = t.store_id
        AND target_account.code = source_account.code
    )
  )
  AND (SELECT COUNT(*) FROM customers WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM cashiers WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM cash_drawer_sessions WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM orders WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM sales WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM purchases WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM expenses WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM other_income WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM stock_movements WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM inventory_stock_balances WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM production_runs WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM accounting_journal_headers WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM approval_requests WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM voucher_instances WHERE distributed_store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM voucher_redemptions WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND (SELECT COUNT(*) FROM roda_puter_official_spins WHERE store_id IN (SELECT store_id FROM clone_targets_0080)) = 0
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.store_id IN (SELECT store_id FROM clone_targets_0080)
      AND (p.average_cost <> 0 OR p.last_purchase_price <> 0 OR p.cost_updated_at IS NOT NULL OR p.last_purchase_at IS NOT NULL)
  )
THEN 1 ELSE 0 END;
DROP TABLE clone_result_guard_0080;

DROP TABLE clone_roda_campaign_map_0080;
DROP TABLE clone_voucher_master_map_0080;
DROP TABLE clone_warehouse_map_0080;
DROP TABLE clone_choice_group_map_0080;
DROP TABLE clone_product_group_map_0080;
DROP TABLE clone_recipe_map_0080;
DROP TABLE clone_product_map_0080;
DROP TABLE clone_targets_0080;
