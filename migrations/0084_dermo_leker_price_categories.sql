PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-09-12: split Dermo Leker menu categories by selling-price bucket.
-- Example: Rp2.000 => leker2000, Rp3.000 => leker3000.
-- Scope is restricted to the 73 products provisioned by migration 0083.
-- No prices, recipes, stock, transactions, journal, HPP, or other stores are changed.
-- DOC-IMPACT: NOT_REQUIRED — store-scoped master category classification only.

CREATE TABLE dermo_leker_category_guard_0084 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO dermo_leker_category_guard_0084 (ok)
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM stores WHERE id = 'store_dermo'
  ) THEN 1
  WHEN (
    SELECT COUNT(*)
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = 'store_dermo'
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
  ) = 73
  AND NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = 'store_dermo'
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
      AND (
        p.price <= 0
        OR p.price % 1000000 <> 0
        OR p.price <> p.purchase_price
      )
  )
  THEN 1
  ELSE 0
END;

DROP TABLE dermo_leker_category_guard_0084;

INSERT INTO categories (
  store_id, name, display_order, is_active, created_at, updated_at
)
SELECT
  'store_dermo',
  'leker' || CAST(p.price / 1000000 AS INTEGER),
  CAST(p.price / 1000000 AS INTEGER),
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM products p
WHERE p.store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.store_id = 'store_dermo'
      AND r.output_product_id = p.id
      AND r.id LIKE 'dermo_leker_recipe_%'
      AND r.created_by_id = 'migration_0083'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM categories c
    WHERE c.store_id = 'store_dermo'
      AND c.name = 'leker' || CAST(p.price / 1000000 AS INTEGER)
  )
GROUP BY p.price;

UPDATE categories
SET
  display_order = CAST(SUBSTR(name, 6) AS INTEGER),
  is_active = 1,
  updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND name IN (
    SELECT DISTINCT 'leker' || CAST(p.price / 1000000 AS INTEGER)
    FROM products p
    WHERE p.store_id = 'store_dermo'
      AND EXISTS (
        SELECT 1
        FROM manufacturing_recipes r
        WHERE r.store_id = 'store_dermo'
          AND r.output_product_id = p.id
          AND r.id LIKE 'dermo_leker_recipe_%'
          AND r.created_by_id = 'migration_0083'
      )
  );

UPDATE products
SET
  category = 'leker' || CAST(price / 1000000 AS INTEGER),
  updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.store_id = 'store_dermo'
      AND r.output_product_id = products.id
      AND r.id LIKE 'dermo_leker_recipe_%'
      AND r.created_by_id = 'migration_0083'
  );

CREATE TABLE dermo_leker_category_verify_0084 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);

INSERT INTO dermo_leker_category_verify_0084 (ok)
SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM stores WHERE id = 'store_dermo')
  OR (
    (
      SELECT COUNT(*)
      FROM products p
      WHERE p.store_id = 'store_dermo'
        AND EXISTS (
          SELECT 1
          FROM manufacturing_recipes r
          WHERE r.store_id = 'store_dermo'
            AND r.output_product_id = p.id
            AND r.id LIKE 'dermo_leker_recipe_%'
            AND r.created_by_id = 'migration_0083'
        )
        AND p.category = 'leker' || CAST(p.price / 1000000 AS INTEGER)
    ) = 73
    AND (
      SELECT COUNT(DISTINCT p.category)
      FROM products p
      WHERE p.store_id = 'store_dermo'
        AND EXISTS (
          SELECT 1
          FROM manufacturing_recipes r
          WHERE r.store_id = 'store_dermo'
            AND r.output_product_id = p.id
            AND r.id LIKE 'dermo_leker_recipe_%'
            AND r.created_by_id = 'migration_0083'
        )
    ) = 11
    AND NOT EXISTS (
      SELECT 1
      FROM products p
      WHERE p.store_id = 'store_dermo'
        AND EXISTS (
          SELECT 1
          FROM manufacturing_recipes r
          WHERE r.store_id = 'store_dermo'
            AND r.output_product_id = p.id
            AND r.id LIKE 'dermo_leker_recipe_%'
            AND r.created_by_id = 'migration_0083'
        )
        AND p.category NOT IN (
          'leker1500',
          'leker2000',
          'leker3000',
          'leker4000',
          'leker5000',
          'leker8000',
          'leker10000',
          'leker15000',
          'leker20000',
          'leker25000',
          'leker40000'
        )
    )
  )
THEN 1 ELSE 0 END;

DROP TABLE dermo_leker_category_verify_0084;
