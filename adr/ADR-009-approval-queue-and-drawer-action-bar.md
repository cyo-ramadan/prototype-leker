# ADR-009 — Drawer Action Bar and Approval Queue Staging

Status: ACCEPTED for Prototype Leker

## Context

The cashier drawer workspace now needs a denser action bar, additional operational entry points, and a safe staging flow for Arus Kas, Arus Barang, and Aset. These three flows must not mutate cash, inventory, or asset state at cashier-entry time.

## Decision

1. The visible **Buka Customer** control is removed from the cashier header. A hidden compatibility anchor remains temporarily because legacy cashier bootstrap code still assigns its URL; it has no visible or interactive UI.
2. **Penjualan** and **Pesanan** are rendered as `drawer-action-btn` controls in the existing drawer action row, immediately before the existing Beli Bahan action. Their existing mode/state handlers are retained.
3. The drawer action row adds **Penyesuaian Stok**, **Produksi**, **Arus Kas**, **Arus Barang**, and **Aset**.
4. Penyesuaian Stok and Produksi are visible entry points only. Their write contracts remain versioned separately.
5. Arus Kas, Arus Barang, and Aset submit to the separate `approval_requests` entity. Cashier submission always starts with `approval_status = pending_approval` and `posting_status = unposted`.
6. Approval requests are bound to `store_id`, `drawer_session_id`, and `cashier_id`. Creating a request requires the authenticated cashier to own the active drawer.
7. Admin Gerai can review only its own store. Owner can review all stores. Legacy PIN auth cannot approve requests.
8. ACC and Reject are explicit management decisions. Reject terminates the request without posting.
9. Posting behavior for CASH_FLOW, GOODS_FLOW, and ASSET is defined by ADR-010 and `contracts/operational-posting-v1.md`.
10. Approval APIs remain isolated from ordinary sale/order write paths so queue activity does not lock or block cashier transaction flow.
11. Existing customer/cashier order source tagging, customer-order auto-draft snapshot, direct-sale lifecycle tracking, and search auto-reset remain unchanged.

## Data Impact

Migration `0013_approval_queue.sql` creates `approval_requests` with independent approval and posting states plus indexes for store/status and drawer chronology.

Operational posting ledgers are introduced later by migration 0014 under ADR-010.

## Security

- Cashier creation requires active-drawer ownership.
- Admin approval is store-scoped server-side.
- Owner approval may span stores.
- Legacy PIN compatibility is explicitly excluded from approval authority.

## Performance

The approval queue is a separate table and is not joined into cashier sale/order writes. Cashier UI uses explicit user actions and no periodic polling.

## Recovery

Application code can be rolled back while leaving isolated approval rows intact. Posted rows follow ADR-010 recovery rules.

## Documentation Impact

DOC-IMPACT: REQUIRED. This ADR records the action-bar hierarchy, staging boundary, approval authority, and isolation. ADR-010 supersedes the earlier posting-blocker decision for CASH_FLOW, GOODS_FLOW, and ASSET.
