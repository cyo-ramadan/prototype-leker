# Stock, Production, Costing & Product Points Contract v2

Status: ACTIVE for Prototype Leker
Version: 2
Supersedes: `contracts/stock-production-points-v1.md`

## Purpose

This contract defines stock movement, recipe-linked production, moving-average HPP snapshots, product points, and the temporary compatibility boundary for legacy DADAKAN execution.

## Quantity Invariant

The current Prototype Leker inventory engine still persists physical stock and recipe quantities as integers in each product's selected base unit.

The approved MAXI canonical direction is fractional-capable exact decimal quantity. A dedicated compatibility migration will replace the legacy integer stock representation; this costing revision does not create a second stock source of truth.

Operational expense quantity is already allowed as canonical decimal text because it is behavioural metadata and does not post inventory.

## Cost Invariant

Money totals remain exact integer transaction values. Unit cost and HPP that require sub-rupiah precision use scaled INTEGER values with `COST_SCALE = 1,000,000` cost units per rupiah.

New costing logic must not use SQLite `REAL/FLOAT` arithmetic. Legacy `REAL` production cost columns from migration 0017 remain nullable read compatibility only. Migration 0021 provides authoritative exact `*_scaled` production cost fields.

## Current Product Policy

Master Barang owns:

- `points_per_unit`;
- `stock_tracking_enabled`;
- explicit `linked_recipe_id`.

`products.production_mode` remains legacy runtime compatibility state. It is not editable through the current Product Master UI/API. Transaction-level fulfillment will replace it under a future Sale contract.

## Stock Source of Truth

Current physical quantity is `inventory_stock_balances.quantity`.

Canonical movement history is `stock_movements`.

Every tracked movement snapshots product, base unit, direction, quantity, source type/id, drawer where relevant, actor, and timestamp. `source_key` remains unique for idempotency.

Tracked balances may not become negative. A constraint failure rolls back the complete D1 batch.

## Purchase Stock-In and Costing

Inventory purchases create `purchase_items` and `PURCHASE` stock movements.

Each line records:

- Product ID selected from the active store database and Product Kind snapshot;
- base unit snapshot;
- explicit purchase quantity;
- exact integer line total;
- exact scaled unit cost;
- scaled average cost before and after posting.

The product's `last_purchase_price` stores the newest scaled purchase unit cost.

The product's `average_cost` follows moving weighted average using integer-scaled arithmetic:

`(old_stock × old_average_cost_scaled + purchase_line_total × COST_SCALE) / (old_stock + purchased_quantity)`.

The calculation uses deterministic rounding. When old stock is zero or less, the new average is the scaled purchase unit cost.

## Production HPP

Production components snapshot `products.average_cost` when the production run posts.

For each component:

- `unit_cost_snapshot_scaled = component.average_cost`;
- `total_cost_snapshot_scaled = unit_cost_snapshot_scaled × total_component_quantity`.

A production run derives:

- `hpp_total_scaled = sum(component total_cost_snapshot_scaled)`;
- `hpp_per_unit_scaled = rounded(hpp_total_scaled / total_output_quantity)`.

The output product's scaled `average_cost` is then updated by moving weighted average using existing output stock and the new production run HPP before the output quantity is added to stock.

The writer leaves legacy `hpp_total`, `hpp_per_unit`, `unit_cost_snapshot`, and `total_cost_snapshot` REAL fields NULL for new production rows.

## Sale HPP Snapshot

Each sale item snapshots the current scaled product `average_cost` and scaled line COGS. Historical sale HPP must not be recalculated from the current Product Master later.

For legacy AUTO_DADAKAN execution, the production statements run before sale-item HPP snapshotting, so the sale uses the cost state resulting from the production batch.

## Legacy DADAKAN Compatibility

Until a transaction-level fulfillment contract is implemented, legacy `products.production_mode = DADAKAN` still triggers the existing atomic production-before-sale path.

That compatibility path:

1. validates explicit active Recipe Linked;
2. computes integer batch count under the current quantity engine;
3. snapshots component costs using exact scaled values;
4. deducts component stock;
5. updates production HPP and output average cost;
6. adds output stock;
7. deducts sale stock;
8. records sale item HPP/recipe/production references and customer points in the same D1 batch.

No new Product Master write may change `production_mode`.

## Manual Production

Manual production reuses the same production engine and moving-average HPP logic. It does not duplicate BOM or costing formulas in the browser.

## Product Points

`points_per_unit`, `line_points`, and `sales.total_points` remain integer values. Points are credited only for a valid customer identity, with unique SALE/EARN ledger protection.

## Accounting Boundary

Costing produces operational cost facts and immutable snapshots. It does not generate Accounting journal entries.

Accounting remains the owner of journal interpretation and posting. A later Accounting Settings/Journal Rule contract may consume Product Kind and transaction facts through approved integration boundaries.

## DOC-IMPACT

**REQUIRED** — v2 defines exact scaled moving-average HPP and records the separate canonical fractional-quantity migration as follow-up work.
