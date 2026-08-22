# Stock Adjustment Contract v2 — Temporal HPP Snapshot

Status: ACTIVE for Prototype Leker
Contract identifier: `MAXI_STOCK_ADJUSTMENT_V2`
Owner: Inventory / Costing
Supersedes: `MAXI_STOCK_ADJUSTMENT_V1` for new request costing evidence

## Purpose

Preserve the rupiah value known when a Stock Adjustment is staged. A later Purchase or Production may change the Product Master HPP, but it must never change the value represented by an older adjustment fact.

All V1 quantity, approval-authority, stale-snapshot, atomic-posting, stock-movement, and non-negative-balance rules remain active unless this contract explicitly extends them.

## Exact Cost Representation

Cost uses scaled INTEGER values with the canonical scale:

`1 rupiah = 1,000,000 cost units`

New Stock Adjustment payloads store:

- `unitCostSnapshotScaled` — the product's exact `products.average_cost` when the server stages the request;
- `totalCostSnapshotScaled` — `unitCostSnapshotScaled * quantity`, where `quantity` is the positive absolute adjustment delta.

Both values must be non-negative safe integers. Staging fails closed if either value cannot be represented exactly. `0` is a valid known snapshot. REAL/FLOAT values are forbidden.

## Temporal Snapshot Invariant

The server resolves cost from the same Product and store scope used for the quantity snapshot. Client-supplied names, units, quantities, or costs are not trusted as snapshot facts.

The two cost fields are written into the existing immutable `approval_requests.payload_json` together with the V1 quantity facts. After staging:

- changing `products.average_cost` does not rewrite the request payload;
- ACC/Reject does not resolve cost again;
- a later Stock Adjustment snapshots the then-current HPP;
- posting does not write `products.average_cost`;
- Purchase and Production moving-average writers remain the canonical sources that may change `products.average_cost`.

Stock Adjustment records correction evidence. It does not become a third moving-average source.

## Legacy V1 Compatibility

Legacy V1 requests without `unitCostSnapshotScaled` and `totalCostSnapshotScaled` remain readable and postable under their original quantity-only semantics.

The server must never backfill a legacy V1 request from the current Product Master cost. Doing so would assign a later value to an older fact and violate the temporal invariant. Consumers must treat missing cost fields as `cost snapshot unavailable`, not as zero and not as today's HPP.

## Accounting Boundary

This version records valuation evidence but does not activate an Accounting journal for Stock Adjustment gain/loss. Inventory owns the staged correction fact. A future Inventory-to-Accounting bridge may interpret the immutable snapshot only after its signed gain/loss and account-selection semantics are approved.

## Implementation

- `src/operational-posting.js`
- `test/stock-adjustment.test.js`
- `adr/ADR-037-manufacture-costing-authority.md` §2.5–2.6

## Regression Requirement

Tests must prove all of the following with the real database writer:

1. a staged adjustment stores exact unit and total scaled HPP;
2. changing Product Master HPP afterward does not change the old payload;
3. posting the old adjustment does not change Product Master HPP;
4. a later adjustment snapshots the new HPP;
5. V1 stale-quantity and atomic-posting guards remain active.

## DOC-IMPACT

REQUIRED — changes to cost field names, scale, snapshot timing, legacy compatibility, HPP mutation authority, or future Accounting interpretation require matching contract, ADR, README, KNOWN_ISSUES, and regression updates.
