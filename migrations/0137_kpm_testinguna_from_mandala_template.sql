PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-10-05: "bikin gerai lagi di entity kpm dengan menduplikat satu
-- gerai existing. namai dengan gerai testinguna ... buat kamu testing disana".
-- Gerai uji untuk Hana menguji Una (mode agen) tanpa menyentuh gerai sungguhan.
--
-- Prosedur: STORE_ONBOARDING_RUNBOOK.md (same-Entity clone), diturunkan dari
-- migration 0081 (KPM dari Pendem) dengan perubahan:
--   - template: store_mandala (MANDALA, ENT-KPM) -- gerai yang paling sering
--     dipakai Bos Cyo bersama Una, master barang/resep/akuntansinya paling hidup;
--   - target tunggal: store_testinguna / TESTINGUNA / "Testing Una";
--   - aktor onboarding: Entity Admin Bos Cyo (entity_admin_boscyo_kpm, migration
--     0090) -- akun yang Bos Cyo titipkan ke sesi Hana untuk menguji; akun
--     entity_admin_hana_kpm (0095) nonaktif di produksi. Wajib aktif di entity
--     yang sama dengan Mandala (fail closed);
--   - TIDAK ikut Customer Sharing Group: gerai uji tidak boleh melihat
--     pelanggan sungguhan;
--   - TIDAK membuat akun Admin Gerai: pengujian lewat akun Entity Admin.
--
-- Additive murni. Tidak mengubah Mandala atau gerai lain. Riwayat bisnis
-- (penjualan, pembelian, stok, HPP, jurnal) mulai kosong, sama seperti 0081.

CREATE TABLE clone_targets_0137 (
  ordinal INTEGER PRIMARY KEY,
  store_id TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL
);

INSERT INTO clone_targets_0137 (ordinal, store_id, code, store_name) VALUES
  (1, 'store_testinguna', 'TESTINGUNA', 'Testing Una');

CREATE TABLE clone_template_guard_0137 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO clone_template_guard_0137 (ok)
SELECT CASE WHEN EXISTS (
  SELECT 1
  FROM stores p
  JOIN entity_admins ea
    ON ea.id = 'entity_admin_boscyo_kpm'
   AND ea.entity_id = p.entity_id
   AND ea.is_active = 1
  WHERE p.id = 'store_mandala'
    AND p.code = 'MANDALA'
    AND p.entity_id IS NOT NULL
) THEN 1 ELSE 0 END;
DROP TABLE clone_template_guard_0137;

INSERT INTO stores (
  id, code, store_name, address, logo_data, is_active,
  edition, warehouse_enabled, entity_id, created_at, updated_at
)
SELECT
  t.store_id, t.code, t.store_name, '', p.logo_data, 1,
  p.edition, p.warehouse_enabled, p.entity_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN stores p
WHERE p.id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.id = t.store_id OR s.code = t.code);

