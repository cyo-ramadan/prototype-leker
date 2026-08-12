# Stock, Production, Costing & Product Points Contract v2

Status: ACTIVE for Prototype Leker
Version: 2
Supersedes: `contracts/stock-production-points-v1.md`

## Purpose

This contract defines stock movement, recipe-linked production, moving-average HPP snapshots, product points, and the temporary compatibility boundary for legacy DADAKAN execution.

## Quantity Invariant

All physical quantities are integers in each product's smallest selected base unit.

Fractional business quantities must be represented through a smaller base unit. Monetary cost calculations may contain decimal values.

## Current Product Policy

Master Barang owns:

- `points_per_unit`;
- `stock_tracking_enabled`;
- explicit `linked_recipe_id`.

`products.production_mode` remains legacy runtime compatibility state. It is not editable through the current Product Master UI/API. Transaction-level fulfillment will replace it under a future Sale contract.

## Stock Source of Truth

Current physical quantity is `inventory_stock_balances.quantity`.

Canonical movement history is `stock_movements`.

Every tracked movement snapshots product, base unit, direction, integer quantity, source type/id, drawer where relevant, actor, and timestamp. `source_key` remains unique for idempotency.

Tracked balances may not become negative. A constraint failure rolls back the complete D1 batch.

## Purchase Stock-In and Costing

Inventory purchases create `purchase_items` and `PURCHASE` stock movements.

Each line records:

- product and Product Kind snapshot;
- base unit snapshot;
- integer quantity;
- line total;
- decimal unit cost;
- average cost before and after posting.

The product's `last_purchase_price` is updated from the newest purchase unit cost.

The product's `average_cost` follows moving weighted average:

`(old_stock × old_average_cost + purchase_line_total) / (old_stock + purchased_quantity)`.

When old stock is zero or less, the new average is the purchase unit cost.

## Production HPP

Production components snapshot `products.average_cost` when the production run posts.

For each component:

- `unit_cost_snapshot = component.average_cost`;
- `total_cost_snapshot = unit_cost_snapshot × total_component_quantity`.

A production run derives:

- `hpp_total = sum(component total_cost_snapshot)`;
- `hpp_per_unit = hpp_total / total_output_quantity`.

The output product's `average_cost` is then updated by moving weighted average using existing output stock and the new production run HPP before the output quantity is added to stock.

## Sale HPP Snapshot

Each sale item snapshots the current product `average_cost` and calculated line COGS. Historical sale HPP must not be recalculated from the current Product Master later.

For legacy AUTO_DADAKAN execution, the production statements run before sale-item HPP snapshotting, so the sale uses the cost state resulting from the production batch.

## Legacy DADAKAN Compatibility

Until a transaction-level fulfillment contract is implemented, legacy `products.production_mode = DADAKAN` still triggers the existing atomic production-before-sale path.

That compatibility path:

1. validates explicit active Recipe Linked;
2. computes integer batch count;
3. snapshots component costs;
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

**REQUIRED** — v2 replaces the v1 statement that costing was undefined. Moving average is now the prototype's current HPP method.
