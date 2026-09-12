PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-09-12: add one-level category hierarchy and regroup Dermo Leker
-- into customer-facing subcategories under parent category "Leker".
-- Mapping decision:
--   Rp1.500 + Rp2.000 -> 2K
--   Rp3.000           -> 3K
--   Rp4.000           -> 4K
--   Rp5.000           -> 5K
--   Above Rp5.000     -> Special
--
-- Existing flat categories remain valid with parent_category_id = NULL.
-- The parent column stays nullable and unconstrained at ALTER time for D1-safe
-- additive migration; triggers below enforce same-store parent integrity and
-- prevent referenced parents from being deleted or moved.
-- No stock, costing, journal, sale, purchase, or recipe facts are changed.
-- DOC-IMPACT: REQUIRED — categories gain explicit parent-child hierarchy metadata.

ALTER TABLE categories
  ADD COLUMN parent_category_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_categories_store_parent_active_order
  ON categories(store_id, parent_category_id, is_active, display_order, id);

CREATE TRIGGER IF NOT EXISTS trg_categories_parent_scope_insert
BEFORE INSERT ON categories
WHEN NEW.parent_category_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.id IS NOT NULL AND NEW.parent_category_id = NEW.id
      THEN RAISE(ABORT, 'category cannot parent itself')
    WHEN NOT EXISTS (
      SELECT 1
      FROM categories parent
      WHERE parent.id = NEW.parent_category_id
        AND parent.store_id = NEW.store_id
    )
      THEN RAISE(ABORT, 'category parent must belong to same store')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_parent_scope_update
BEFORE UPDATE OF parent_category_id, store_id ON categories
WHEN NEW.parent_category_id IS NOT NULL
BEGIN
  SELECT CASE
    WHEN NEW.parent_category_id = NEW.id
      THEN RAISE(ABORT, 'category cannot parent itself')
    WHEN NOT EXISTS (
      SELECT 1
      FROM categories parent
      WHERE parent.id = NEW.parent_category_id
        AND parent.store_id = NEW.store_id
    )
      THEN RAISE(ABORT, 'category parent must belong to same store')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_parent_delete_guard
BEFORE DELETE ON categories
WHEN EXISTS (
  SELECT 1
  FROM categories child
  WHERE child.parent_category_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'category parent still has children');
END;

CREATE TRIGGER IF NOT EXISTS trg_categories_parent_identity_guard
BEFORE UPDATE OF id, store_id ON categories
WHEN (NEW.id <> OLD.id OR NEW.store_id <> OLD.store_id)
  AND EXISTS (
    SELECT 1
    FROM categories child
    WHERE child.parent_category_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'category parent with children cannot change identity or store');
END;

CREATE TABLE dermo_leker_subcategory_guard_0085 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO dermo_leker_subcategory_guard_0085 (ok)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo') THEN 1
  WHEN (
    SELECT COUNT(*)
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
  ) <> 73 THEN 0
  WHEN EXISTS (
    SELECT 1
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
      AND p.price NOT IN (
        1500000000, 2000000000, 3000000000, 4000000000, 5000000000,
        8000000000, 10000000000, 15000000000, 20000000000,
        25000000000, 40000000000
      )
  ) THEN 0
  WHEN EXISTS (
    SELECT 1
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND p.category IN ('2K', '3K', '4K', '5K', 'Special')
      AND NOT EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
  ) THEN 0
  ELSE 1
END;

DROP TABLE dermo_leker_subcategory_guard_0085;

INSERT OR IGNORE INTO categories (
  store_id, name, display_order, is_active, parent_category_id
)
SELECT 'store_dermo', 'Leker', 0, 1, NULL
WHERE EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo');

UPDATE categories
SET parent_category_id = NULL,
    is_active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND name = 'Leker';

INSERT OR IGNORE INTO categories (
  store_id, name, display_order, is_active, parent_category_id
)
SELECT 'store_dermo', child.name, child.display_order, 1, parent.id
FROM categories parent
JOIN (
  SELECT '2K' AS name, 1 AS display_order
  UNION ALL SELECT '3K', 2
  UNION ALL SELECT '4K', 3
  UNION ALL SELECT '5K', 4
  UNION ALL SELECT 'Special', 5
) child
WHERE parent.store_id = 'store_dermo'
  AND parent.name = 'Leker';

UPDATE categories
SET parent_category_id = (
      SELECT parent.id
      FROM categories parent
      WHERE parent.store_id = 'store_dermo'
        AND parent.name = 'Leker'
    ),
    display_order = CASE name
      WHEN '2K' THEN 1
      WHEN '3K' THEN 2
      WHEN '4K' THEN 3
      WHEN '5K' THEN 4
      WHEN 'Special' THEN 5
      ELSE display_order
    END,
    is_active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND name IN ('2K', '3K', '4K', '5K', 'Special');

UPDATE products
SET category = CASE
      WHEN price IN (1500000000, 2000000000) THEN '2K'
      WHEN price = 3000000000 THEN '3K'
      WHEN price = 4000000000 THEN '4K'
      WHEN price = 5000000000 THEN '5K'
      ELSE 'Special'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.store_id = products.store_id
      AND r.output_product_id = products.id
      AND r.id LIKE 'dermo_leker_recipe_%'
      AND r.created_by_id = 'migration_0083'
  );

UPDATE categories
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND name IN (
    'leker1500', 'leker2000', 'leker3000', 'leker4000', 'leker5000',
    'leker8000', 'leker10000', 'leker15000', 'leker20000',
    'leker25000', 'leker40000'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.store_id = categories.store_id
      AND p.category = categories.name
  );

CREATE TABLE dermo_leker_subcategory_verify_0085 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO dermo_leker_subcategory_verify_0085 (ok)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo') THEN 1
  WHEN NOT EXISTS (
    SELECT 1
    FROM categories parent
    WHERE parent.store_id = 'store_dermo'
      AND parent.name = 'Leker'
      AND parent.parent_category_id IS NULL
      AND parent.is_active = 1
  ) THEN 0
  WHEN (
    SELECT COUNT(*)
    FROM categories child
    JOIN categories parent ON parent.id = child.parent_category_id
    WHERE child.store_id = 'store_dermo'
      AND parent.store_id = child.store_id
      AND parent.name = 'Leker'
      AND child.name IN ('2K', '3K', '4K', '5K', 'Special')
      AND child.is_active = 1
  ) <> 5 THEN 0
  WHEN (
    SELECT COUNT(*)
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = p.store_id
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
      AND (
        (p.price IN (1500000000, 2000000000) AND p.category <> '2K')
        OR (p.price = 3000000000 AND p.category <> '3K')
        OR (p.price = 4000000000 AND p.category <> '4K')
        OR (p.price = 5000000000 AND p.category <> '5K')
        OR (p.price > 5000000000 AND p.category <> 'Special')
      )
  ) <> 0 THEN 0
  ELSE 1
END;

DROP TABLE dermo_leker_subcategory_verify_0085;