-- Operational master registries.
UPDATE item_types
SET
  name = (SELECT s.name FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  can_sell = (SELECT s.can_sell FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  can_purchase = (SELECT s.can_purchase FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  can_produce = (SELECT s.can_produce FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  can_consume = (SELECT s.can_consume FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  track_stock = (SELECT s.track_stock FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  is_active = (SELECT s.is_active FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM item_types s WHERE s.store_id = 'store_mandala' AND s.code = item_types.code);

INSERT INTO item_types (
  id, store_id, code, name, can_sell, can_purchase, can_produce, can_consume,
  track_stock, is_active, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_itemtype_' || s.id,
  t.store_id, s.code, s.name, s.can_sell, s.can_purchase, s.can_produce,
  s.can_consume, s.track_stock, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN item_types s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (
    SELECT 1 FROM item_types x WHERE x.store_id = t.store_id AND x.code = s.code
  );

UPDATE units
SET
  name = (SELECT s.name FROM units s WHERE s.store_id = 'store_mandala' AND s.code = units.code),
  symbol = (SELECT s.symbol FROM units s WHERE s.store_id = 'store_mandala' AND s.code = units.code),
  decimal_scale = (SELECT s.decimal_scale FROM units s WHERE s.store_id = 'store_mandala' AND s.code = units.code),
  is_active = (SELECT s.is_active FROM units s WHERE s.store_id = 'store_mandala' AND s.code = units.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM units s WHERE s.store_id = 'store_mandala' AND s.code = units.code);

INSERT INTO units (id, store_id, code, name, symbol, decimal_scale, is_active, created_at, updated_at)
SELECT
  'clone0137_' || t.store_id || '_unit_' || s.id,
  t.store_id, s.code, s.name, s.symbol, s.decimal_scale, s.is_active,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN units s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM units x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE product_kinds
SET
  name = (SELECT s.name FROM product_kinds s WHERE s.store_id = 'store_mandala' AND s.code = product_kinds.code),
  is_active = (SELECT s.is_active FROM product_kinds s WHERE s.store_id = 'store_mandala' AND s.code = product_kinds.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM product_kinds s WHERE s.store_id = 'store_mandala' AND s.code = product_kinds.code);

INSERT INTO product_kinds (id, store_id, code, name, is_active, created_at, updated_at)
SELECT
  'clone0137_' || t.store_id || '_kind_' || s.id,
  t.store_id, s.code, s.name, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN product_kinds s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM product_kinds x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE categories
SET
  display_order = (SELECT s.display_order FROM categories s WHERE s.store_id = 'store_mandala' AND s.name = categories.name),
  is_active = (SELECT s.is_active FROM categories s WHERE s.store_id = 'store_mandala' AND s.name = categories.name),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM categories s WHERE s.store_id = 'store_mandala' AND s.name = categories.name);

INSERT INTO categories (store_id, name, display_order, is_active, created_at, updated_at)
SELECT t.store_id, s.name, s.display_order, s.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN categories s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM categories x WHERE x.store_id = t.store_id AND x.name = s.name);

INSERT INTO suppliers (id, store_id, name, phone, address, notes, is_active, created_at, updated_at)
SELECT
  'clone0137_' || t.store_id || '_supplier_' || s.id,
  t.store_id, s.name, s.phone, s.address, s.notes, s.is_active,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN suppliers s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM suppliers x WHERE x.store_id = t.store_id AND x.name = s.name);

INSERT INTO contacts (id, store_id, name, phone, email, notes, created_at, updated_at)
SELECT
  'clone0137_' || t.store_id || '_contact_' || s.id,
  t.store_id, s.name, s.phone, s.email, s.notes, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN contacts s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM contacts x WHERE x.store_id = t.store_id AND x.name = s.name AND x.phone = s.phone);

CREATE TABLE clone_product_map_0137 (
  target_store_id TEXT NOT NULL,
  source_product_id INTEGER NOT NULL,
  new_product_id INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_product_id)
);

INSERT INTO clone_product_map_0137 (target_store_id, source_product_id, new_product_id)
SELECT
  t.store_id,
  p.id,
  (SELECT COALESCE(MAX(id), 0) FROM products)
    + ROW_NUMBER() OVER (ORDER BY t.ordinal, p.id)
FROM clone_targets_0137 t
CROSS JOIN products p
WHERE p.store_id = 'store_mandala';

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
FROM clone_product_map_0137 m
JOIN products p ON p.id = m.source_product_id AND p.store_id = 'store_mandala'
LEFT JOIN item_types sit ON sit.id = p.item_type_id AND sit.store_id = 'store_mandala'
LEFT JOIN item_types tit ON tit.store_id = m.target_store_id AND tit.code = sit.code
LEFT JOIN units su ON su.id = p.base_unit_id AND su.store_id = 'store_mandala'
LEFT JOIN units tu ON tu.store_id = m.target_store_id AND tu.code = su.code
LEFT JOIN product_kinds sk ON sk.id = p.product_kind_id AND sk.store_id = 'store_mandala'
LEFT JOIN product_kinds tk ON tk.store_id = m.target_store_id AND tk.code = sk.code
WHERE NOT EXISTS (SELECT 1 FROM products x WHERE x.id = m.new_product_id);

CREATE TABLE clone_recipe_map_0137 (
  target_store_id TEXT NOT NULL,
  source_recipe_id TEXT NOT NULL,
  new_recipe_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_recipe_id)
);

INSERT INTO clone_recipe_map_0137 (target_store_id, source_recipe_id, new_recipe_id)
SELECT
  t.store_id,
  r.id,
  'clone0137_' || t.store_id || '_recipe_' || r.id
FROM clone_targets_0137 t
CROSS JOIN manufacturing_recipes r
WHERE r.store_id = 'store_mandala' AND r.status = 'ACTIVE';

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
  'entity_admin_boscyo_kpm',
  CURRENT_TIMESTAMP,
  NULL
FROM clone_recipe_map_0137 rm
JOIN manufacturing_recipes r ON r.id = rm.source_recipe_id AND r.store_id = 'store_mandala'
JOIN clone_product_map_0137 opm
  ON opm.target_store_id = rm.target_store_id AND opm.source_product_id = r.output_product_id
JOIN units su ON su.id = r.output_unit_id AND su.store_id = 'store_mandala'
JOIN units tu ON tu.store_id = rm.target_store_id AND tu.code = su.code;

INSERT INTO manufacturing_recipe_components (
  id, recipe_id, store_id, component_product_id, component_unit_id,
  quantity, display_order
)
SELECT
  'clone0137_' || rm.target_store_id || '_component_' || c.id,
  rm.new_recipe_id,
  rm.target_store_id,
  cpm.new_product_id,
  tu.id,
  c.quantity,
  c.display_order
FROM clone_recipe_map_0137 rm
JOIN manufacturing_recipe_components c
  ON c.recipe_id = rm.source_recipe_id AND c.store_id = 'store_mandala'
JOIN clone_product_map_0137 cpm
  ON cpm.target_store_id = rm.target_store_id AND cpm.source_product_id = c.component_product_id
JOIN products tp
  ON tp.id = cpm.new_product_id AND tp.store_id = rm.target_store_id
JOIN units tu
  ON tu.id = tp.base_unit_id AND tu.store_id = rm.target_store_id;

UPDATE products
SET linked_recipe_id = (
  SELECT rm.new_recipe_id
  FROM clone_product_map_0137 pm
  JOIN products sp ON sp.id = pm.source_product_id AND sp.store_id = 'store_mandala'
  JOIN clone_recipe_map_0137 rm
    ON rm.target_store_id = pm.target_store_id AND rm.source_recipe_id = sp.linked_recipe_id
  WHERE pm.new_product_id = products.id
)
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (
    SELECT 1
    FROM clone_product_map_0137 pm
    JOIN products sp ON sp.id = pm.source_product_id AND sp.store_id = 'store_mandala'
    JOIN clone_recipe_map_0137 rm
      ON rm.target_store_id = pm.target_store_id AND rm.source_recipe_id = sp.linked_recipe_id
    WHERE pm.new_product_id = products.id
  );

CREATE TABLE clone_product_group_map_0137 (
  target_store_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  new_group_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_group_id)
);

