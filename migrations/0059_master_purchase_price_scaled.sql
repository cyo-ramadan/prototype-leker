PRAGMA foreign_keys = ON;

-- Master Barang's `purchase_price` was whole-rupiah only, so a sub-rupiah unit
-- price (e.g. air mineral dibeli per ml, Rp8.000 / 16.000ml = Rp0,5/ml) could
-- never be entered -- it silently rounded to 0 or 1. `average_cost` and
-- `last_purchase_price` in this same table already use the exact-unit-cost
-- scale (1 rupiah = 1.000.000 unit, see migration 0019); rescale
-- `purchase_price` to match so all three columns share one convention and no
-- float/REAL is needed to express fractional rupiah.
--
-- Existing values are whole rupiah today, so the conversion is exact
-- (multiply by scale, no rounding loss).
UPDATE products
SET purchase_price = purchase_price * 1000000
WHERE purchase_price IS NOT NULL;
