# Stock Adjustment Contract v2

Status: ACTIVE for Prototype Leker
Contract identifier: `MAXI_STOCK_ADJUSTMENT_V2`
Supersedes: `contracts/stock-adjustment-v1.md`
Owner: Inventory / Costing

## Purpose

Provide an explicit, audited way to correct Prototype Leker physical stock to a counted target quantity while preserving both the canonical quantity history and the HPP that was in force when the adjustment fact was staged.

Penyesuaian Stok is a correction flow. It is not a purchase, production, sale, or generic manual stock write.

## Temporal HPP Invariant

Historical business facts never resolve HPP from the current Product Master when they are read later.

For Stock Adjustment, the server snapshots the product's current exact scaled `products.average_cost` when the request is staged:

- `unitCostSnapshotScaled = products.average_cost`;
- `totalCostSnapshotScaled = unitCostSnapshotScaled × absolute adjustment quantity`.

The direction remains a separate `IN` or `OUT` fact. `totalCostSnapshotScaled` is therefore an absolute valuation snapshot, not a signed Accounting journal amount.

If HPP changes after the request was staged, the staged adjustment keeps its old HPP snapshot. A later Stock Adjustment snapshots the new HPP. The same time boundary already applies to Sale HPP snapshots.

Canonical HPP changes can currently come from purchase moving weighted average and production moving weighted average. Those changes affect future facts only. They must not rewrite earlier Sale, Production, Purchase, or Stock Adjustment snapshots.

## Current Quantity Representation

Prototype Leker physical stock remains on the legacy integer quantity engine for this version.

Therefore:

- `currentQuantitySnapshot` is a non-negative integer in the product base unit;
- `targetQuantity` is a non-negative integer in the same base unit;
- the future canonical fractional-quantity migration may supersede the representation, but must preserve the adjustment audit facts and their exact scaled cost snapshots.

## Staging

Cashier with active drawer write authority may submit a Stock Adjustment request.

Public/UI input:

- `productId`;
- `targetQuantity`;
- `reason` — required human-readable reason;
- `note` — optional.

The server resolves and snapshots:

- product name;
- base unit ID/symbol;
- `currentQuantitySnapshot` from `inventory_stock_balances`, defaulting to zero when no balance row exists;
- target quantity;
- derived direction `IN` or `OUT`;
- derived positive delta `quantity`;
- `unitCostSnapshotScaled` from the current exact scaled `products.average_cost`;
- `totalCostSnapshotScaled` from the staged unit HPP multiplied by the adjustment quantity.

A target equal to the current snapshot is rejected as a no-op.

Only active stock-tracked products with a valid base unit are exposed as adjustment options.

Invalid, negative, or unsafe-integer HPP snapshots fail closed. New costing logic must not use SQLite `REAL/FLOAT` arithmetic.

## Approval Envelope Compatibility

V2 keeps the existing Operational Posting approval envelope:

- `approval_requests.request_type = GOODS_FLOW`;
- payload carries `purpose = STOCK_ADJUSTMENT`;
- quantity and HPP snapshots are stored in the request `payload_json` as immutable staged business facts.

No schema migration is required for this version.

The Stock Movement record itself remains explicit:

- `stock_movements.source_type = STOCK_ADJUSTMENT`;
- `source_key = STOCK_ADJUSTMENT:<approvalRequestId>`.

## Approval and Stale Snapshot Guard

Cashier staging never changes stock or HPP.

Admin Gerai or Owner may ACC/Reject through the existing management Approval Queue.

Before ACC posting, the server re-reads the current canonical stock balance.

If current stock is different from `currentQuantitySnapshot`:

- no stock mutation occurs;
- the stale request is rejected;
- stable error code: `STOCK_ADJUSTMENT_STALE`;
- the response includes snapshot and actual quantity;
- the user must submit a new adjustment based on current stock.

This prevents an old physical-count snapshot from overwriting sales, purchases, production, or other stock movement that occurred after staging.

The HPP fields are never refreshed during ACC. The request represents the time at which the physical adjustment fact was staged. If another canonical event changes HPP later, the existing request still preserves its original valuation evidence.

## Atomic Posting

For a non-stale ACC:

1. derive delta from the staged snapshot/target facts;
2. update `inventory_stock_balances` by the derived delta;
3. append one `inventory_ledger_entries` row through the existing approval posting ledger;
4. append one canonical `stock_movements` row with source type `STOCK_ADJUSTMENT`;
5. mark the approval approved + posted;
6. all steps execute in the same D1 batch.

The canonical database non-negative stock invariant remains active. An invalid OUT rolls back the whole posting.

Posted stock movements and approval payload snapshots are audit history and must not be rewritten as a correction shortcut. A later correction is another Stock Adjustment.

## HPP / Costing Boundary

Stock Adjustment v2 corrects **quantity** and records contemporaneous **valuation evidence**.

It does not update `products.average_cost` and therefore does not create a new HPP for future Sales. It also does not rewrite:

- `products.last_purchase_price`;
- purchase or production historical cost snapshots;
- sale historical COGS snapshots;
- any earlier Stock Adjustment HPP snapshot.

Current HPP formation remains owned by the canonical costing paths described by `contracts/stock-production-points-v2.md` and ADR-037. Purchase and production may change current `products.average_cost`; Stock Adjustment does not.

## Sale Relationship

Sale rows already persist `sale_items.unit_cost_snapshot` and `sale_items.line_cogs` from the HPP in force when the Sale is posted.

Therefore, if HPP changes at time T:

- a Sale posted before T keeps its previous HPP and COGS;
- a Sale posted after T uses the new current HPP;
- later HPP changes repeat the same forward-only rule.

Reports and Accounting integrations must consume the stored historical snapshot. They must not recompute an old Sale from current Product Master HPP.

## Accounting Boundary

Stock Adjustment v2 does not directly generate an Accounting journal.

The HPP snapshot is an Inventory/Costing fact. It is not a debit/credit instruction and is not silently re-resolved by Accounting.

Warehouse/Inventory transaction category `wh_opname` may later consume the staged direction, quantity, and exact cost snapshot under an explicit Inventory-to-Accounting bridge contract. Accounting remains the owner of journal interpretation.

## Implementation

- `src/operational-posting.js`
- `src/approval-queue.js` — existing stale quantity guard, unchanged by v2
- `public/cashier-approval-actions.js` — existing staging UI, unchanged by v2
- `public/management-approval-queue.js` — existing approval UI, unchanged by v2
- `test/stock-adjustment.test.js`
- `test/temporal-hpp-snapshots.test.js`

## DOC-IMPACT

REQUIRED — v2 adds immutable exact HPP snapshots to Stock Adjustment while preserving the existing quantity correction and approval semantics.