INSERT INTO clone_product_group_map_0137 (target_store_id, source_group_id, new_group_id)
SELECT t.store_id, g.id, 'clone0137_' || t.store_id || '_pgroup_' || g.id
FROM clone_targets_0137 t
CROSS JOIN product_groups g
WHERE g.store_id = 'store_mandala';

INSERT INTO product_groups (id, store_id, name, created_by_role, created_by_id, created_at)
SELECT m.new_group_id, m.target_store_id, g.name, 'ENTITY_ADMIN', 'entity_admin_boscyo_kpm', CURRENT_TIMESTAMP
FROM clone_product_group_map_0137 m
JOIN product_groups g ON g.id = m.source_group_id AND g.store_id = 'store_mandala';

INSERT INTO product_group_items (product_group_id, product_id, sort_order)
SELECT gm.new_group_id, pm.new_product_id, i.sort_order
FROM clone_product_group_map_0137 gm
JOIN product_group_items i ON i.product_group_id = gm.source_group_id
JOIN clone_product_map_0137 pm
  ON pm.target_store_id = gm.target_store_id AND pm.source_product_id = i.product_id;

-- Accounting Settings. New stores have no facts, so clear disposable child
-- trigger seeds and rebuild them from Pendem. Provisioned Chart of Accounts
-- rows are intentionally PRESERVED: active repository triggers still resolve
-- system account ids using canonical `coa_<store>_<code>` identities. Existing
-- accounts are aligned to Pendem by code; only Pendem-only custom accounts get
-- new clone-local ids. This keeps CASH/RAW_MATERIAL provisioning FK-safe.
-- Deprecated connector compatibility tables remain on canonical trigger defaults;
-- they are not runtime Accounting authority.
DELETE FROM journal_rules WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM accounting_choice_options WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM accounting_choice_groups WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM item_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM payment_methods WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM transaction_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

UPDATE chart_of_accounts
SET
  name = (SELECT s.name FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code),
  type = (SELECT s.type FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code),
  subtype = (SELECT s.subtype FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code),
  is_active = (SELECT s.is_active FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code),
  review_required = (SELECT s.review_required FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM chart_of_accounts s WHERE s.store_id = 'store_mandala' AND s.code = chart_of_accounts.code);

