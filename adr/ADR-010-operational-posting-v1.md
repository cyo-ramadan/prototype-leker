# ADR-010 — Operational Posting Contract v1

Status: ACCEPTED for Prototype Leker

## Context

ADR-009 intentionally staged CASH_FLOW, GOODS_FLOW, and ASSET requests without posting because no canonical posting manual existed. Bos Cyo has now authorized Prototype Leker to define a new versioned protocol when an applicable manual/protocol does not yet exist.

## Decision

1. `contracts/operational-posting-v1.md` is the canonical V1 posting contract for CASH_FLOW, GOODS_FLOW, and ASSET approval requests.
2. Cashier submission remains staging-only: `pending_approval` + `unposted`.
3. Admin Gerai or Owner `ACC` performs approval and posting in the same D1 batch.
4. Posting is append-only and idempotent through `approval_request_id UNIQUE` on each domain ledger.
5. CASH_FLOW writes `cash_ledger_entries`. Drawer expected cash includes posted `IN` and `OUT` movements.
6. GOODS_FLOW writes `inventory_ledger_entries` and atomically updates `inventory_stock_balances`.
7. Inventory quantity cannot become negative. A violating OUT movement rolls back the complete posting and leaves the request pending.
8. ASSET writes `asset_ledger_entries` and atomically updates aggregate `asset_value_balances` per store.
9. Asset aggregate value cannot become negative. A violating DECREASE rolls back the complete posting and leaves the request pending.
10. The approval snapshot is immutable. Management approves/rejects it; management does not rewrite cashier payload during ACC.
11. REJECT never posts.
12. No accounting account mapping, costing, depreciation, lot/expiry, BOM, or valuation semantics are inferred by V1.

## Data Impact

Migration `0014_operational_posting_ledgers.sql` adds:

- `cash_ledger_entries`;
- `inventory_stock_balances`;
- `inventory_ledger_entries`;
- `asset_value_balances`;
- `asset_ledger_entries`.

## Compatibility

Existing sales, purchases, expenses, other income, orders, and drawer write paths remain unchanged. Approval ledgers are additive. The drawer report only adds posted operational cash to its expected-cash calculation.

## Recovery

A failed D1 batch leaves both domain state and approval state unchanged. Posted rows are not deleted or rewritten as rollback shortcuts; corrective business events must be represented by later movement entries.

## Supersession

This ADR supersedes ADR-009 items 4, 9, and the posting-contract blocker language only for CASH_FLOW, GOODS_FLOW, and ASSET. ADR-009 remains authoritative for action-bar layout, approval staging, authority, and isolation.

## Documentation Impact

DOC-IMPACT: REQUIRED. Operational Posting Contract v1 and migration 0014 become active project knowledge.
