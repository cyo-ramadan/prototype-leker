# Operational Posting Contract v1

Status: ACTIVE for Prototype Leker
Version: 1

## Purpose

This contract defines the first canonical posting behavior for cashier-originated approval requests. It exists because no earlier Prototype Leker manual or contract defines cash-flow, inventory-flow, or asset-value posting semantics.

## Core Rules

1. Cashier entry is staging only. Every request starts as `pending_approval` + `unposted`.
2. The submitted payload is an immutable posting snapshot. Approval never edits the snapshot.
3. `ACC` means approve and post in one atomic database batch.
4. `REJECT` never posts.
5. Every posting ledger has `approval_request_id UNIQUE`; one approval request can post at most once.
6. Posting updates `approval_requests` to `approval_status = approved`, `posting_status = posted`, and sets `approved_at` + `posted_at` only in the same successful batch as its domain movement.
7. A posting failure leaves the approval request pending and unposted.
8. Store and drawer identity come from the original staged request, never from approval-client input.

## CASH_FLOW

Canonical payload:

- `direction`: `IN` or `OUT`
- `amount`: positive integer minor-unit amount (IDR whole rupiah in this prototype)
- `description`: required text
- `note`: optional text

Posting creates one `cash_ledger_entries` row. Cash balance for a drawer is derived from the existing drawer cash formula plus posted cash-ledger entries: `IN` adds and `OUT` subtracts.

## GOODS_FLOW

Canonical payload:

- `productId`: product in the same store
- `productName`: server-produced snapshot of the product name at staging time
- `direction`: `IN` or `OUT`
- `quantity`: positive integer
- `note`: optional text

Posting creates one `inventory_ledger_entries` row and atomically changes `inventory_stock_balances.quantity`. Inventory balance may never become negative. An `OUT` that would make stock negative fails the whole posting and leaves the request pending.

Inventory V1 is quantity-only. It does not invent costing, valuation, lot, expiry, or unit-conversion rules.

## ASSET

Canonical payload:

- `direction`: `INCREASE` or `DECREASE`
- `amount`: positive integer minor-unit amount
- `description`: required text describing the asset movement
- `note`: optional text

Posting creates one `asset_ledger_entries` row and atomically changes the store-level `asset_value_balances.total_amount`. Asset value may never become negative.

Asset V1 is an aggregate operational asset-value ledger. It does not invent depreciation, individual asset serials, useful life, salvage value, or accounting account mappings.

## Authority

- Admin Gerai may approve only requests in its own store.
- Owner may approve requests across stores.
- Legacy PIN authorization cannot approve.

## Isolation and Performance

Approval queues and posting ledgers are separate from ordinary sales/orders tables. Normal cashier sale/order writes do not join these ledgers. No polling is required.

## Future Versions

Costing, accounting journals, individual asset register, stock units, production/BOM, and depreciation require later versioned contracts. Future versions must preserve historical V1 ledger facts rather than reinterpret them in-place.