INSERT INTO chart_of_accounts (
  id, store_id, code, name, type, subtype, is_active, review_required, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_coa_' || s.code,
  t.store_id, s.code, s.name, s.type, s.subtype, s.is_active, s.review_required,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN chart_of_accounts s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE payment_methods
SET is_default = 0
WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

UPDATE payment_methods
SET
  name = (SELECT s.name FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code),
  account_id = (
    SELECT ta.id
    FROM payment_methods s
    LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_mandala'
    LEFT JOIN chart_of_accounts ta ON ta.store_id = payment_methods.store_id AND ta.code = sa.code
    WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code
  ),
  is_active = (SELECT s.is_active FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code);

INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id, is_active, is_default, created_at, updated_at)
SELECT
  'clone0137_' || t.store_id || '_payment_' || s.code,
  t.store_id, s.code, s.name, ta.id, s.is_active, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN payment_methods s
LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_mandala'
LEFT JOIN chart_of_accounts ta ON ta.store_id = t.store_id AND ta.code = sa.code
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM payment_methods x WHERE x.store_id = t.store_id AND x.code = s.code);

UPDATE payment_methods
SET
  name = (SELECT s.name FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code),
  account_id = (
    SELECT ta.id
    FROM payment_methods s
    LEFT JOIN chart_of_accounts sa ON sa.id = s.account_id AND sa.store_id = 'store_mandala'
    LEFT JOIN chart_of_accounts ta ON ta.store_id = payment_methods.store_id AND ta.code = sa.code
    WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code
  ),
  is_active = (SELECT s.is_active FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM payment_methods s WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code);

UPDATE payment_methods
SET is_default = COALESCE((
  SELECT s.is_default FROM payment_methods s
  WHERE s.store_id = 'store_mandala' AND s.code = payment_methods.code
), 0)
WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

