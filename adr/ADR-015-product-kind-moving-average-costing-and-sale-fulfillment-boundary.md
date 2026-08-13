# ADR-015 — Product Kind, Moving Average Costing, and Sale Fulfillment Boundary

Status: ACCEPTED
Date: 2026-08-13
Supersedes in part: ADR-013 and ADR-014 where they assign Product Master ownership of `production_mode` or describe costing as undefined.

## Context

Master Barang needs a classification that can later drive Accounting rules, while HPP must become operationally usable rather than remain a nullable placeholder.

The existing purchase fact stored only a free-text description and total amount. That shape could not reliably update stock, latest purchase price, or running HPP per product.

The existing Product Master also exposed `STOCK` / `DADAKAN` as a product-level setting. The business decision is to move fulfillment choice to the Sale domain later, with DADAKAN as the future default, without silently changing current sale behavior in this revision.

The broader MAXI direction also requires deterministic financial/inventory calculations. SQLite `REAL` is therefore unsuitable as the authoritative representation for new HPP and unit-cost writes.

## Decision

1. Add `product_kinds` as a separate user-defined store-scoped classification master with stable codes.
2. Add nullable `products.product_kind_id`; do not seed business-specific kinds automatically.
3. Remove Mode Pemenuhan from Product Master UI and Product Master write APIs.
4. Keep legacy `products.production_mode` temporarily for runtime backward compatibility only. A future Sale contract will replace it and define transaction-level fulfillment/default behavior.
5. Make inventory purchases itemized by database-backed product, explicit base-unit quantity, and exact line total.
6. Purchase posting atomically updates stock, creates movement/item snapshots, updates `last_purchase_price`, and updates `average_cost` with moving weighted average.
7. Treat `products.average_cost` as the current operational HPP source.
8. Store new authoritative unit-cost/HPP values as exact scaled INTEGER using `1,000,000` cost units per rupiah; do not use new `REAL/FLOAT` costing writes.
9. Snapshot scaled average cost into sale-item COGS and production component costs so later master changes cannot rewrite history.
10. Compute production HPP from exact component cost snapshots and fold produced output cost into the output product's moving average.
11. Add explicit quantity to operational expense as customer-behaviour metadata; it does not move inventory.
12. Keep Accounting journal generation outside Prototype Leker. Product Kind and cost snapshots are operational facts/reference data for future Accounting integration.
13. Keep the current integer stock engine temporarily; migrate inventory quantity to the approved fractional-capable canonical representation under a dedicated compatibility change rather than introduce dual quantity sources here.

## Formula

For a purchased product with positive existing stock:

`new_average_cost_scaled = rounded((old_stock × old_average_cost_scaled + purchase_line_total × COST_SCALE) / (old_stock + purchase_quantity))`

When existing stock is zero or less:

`new_average_cost_scaled = rounded(purchase_line_total × COST_SCALE / purchase_quantity)`

Production output uses the same moving-average principle, replacing purchase line total with exact scaled production-run HPP and purchase quantity with produced quantity.

## Consequences

- Harga Beli Terakhir and Average Cost are read-only in Master Barang.
- Existing purchases must use item lines selected from the Product Master database before they can affect inventory costing.
- Beli Bahan UI exposes Qty explicitly.
- Operational expense has Qty default `1`; its amount remains the total expense amount.
- Sale and production history carries immutable exact cost snapshots.
- Product Kind can later be mapped by Accounting rules without overloading operational Tipe Barang.
- Existing legacy DADAKAN execution remains available until the Sale-level fulfillment migration is explicitly implemented.
- Legacy production `REAL` columns may still be read for old rows but are not written by the new production engine.

## Compatibility and Recovery

Migrations `0019_product_costing_and_kinds.sql`, `0020_expense_quantity_behavior.sql`, and `0021_exact_production_costing.sql` are additive within the undeployed PR stack.

Existing `purchase_price` and `production_mode` columns are retained for compatibility. Existing production `REAL` costing columns are also retained as history fallback. Application rollback can ignore new Product Kind/costing/quantity fields, but after new purchase or production cost snapshots exist, destructive schema rollback is not permitted. Recovery must use a forward migration.

Historical products may bootstrap scaled `average_cost` from the previously stored per-product `purchase_price` as an opening HPP estimate. The migration does **not** claim that value is an actual latest purchase: `last_purchase_price` / `last_purchase_at` remain unknown until the first new itemized purchase posts.

## Security and Scope

Product Kind CRUD is management-authenticated and store-scoped. Database triggers reject cross-store Product Kind and purchase-item references.

Cost fields are server-owned. Product Master client requests cannot directly assign current average cost or latest purchase price.

## DOC-IMPACT

**REQUIRED** — contracts v2, migrations 0019–0021, Known Issues, regression tests, and this ADR are updated in the same change set.
