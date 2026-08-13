# Stock Adjustment Contract v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
Contract identifier: `MAXI_STOCK_ADJUSTMENT_V1`
Owner: Inventory / Costing

## Purpose

Provide an explicit, audited way to correct Prototype Leker physical stock to a counted target quantity without bypassing the canonical stock balance and movement history.

Penyesuaian Stok is a correction flow. It is not a purchase, production, sale, or generic manual stock write.

## Current Quantity Representation

Prototype Leker physical stock remains on the legacy integer quantity engine for this version.

Therefore:

- `currentQuantitySnapshot` is a non-negative integer in the product base unit;
- `targetQuantity` is a non-negative integer in the same base unit;
- the future canonical fractional-quantity migration may supersede the representation, but must preserve the adjustment audit facts.

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
- derived positive delta `quantity`.

A target equal to the current snapshot is rejected as a no-op.

Only active stock-tracked products with a valid base unit are exposed as adjustment options.

## Approval Envelope Compatibility

V1 reuses the existing Operational Posting approval envelope:

- `approval_requests.request_type = GOODS_FLOW`;
- payload carries `purpose = STOCK_ADJUSTMENT`.

This is an explicit compatibility choice so the existing approval table CHECK constraint does not need to be rebuilt solely to introduce the correction subtype.

The Stock Movement record itself is not genericized:

- `stock_movements.source_type = STOCK_ADJUSTMENT`;
- `source_key = STOCK_ADJUSTMENT:<approvalRequestId>`.

## Approval and Stale Snapshot Guard

Cashier staging never changes stock.

Admin Gerai or Owner may ACC/Reject through the existing management Approval Queue.

Before ACC posting, the server re-reads the current canonical stock balance.

If current stock is different from `currentQuantitySnapshot`:

- no stock mutation occurs;
- the stale request is rejected;
- stable error code: `STOCK_ADJUSTMENT_STALE`;
- the response includes snapshot and actual quantity;
- the user must submit a new adjustment based on current stock.

This prevents an old physical-count snapshot from overwriting sales, purchases, production, or other stock movement that occurred after staging.

## Atomic Posting

For a non-stale ACC:

1. derive delta from the staged snapshot/target facts;
2. update `inventory_stock_balances` by the derived delta;
3. append one `inventory_ledger_entries` row through the existing approval posting ledger;
4. append one canonical `stock_movements` row with source type `STOCK_ADJUSTMENT`;
5. mark the approval approved + posted;
6. all steps execute in the same D1 batch.

The canonical database non-negative stock invariant remains active. An invalid OUT rolls back the whole posting.

Posted stock movements are audit history and must not be rewritten as a correction shortcut. A later correction is another Stock Adjustment.

## HPP / Costing Boundary

Stock Adjustment v1 corrects **quantity only**.

It does not silently rewrite:

- `products.average_cost`;
- `products.last_purchase_price`;
- purchase or production historical cost snapshots;
- sale historical COGS snapshots.

This preserves deterministic historical costing. Any future valuation treatment of adjustment gains/losses requires an explicit Inventory/Costing and Accounting bridge contract.

## Accounting Boundary

Stock Adjustment v1 does not directly generate an Accounting journal.

Warehouse/Inventory transaction category `wh_opname` already exists in Accounting Settings, but actual signed gain/loss branch selection and valuation must be approved before an Inventory-to-Accounting bridge posts it.

Inventory owns the quantity correction fact. Accounting owns later journal interpretation.

## Relationship to Store Policies

A future per-store Inventory/Costing policy may block cost-affecting purchases while stock is negative or otherwise anomalous.

That policy must use this approved Stock Adjustment flow (or its superseding version) as the correction path. The policy is not owned by Accounting even if its toggle is surfaced near Setting Akuntansi for user convenience.

## Implementation

- `src/operational-posting.js`
- `src/approval-queue.js`
- `public/cashier-approval-actions.js`
- `public/management-approval-queue.js`
- `test/stock-adjustment.test.js`
- `test/approval-queue-layout.test.js`

## DOC-IMPACT

REQUIRED — changes to adjustment input, snapshot semantics, stale handling, approval authority, quantity representation, movement source, or costing/accounting boundary require matching contract, ADR, and regression updates.
