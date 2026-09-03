PRAGMA foreign_keys = ON;

-- Harga Jual (products.price) was whole-rupiah only, same limitation
-- purchase_price had before migration 0059. Rescale to the same
-- exact-unit-cost scale (1 rupiah = 1.000.000 unit) so barang yang dijual
-- per satuan sangat kecil (mis. per gram) can carry a sub-rupiah catalog
-- price without float/REAL as source of truth.
--
-- Existing values are whole rupiah today, so the conversion is exact
-- (multiply by scale, no rounding loss). Actual transaction totals
-- (sale_items.line_total, order_items.line_total) stay whole-rupiah
-- INTEGER as before -- only the catalog reference price gains precision.
UPDATE products
SET price = price * 1000000
WHERE price IS NOT NULL;