UPDATE transaction_categories
SET
  name = (SELECT s.name FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  involves_payment = (SELECT s.involves_payment FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  involves_item_category = (SELECT s.involves_item_category FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  is_active = (SELECT s.is_active FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  description = (SELECT s.description FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  registered_by_module = (SELECT s.registered_by_module FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT store_id FROM clone_targets_0137)
  AND EXISTS (SELECT 1 FROM transaction_categories s WHERE s.store_id = 'store_mandala' AND s.code = transaction_categories.code);

INSERT INTO transaction_categories (
  id, store_id, code, name, involves_payment, involves_item_category,
  is_active, description, registered_by_module, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_txcat_' || s.code,
  t.store_id, s.code, s.name, s.involves_payment, s.involves_item_category,
  s.is_active, s.description, s.registered_by_module, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN transaction_categories s
WHERE s.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM transaction_categories x WHERE x.store_id = t.store_id AND x.code = s.code);

DELETE FROM item_categories WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

INSERT INTO item_categories (
  id, store_id, product_kind_id, name,
  inventory_account_id, cogs_account_id, revenue_account_id,
  is_active, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_itemcat_' || sc.id,
  t.store_id,
  tk.id,
  sc.name,
  tai.id,
  tac.id,
  tar.id,
  sc.is_active,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN item_categories sc
JOIN product_kinds sk ON sk.id = sc.product_kind_id AND sk.store_id = 'store_mandala'
JOIN product_kinds tk ON tk.store_id = t.store_id AND tk.code = sk.code
JOIN chart_of_accounts sai ON sai.id = sc.inventory_account_id AND sai.store_id = 'store_mandala'
JOIN chart_of_accounts tai ON tai.store_id = t.store_id AND tai.code = sai.code
JOIN chart_of_accounts sac ON sac.id = sc.cogs_account_id AND sac.store_id = 'store_mandala'
JOIN chart_of_accounts tac ON tac.store_id = t.store_id AND tac.code = sac.code
LEFT JOIN chart_of_accounts sar ON sar.id = sc.revenue_account_id AND sar.store_id = 'store_mandala'
LEFT JOIN chart_of_accounts tar ON tar.store_id = t.store_id AND tar.code = sar.code
WHERE sc.store_id = 'store_mandala';

DELETE FROM accounting_choice_options
WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM accounting_choice_groups
WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

CREATE TABLE clone_choice_group_map_0137 (
  target_store_id TEXT NOT NULL,
  source_group_id TEXT NOT NULL,
  new_group_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_group_id)
);

INSERT INTO clone_choice_group_map_0137 (target_store_id, source_group_id, new_group_id)
SELECT t.store_id, g.id, 'clone0137_' || t.store_id || '_choice_' || g.code
FROM clone_targets_0137 t
CROSS JOIN accounting_choice_groups g
WHERE g.store_id = 'store_mandala';

INSERT INTO accounting_choice_groups (
  id, store_id, entity_id, code, name, is_active, created_at, updated_at
)
SELECT
  m.new_group_id,
  m.target_store_id,
  CASE WHEN g.entity_id IS NULL THEN NULL ELSE (SELECT entity_id FROM stores WHERE id = m.target_store_id) END,
  g.code, g.name, g.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_choice_group_map_0137 m
JOIN accounting_choice_groups g ON g.id = m.source_group_id AND g.store_id = 'store_mandala';

INSERT INTO accounting_choice_options (
  id, choice_group_id, store_id, code, name, account_id,
  is_default, sort_order, is_active, created_at, updated_at
)
SELECT
  'clone0137_' || gm.target_store_id || '_choiceopt_' || o.id,
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
FROM clone_choice_group_map_0137 gm
JOIN accounting_choice_options o ON o.choice_group_id = gm.source_group_id AND o.store_id = 'store_mandala'
LEFT JOIN chart_of_accounts sa ON sa.id = o.account_id AND sa.store_id = 'store_mandala'
LEFT JOIN chart_of_accounts ta ON ta.store_id = gm.target_store_id AND ta.code = sa.code;

DELETE FROM journal_rules WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

INSERT INTO journal_rules (
  id, store_id, transaction_category_id, label, side, source_type,
  fixed_account_id, choice_group_id, is_active, sort_order, is_default,
  created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_jrule_' || r.id,
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
FROM clone_targets_0137 t
CROSS JOIN journal_rules r
JOIN transaction_categories stc ON stc.id = r.transaction_category_id AND stc.store_id = 'store_mandala'
JOIN transaction_categories ttc ON ttc.store_id = t.store_id AND ttc.code = stc.code
LEFT JOIN chart_of_accounts sa ON sa.id = r.fixed_account_id AND sa.store_id = 'store_mandala'
LEFT JOIN chart_of_accounts ta ON ta.store_id = t.store_id AND ta.code = sa.code
LEFT JOIN accounting_choice_groups scg ON scg.id = r.choice_group_id AND scg.store_id = 'store_mandala'
LEFT JOIN accounting_choice_groups tcg ON tcg.store_id = t.store_id AND tcg.code = scg.code
WHERE r.store_id = 'store_mandala';

-- Warehouse configuration. Principal access is deliberately not inherited.
DELETE FROM warehouse_access WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM warehouse_stock_opname_settings WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
DELETE FROM warehouses WHERE store_id IN (SELECT store_id FROM clone_targets_0137);

CREATE TABLE clone_warehouse_map_0137 (
  target_store_id TEXT NOT NULL,
  source_warehouse_id TEXT NOT NULL,
  new_warehouse_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_warehouse_id)
);

INSERT INTO clone_warehouse_map_0137 (target_store_id, source_warehouse_id, new_warehouse_id)
SELECT t.store_id, w.id, 'clone0137_' || t.store_id || '_warehouse_' || w.code
FROM clone_targets_0137 t
CROSS JOIN warehouses w
WHERE w.store_id = 'store_mandala';

INSERT INTO warehouses (
  id, store_id, code, name, location_name, is_active, created_at, updated_at
)
SELECT
  m.new_warehouse_id, m.target_store_id, w.code, w.name, w.location_name,
  w.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_warehouse_map_0137 m
JOIN warehouses w ON w.id = m.source_warehouse_id AND w.store_id = 'store_mandala';

INSERT INTO warehouse_stock_opname_settings (
  warehouse_id, store_id, quantity_tolerance, percentage_tolerance_bps,
  schedule_type, schedule_day, requires_approval, updated_at
)
SELECT
  wm.new_warehouse_id, wm.target_store_id,
  s.quantity_tolerance, s.percentage_tolerance_bps,
  s.schedule_type, s.schedule_day, s.requires_approval, CURRENT_TIMESTAMP
FROM clone_warehouse_map_0137 wm
JOIN warehouse_stock_opname_settings s
  ON s.warehouse_id = wm.source_warehouse_id AND s.store_id = 'store_mandala';

-- Other safe store-scoped configuration/master data.
INSERT INTO cost_types (
  id, store_id, code, name, accounting_component_rule_id, is_active, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_costtype_' || c.id,
  t.store_id, c.code, c.name,
  NULL,
  c.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN cost_types c
WHERE c.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM cost_types x WHERE x.store_id = t.store_id AND x.code = c.code);

INSERT INTO cost_masters (
  id, store_id, name, contact, outgoing_amount, incoming_amount,
  cost_type_id, cost_group, is_active, created_at, updated_at
)
SELECT
  'clone0137_' || t.store_id || '_costmaster_' || c.id,
  t.store_id, c.name, c.contact, c.outgoing_amount, c.incoming_amount,
  tc.id, c.cost_group, c.is_active, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN cost_masters c
JOIN cost_types sct ON sct.id = c.cost_type_id AND sct.store_id = 'store_mandala'
JOIN cost_types tc ON tc.store_id = t.store_id AND tc.code = sct.code
WHERE c.store_id = 'store_mandala'
  AND NOT EXISTS (SELECT 1 FROM cost_masters x WHERE x.store_id = t.store_id AND x.name = c.name);

DELETE FROM store_approval_settings WHERE store_id IN (SELECT store_id FROM clone_targets_0137);
INSERT INTO store_approval_settings (
  store_id, auto_permit_enabled, enabled_by_role, enabled_by_id,
  enabled_at, updated_at
)
SELECT
  t.store_id,
  s.auto_permit_enabled,
  CASE WHEN s.auto_permit_enabled = 1 THEN 'ENTITY_ADMIN' ELSE NULL END,
  CASE WHEN s.auto_permit_enabled = 1 THEN 'entity_admin_boscyo_kpm' ELSE NULL END,
  CASE WHEN s.auto_permit_enabled = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
  CURRENT_TIMESTAMP
FROM clone_targets_0137 t
CROSS JOIN store_approval_settings s
WHERE s.store_id = 'store_mandala';

-- Promotion configuration. Runtime distribution/redemption/spin facts reset.
CREATE TABLE clone_voucher_master_map_0137 (
  target_store_id TEXT NOT NULL,
  source_voucher_master_id TEXT NOT NULL,
  new_voucher_master_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_voucher_master_id)
);

INSERT INTO clone_voucher_master_map_0137 (
  target_store_id, source_voucher_master_id, new_voucher_master_id
)
SELECT
  t.store_id,
  v.id,
  'clone0137_' || t.store_id || '_voucher_' || v.id
FROM clone_targets_0137 t
CROSS JOIN voucher_masters v
WHERE v.store_id = 'store_mandala'
  AND (
    v.is_active = 1
    OR EXISTS (
      SELECT 1
      FROM roda_puter_rewards rr
      JOIN roda_puter_campaigns rc ON rc.id = rr.campaign_id
      WHERE rc.store_id = 'store_mandala' AND rc.is_active = 1
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
  'entity_admin_boscyo_kpm',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM clone_voucher_master_map_0137 m
JOIN voucher_masters v ON v.id = m.source_voucher_master_id AND v.store_id = 'store_mandala';

INSERT INTO voucher_master_products (
  voucher_master_id, store_id, product_id, sort_order, created_at
)
SELECT
  vm.new_voucher_master_id,
  vm.target_store_id,
  pm.new_product_id,
  vp.sort_order,
  CURRENT_TIMESTAMP
FROM clone_voucher_master_map_0137 vm
JOIN voucher_master_products vp
  ON vp.voucher_master_id = vm.source_voucher_master_id AND vp.store_id = 'store_mandala'
JOIN clone_product_map_0137 pm
  ON pm.target_store_id = vm.target_store_id AND pm.source_product_id = vp.product_id;

CREATE TABLE clone_roda_campaign_map_0137 (
  target_store_id TEXT NOT NULL,
  source_campaign_id TEXT NOT NULL,
  new_campaign_id TEXT NOT NULL UNIQUE,
  PRIMARY KEY (target_store_id, source_campaign_id)
);

INSERT INTO clone_roda_campaign_map_0137 (target_store_id, source_campaign_id, new_campaign_id)
SELECT
  t.store_id, c.id, 'clone0137_' || t.store_id || '_roda_' || c.id
FROM clone_targets_0137 t
CROSS JOIN roda_puter_campaigns c
WHERE c.store_id = 'store_mandala' AND c.is_active = 1;

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
  'entity_admin_boscyo_kpm',
  CURRENT_TIMESTAMP
FROM clone_roda_campaign_map_0137 cm
JOIN roda_puter_campaigns c ON c.id = cm.source_campaign_id AND c.store_id = 'store_mandala';

INSERT INTO roda_puter_rewards (
  id, campaign_id, store_id, voucher_master_id, product_id,
  product_name_snapshot, weight_basis_points, sort_order, created_at
)
SELECT
  'clone0137_' || cm.target_store_id || '_reward_' || r.id,
  cm.new_campaign_id,
  cm.target_store_id,
  vm.new_voucher_master_id,
  pm.new_product_id,
  tp.name,
  r.weight_basis_points,
  r.sort_order,
  CURRENT_TIMESTAMP
FROM clone_roda_campaign_map_0137 cm
JOIN roda_puter_rewards r
  ON r.campaign_id = cm.source_campaign_id AND r.store_id = 'store_mandala'
JOIN clone_voucher_master_map_0137 vm
  ON vm.target_store_id = cm.target_store_id AND vm.source_voucher_master_id = r.voucher_master_id
JOIN clone_product_map_0137 pm
  ON pm.target_store_id = cm.target_store_id AND pm.source_product_id = r.product_id
JOIN products tp ON tp.id = pm.new_product_id AND tp.store_id = cm.target_store_id;

-- Fail-closed postconditions. Do not accept a partial batch or leaked history.
CREATE TABLE clone_result_guard_0137 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO clone_result_guard_0137 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM stores s JOIN clone_targets_0137 t ON t.store_id = s.id) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM stores s
    JOIN clone_targets_0137 t ON t.store_id = s.id
    WHERE s.entity_id IS NOT (SELECT entity_id FROM stores WHERE id = 'store_mandala')
       OR s.edition IS NOT (SELECT edition FROM stores WHERE id = 'store_mandala')
       OR s.warehouse_enabled IS NOT (SELECT warehouse_enabled FROM stores WHERE id = 'store_mandala')
  )
  AND NOT EXISTS (
    SELECT 1 FROM clone_targets_0137 t
    WHERE (SELECT COUNT(*) FROM products p WHERE p.store_id = t.store_id)
       <> (SELECT COUNT(*) FROM products p WHERE p.store_id = 'store_mandala')
  )
  AND NOT EXISTS (
    SELECT 1 FROM clone_targets_0137 t
    WHERE (SELECT COUNT(*) FROM manufacturing_recipes r WHERE r.store_id = t.store_id AND r.status = 'ACTIVE')
       <> (SELECT COUNT(*) FROM manufacturing_recipes r WHERE r.store_id = 'store_mandala' AND r.status = 'ACTIVE')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM clone_targets_0137 t
    JOIN chart_of_accounts source_account ON source_account.store_id = 'store_mandala'
    WHERE NOT EXISTS (
      SELECT 1 FROM chart_of_accounts target_account
      WHERE target_account.store_id = t.store_id
        AND target_account.code = source_account.code
    )
  )
  AND (SELECT COUNT(*) FROM customers WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM cashiers WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM cash_drawer_sessions WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM orders WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM sales WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM purchases WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM expenses WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM other_income WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM stock_movements WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM inventory_stock_balances WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM production_runs WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM accounting_journal_headers WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM approval_requests WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM voucher_instances WHERE distributed_store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM voucher_redemptions WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND (SELECT COUNT(*) FROM roda_puter_official_spins WHERE store_id IN (SELECT store_id FROM clone_targets_0137)) = 0
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.store_id IN (SELECT store_id FROM clone_targets_0137)
      AND (p.average_cost <> 0 OR p.last_purchase_price <> 0 OR p.cost_updated_at IS NOT NULL OR p.last_purchase_at IS NOT NULL)
  )
THEN 1 ELSE 0 END;
DROP TABLE clone_result_guard_0137;

DROP TABLE clone_roda_campaign_map_0137;
DROP TABLE clone_voucher_master_map_0137;
DROP TABLE clone_warehouse_map_0137;
DROP TABLE clone_choice_group_map_0137;
DROP TABLE clone_product_group_map_0137;
DROP TABLE clone_recipe_map_0137;
DROP TABLE clone_product_map_0137;
DROP TABLE clone_targets_0137;
