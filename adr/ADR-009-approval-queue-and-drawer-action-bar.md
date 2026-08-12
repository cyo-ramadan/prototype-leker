# ADR-009 — Drawer Action Bar and Approval Queue Staging

Status: ACCEPTED for Prototype Leker

## Context

The cashier drawer workspace now needs a denser action bar, additional operational entry points, and a safe staging flow for Arus Kas, Arus Barang, and Aset. These three flows must not mutate cash, inventory, or asset state at cashier-entry time. Existing Prototype Leker documentation also states that canonical inventory/production/accounting facts are not yet defined, so posting behavior cannot be invented safely.

## Decision

1. The visible **Buka Customer** control is removed from the cashier header. A hidden compatibility anchor remains temporarily because legacy cashier bootstrap code still assigns its URL; it has no visible or interactive UI.
2. **Penjualan** and **Pesanan** are rendered as `drawer-action-btn` controls in the existing drawer action row, immediately before the existing Beli Bahan action. Their existing mode/state handlers are retained.
3. The drawer action row adds **Penyesuaian Stok**, **Produksi**, **Arus Kas**, **Arus Barang**, and **Aset**.
4. Penyesuaian Stok and Produksi are visible entry points only. They do not write inventory because adjustment, BOM/recipe, yield, waste, and costing contracts are not yet canonical.
5. Arus Kas, Arus Barang, and Aset submit to the separate `approval_requests` entity. Cashier submission always starts with `approval_status = pending_approval` and `posting_status = unposted`.
6. Approval requests are bound to `store_id`, `drawer_session_id`, and `cashier_id`. Creating a request requires the authenticated cashier to own the active drawer.
7. Admin Gerai can review only its own store. Owner can review all stores. Legacy PIN auth cannot approve requests.
8. ACC and Reject are explicit management decisions. Reject terminates the request without posting.
9. ACC records the approval fact separately from posting. Until a canonical ledger/inventory/asset posting contract exists, ACC changes `approval_status` to `approved` and `posting_status` to `blocked` with reason `POSTING_CONTRACT_REQUIRED`.
10. No approval API directly inserts into sales, purchases, expenses, other income, or product stock state. This keeps the queue isolated from ordinary drawer transactions and avoids lock coupling.
11. Existing customer/cashier order source tagging, customer-order auto-draft snapshot, direct-sale lifecycle tracking, and search auto-reset remain unchanged.

## Data Impact

Migration `0013_approval_queue.sql` creates `approval_requests` with independent approval and posting states plus indexes for store/status and drawer chronology.

No financial ledger, inventory ledger, production ledger, or asset ledger is introduced by this ADR because their posting semantics are unresolved.

## Security

- Cashier creation requires active-drawer ownership.
- Admin approval is store-scoped server-side.
- Owner approval may span stores.
- Legacy PIN compatibility is explicitly excluded from approval authority.

## Performance

The approval queue is a separate table and is not joined into cashier sale/order writes. Cashier UI uses explicit user actions and no periodic polling.

## Recovery

Application code can be rolled back while leaving the isolated approval rows intact. No approval row should be interpreted as posted unless `posting_status = posted` and `posted_at` is populated by a future approved posting adapter.

## Documentation Impact

DOC-IMPACT: REQUIRED. This ADR records the action-bar hierarchy, staging boundary, approval authority, and the explicit posting-contract blocker.
