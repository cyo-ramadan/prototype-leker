PRAGMA foreign_keys = ON;

-- BOS_CYO 2026-09-13: make the visual already shown for Dermo Leker a
-- Product Master-owned reference so menu/game surfaces can use one source.
--
-- image_data remains the first-choice custom/uploaded image. image_visual_key
-- is a storage-agnostic built-in visual reference used only when image_data is
-- blank. No remote asset provider is introduced by this migration.
--
-- DOC-IMPACT: REQUIRED — Product Master Contract v5 documents the canonical
-- image_data -> image_visual_key precedence and public menu read model.

ALTER TABLE products ADD COLUMN image_visual_key TEXT;

-- Freeze the exact 73-item Dermo onboarding scope from migration 0083. Do not
-- infer membership from current recipe IDs because a same-name Pendem clone may
-- already have had an ACTIVE recipe before the Dermo recipe alignment ran.
CREATE TABLE dermo_leker_visual_source_0086 (
  product_name TEXT PRIMARY KEY
);

INSERT INTO dermo_leker_visual_source_0086 (product_name) VALUES
  ('Leker Susu Coklat'),
  ('Leker Susu Vanila'),
  ('Leker Meses'),
  ('Leker Keju'),
  ('Leker Blueberry'),
  ('Leker Strawberry'),
  ('Leker Blue Band'),
  ('Leker Blueberry + Meses'),
  ('Leker Gula Aren'),
  ('Leker Oreo'),
  ('Leker Blueberry + Gula'),
  ('Leker Choco Chips'),
  ('Leker Strawberry + Meses'),
  ('Leker Strawberry + Gula'),
  ('Leker Green Tea'),
  ('Leker BlueBand + Keju'),
  ('Leker Cappucino'),
  ('Leker BlueBand + Meses'),
  ('Leker Marsmellow'),
  ('Leker Tiramisu'),
  ('Leker Keju + Susu'),
  ('Leker Pisang'),
  ('Leker Oreo + Keju'),
  ('Leker Choco Crunch'),
  ('Leker Meses + Keju'),
  ('Leker Chocomaltine'),
  ('Leker Beng Beng'),
  ('Leker Kacang + Keju'),
  ('Leker Tiramisu + Keju'),
  ('Leker Ovomaltine'),
  ('Leker Nutella'),
  ('Leker Greentea + Keju'),
  ('Leker Mozarella'),
  ('Leker Blueberry + Keju'),
  ('Leker Telor'),
  ('Leker Strawberry + Keju'),
  ('Leker Kornet Sapi'),
  ('Leker Oreo + Choco Chips'),
  ('Leker Nutella + Keju'),
  ('Leker Kacang + Meses'),
  ('Leker Nutella + Pisang'),
  ('Leker Ovomaltine + Keju'),
  ('Leker Ovomaltine + Pisang'),
  ('Leker Chocomaltine + Pisang + Keju'),
  ('Leker Choco Crunch + Pisang + Keju'),
  ('Leker Chocomaltine + Kacang + Keju'),
  ('Leker Chocomaltine + Oreo'),
  ('Leker Chocomaltine + Pisang'),
  ('Leker Chocomaltine + Keju'),
  ('Leker Chocomaltine + Kacang'),
  ('Leker Choco Crunch + Oreo'),
  ('Leker Choco Crunch + Pisang'),
  ('Leker Choco Crunch + Keju'),
  ('Leker Choco Crunch + Kacang'),
  ('Leker Pisang + Meses + Keju'),
  ('Leker Pisang + Oreo + Keju'),
  ('Leker Greentea + Oreo + Keju'),
  ('Leker Choco Chips Oreo + Keju'),
  ('Leker Pisang + Keju'),
  ('Leker Pisang + Meses'),
  ('Leker Pisang + Kacang'),
  ('Leker Pisang + Oreo'),
  ('Leker Pisang + Choco Chips'),
  ('Leker Pisang + Greentea'),
  ('Leker Nuttela + Mozarella'),
  ('Leker Ovomaltine Mozarella'),
  ('Leker Telor + Kornet'),
  ('Leker Kornet + Mozarella'),
  ('Leker Telor + Mozarella'),
  ('Leker Telor + Kornet + Mozarella'),
  ('Leker Ovomaltine + Kacang + Keju'),
  ('Leker Mozarella + Pisang'),
  ('Leker Original');

-- Dermo was cloned from Pendem before the dedicated Leker catalog was aligned.
-- Preserve any real image already present on Dermo. If a same-name Pendem
-- product has a curated image and Dermo is blank, copy that image into the
-- Dermo Product Master rather than keeping a browser-only copy.
UPDATE products AS d
SET
  image_data = (
    SELECT p.image_data
    FROM products p
    WHERE p.store_id = 'store_pendem'
      AND LOWER(TRIM(p.name)) = LOWER(TRIM(d.name))
      AND COALESCE(TRIM(p.image_data), '') <> ''
    ORDER BY p.id
    LIMIT 1
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE d.store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1 FROM dermo_leker_visual_source_0086 s
    WHERE s.product_name = d.name
  )
  AND COALESCE(TRIM(d.image_data), '') = ''
  AND EXISTS (
    SELECT 1
    FROM products p
    WHERE p.store_id = 'store_pendem'
      AND LOWER(TRIM(p.name)) = LOWER(TRIM(d.name))
      AND COALESCE(TRIM(p.image_data), '') <> ''
  );

-- The built-in visual key snapshots the exact visual identity used by the
-- customer menu. A real image_data remains higher priority at render time.
UPDATE products
SET
  image_visual_key = 'LEKER_V1:' || name,
  updated_at = CURRENT_TIMESTAMP
WHERE store_id = 'store_dermo'
  AND EXISTS (
    SELECT 1 FROM dermo_leker_visual_source_0086 s
    WHERE s.product_name = products.name
  )
  AND COALESCE(TRIM(image_visual_key), '') = '';

-- Fail closed unless all 73 canonical Dermo items exist and every row now has
-- a Product Master visual source.
CREATE TABLE dermo_master_visual_verify_0086 (ok INTEGER NOT NULL CHECK (ok = 1));
INSERT INTO dermo_master_visual_verify_0086 (ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM dermo_leker_visual_source_0086) = 73
  AND (
    SELECT COUNT(*)
    FROM dermo_leker_visual_source_0086 s
    JOIN products p
      ON p.store_id = 'store_dermo' AND p.name = s.product_name
  ) = 73
  AND NOT EXISTS (
    SELECT 1
    FROM dermo_leker_visual_source_0086 s
    JOIN products p
      ON p.store_id = 'store_dermo' AND p.name = s.product_name
    WHERE COALESCE(TRIM(p.image_data), '') = ''
      AND COALESCE(TRIM(p.image_visual_key), '') = ''
  )
THEN 1 ELSE 0 END;
DROP TABLE dermo_master_visual_verify_0086;
DROP TABLE dermo_leker_visual_source_0086;
