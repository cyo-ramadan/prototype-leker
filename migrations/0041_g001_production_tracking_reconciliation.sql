PRAGMA foreign_keys = ON;

-- G001 production tracking reconciliation.
--
-- Migration 0017 intentionally disabled stock tracking for all products that
-- already existed at the time because reliable opening-stock history did not yet
-- exist. Production V2 now requires stock tracking for both active Recipe/BOM
-- outputs and consumable components. This migration restores only the tracking
-- flag needed by G001's already-configured active production definitions.
--
-- It does NOT invent stock quantities, change Recipe/BOM contents, change Item
-- Type permissions, change HPP/costing, or write any Accounting fact/journal.
-- Missing/insufficient material stock continues to fail closed and must be fixed
-- through the canonical stock-adjustment flow.

-- 1. Active recipe outputs that are already permitted by their Item Type to be
-- produced and stock-tracked become tracked products.
UPDATE products
SET stock_tracking_enabled = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = (SELECT id FROM stores WHERE code = 'G001' LIMIT 1)
  AND is_active = 1
  AND stock_tracking_enabled = 0
  AND EXISTS (
    SELECT 1
    FROM manufacturing_recipes r
    WHERE r.store_id = products.store_id
      AND r.output_product_id = products.id
      AND r.status = 'ACTIVE'
  )
  AND COALESCE((
    SELECT t.track_stock
    FROM item_types t
    WHERE t.id = products.item_type_id AND t.store_id = products.store_id
    LIMIT 1
  ), 1) = 1
  AND COALESCE((
    SELECT t.can_produce
    FROM item_types t
    WHERE t.id = products.item_type_id AND t.store_id = products.store_id
    LIMIT 1
  ), 1) = 1;

-- 2. Components referenced by an active G001 recipe become tracked only when
-- their existing Item Type already permits stock tracking and consumption.
UPDATE products
SET stock_tracking_enabled = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE store_id = (SELECT id FROM stores WHERE code = 'G001' LIMIT 1)
  AND is_active = 1
  AND stock_tracking_enabled = 0
  AND EXISTS (
    SELECT 1
    FROM manufacturing_recipe_components c
    JOIN manufacturing_recipes r
      ON r.id = c.recipe_id
     AND r.store_id = c.store_id
     AND r.status = 'ACTIVE'
    WHERE c.store_id = products.store_id
      AND c.component_product_id = products.id
  )
  AND COALESCE((
    SELECT t.track_stock
    FROM item_types t
    WHERE t.id = products.item_type_id AND t.store_id = products.store_id
    LIMIT 1
  ), 1) = 1
  AND COALESCE((
    SELECT t.can_consume
    FROM item_types t
    WHERE t.id = products.item_type_id AND t.store_id = products.store_id
    LIMIT 1
  ), 1) = 1;
