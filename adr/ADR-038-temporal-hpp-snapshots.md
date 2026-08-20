# ADR-038 — Temporal HPP snapshots are forward-only business facts

Status: ACCEPTED
Date: 2026-08-20
Decision authority: Bos Cyo
Change ID: `MAXI-TEMPORAL-HPP-SNAPSHOT-20260820`

## Context

Prototype Leker already stores exact HPP snapshots on Sale and Production facts while `products.average_cost` remains the current operational HPP used by future facts.

Bos Cyo clarified the required time semantics on 2026-08-20 with a concrete boundary example: when HPP changes at 17:00, transactions posted before 17:00 must keep the HPP that was valid before the change. Transactions posted after 17:00 use the new HPP until a later canonical event changes HPP again.

Current canonical HPP changes can be produced by:

- purchase moving weighted average when the current purchase cost differs from previous inventory cost;
- production moving weighted average when actual production cost enters finished-goods inventory.

Stock Adjustment previously corrected quantity without preserving a contemporaneous valuation snapshot. That made the quantity fact auditable but left no immutable HPP evidence for the adjustment itself.

## Decision

### 1. Historical Sale HPP is immutable

At Sale posting time, each `sale_items` row snapshots the current HPP into:

- `unit_cost_snapshot`;
- `line_cogs`.

If current HPP changes at time T:

- a Sale posted before T keeps the HPP and COGS stored before T;
- a Sale posted after T snapshots the HPP that is current after T;
- a later HPP change repeats the same forward-only rule.

Readers, reports, corrections, reversals, and Accounting integrations must use the stored historical snapshot. They must not recompute an old Sale from the latest `products.average_cost`.

### 2. Stock Adjustment also snapshots HPP at staging time

When a Stock Adjustment request is staged, Inventory/Costing snapshots the HPP that is current at that business-fact time into the existing `approval_requests.payload_json`:

- `unitCostSnapshotScaled` = current exact scaled `products.average_cost`;
- `totalCostSnapshotScaled` = `unitCostSnapshotScaled × absolute adjustment quantity`.

The request already snapshots current physical stock and target quantity at staging. HPP follows the same temporal fact boundary.

If HPP changes after staging, the older request keeps its prior HPP snapshot. A new Stock Adjustment staged after the change gets the new HPP.

ACC does not re-resolve or refresh the HPP snapshot. Existing stale-quantity protection remains unchanged and continues to reject a request when canonical stock quantity changed after staging.

### 3. Stock Adjustment is not an HPP formation event

Stock Adjustment remains a physical quantity correction. Recording valuation evidence does not make it an HPP writer.

It must not update:

- `products.average_cost`;
- `products.last_purchase_price`;
- historical Purchase, Production, Sale, or prior Stock Adjustment snapshots.

Purchase and Production remain the current canonical paths that can move current average HPP under the existing contracts. ADR-037 may later centralize those writers into the Manufaktur authority without changing this temporal invariant.

### 4. Exact arithmetic only

HPP snapshots use the existing exact scaled INTEGER representation, `1,000,000` cost units per rupiah.

New temporal snapshot logic must not use SQLite `REAL/FLOAT` arithmetic as authoritative costing state.

### 5. Accounting boundary remains unchanged

The Stock Adjustment cost snapshot is an Inventory/Costing business fact, not a journal instruction.

Accounting may consume it under an explicit future Inventory-to-Accounting bridge, but Accounting must not replace the snapshot with current Product Master HPP when interpreting a historical adjustment.

Sale Accounting likewise consumes the stored Sale COGS snapshot rather than recomputing from current HPP.

## Consequences

- historical Sale HPP before an HPP change is protected from later master-cost changes;
- later Sales automatically use the then-current HPP because the Sale writer snapshots `products.average_cost` at posting;
- Stock Adjustment gains immutable exact HPP evidence without a D1 schema migration because its staged payload is already the canonical request snapshot envelope;
- Stock Adjustment still does not change future HPP;
- purchase and production moving-average changes apply prospectively to later facts only;
- no direct Accounting behavior is introduced by this ADR.

## Compatibility and migration

No database migration is required.

Existing historical Stock Adjustment rows created before this ADR may not contain `unitCostSnapshotScaled` / `totalCostSnapshotScaled`. They remain valid legacy quantity-correction facts and must not be backfilled from current HPP because that would invent historical valuation.

Existing Sale rows already carrying stored HPP snapshots keep their values unchanged.

## Related

- `contracts/stock-production-points-v2.md`
- `contracts/stock-adjustment-v2.md`
- `ADR-015-product-kind-moving-average-costing-and-sale-fulfillment-boundary.md`
- `ADR-020-audited-stock-adjustment-and-stale-snapshot-guard.md`
- `ADR-035-flexible-production-execution-and-accounting-transfer.md`
- `ADR-037-manufacture-costing-authority.md`

## DOC-IMPACT

**REQUIRED** — this ADR defines the temporal boundary for Sale and Stock Adjustment HPP and is paired with Stock Adjustment Contract v2 plus regression coverage.