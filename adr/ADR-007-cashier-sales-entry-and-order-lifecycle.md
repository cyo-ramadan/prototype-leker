# ADR-007 — Cashier Sales Entry and Customer Order Lifecycle

Status: ACCEPTED for Prototype Leker

## Context

Prototype Leker already has one active cash drawer per Gerai, cashier accounts bound to a Gerai, a manual sale endpoint, a menu grid, and customer orders. The cashier UX needs three explicit work areas: Penjualan, Menu, and Pesanan. Manual sales must be enterable either by searching a product or by clicking the visual menu, while both input paths must converge on one sale draft and one canonical sale-processing action.

Customer orders also need a clearer operational lifecycle: Dipesan, Diterima, Dibuat, Sudah Jadi, plus Ditolak. Rejection is allowed only while the order is still Dipesan.

## Decision

1. Transaction write remains a Cashier responsibility. Admin Gerai does not receive a sale-write action because sales are attributed to the authenticated cashier and the cashier-owned active drawer.
2. The cashier workspace exposes three explicit modes: **Penjualan**, **Menu**, and **Pesanan**.
3. Penjualan provides a product search box. Choosing a search result calls the same draft mutation used by the visual menu.
4. Menu keeps the visual product-card flow. Clicking a menu item adds it to the same shared sale draft used by Penjualan.
5. Both sale-entry paths finish through the existing **PROSES PENJUALAN** action and existing `POST /api/cashier/sales` endpoint. No parallel sale API or duplicate sale state is introduced.
6. The existing database status values are retained and mapped to the business labels as follows:
   - `NEW` = **Dipesan**
   - `PREPARING` = **Diterima**
   - `READY` = **Dibuat**
   - `COMPLETED` = **Sudah Jadi**
   - `CANCELLED` = **Ditolak**
7. The allowed order transitions are exactly:
   - `NEW -> PREPARING`
   - `NEW -> CANCELLED`
   - `PREPARING -> READY`
   - `READY -> COMPLETED`
   - `COMPLETED` and `CANCELLED` are terminal.
8. Therefore, **Tolak** is available only while an order is `NEW` / Dipesan. Once accepted, the order cannot be rejected through the status API.
9. Rejected orders remain visible in a dedicated **Ditolak** list for now. Deletion or archival of rejected orders is a separate future decision.
10. Customer-facing active-order status and Pesanan Saya labels use the same business terminology so cashier and customer do not see contradictory meanings.
11. The existing event-driven cashier refresh behavior remains unchanged. This feature must not reintroduce periodic cashier polling.

## Data and Migration Impact

No database migration is required. The existing order status CHECK constraint already supports `NEW`, `PREPARING`, `READY`, `COMPLETED`, and `CANCELLED`; this change redefines the user-facing meaning and tightens allowed transitions without adding a new stored status.

## Security and Tenant Isolation

- Sale writes still require an authenticated cashier who owns the active drawer.
- Order status writes still require an authenticated cashier who owns the active drawer.
- Product search and visual menu data continue to come from the authenticated cashier's server-derived Gerai workspace.
- No Admin, Owner, Customer, or client-selected store value gains cashier transaction authority through this change.

## Compatibility

Existing orders keep their stored status values and remain readable. Their displayed labels follow the new lifecycle mapping. Existing completed and cancelled rows remain terminal. Existing sale records, drawer ownership, customer identity, and branch isolation are unchanged.

## Recovery

If the new cashier UI causes a regression, revert the cashier/customer presentation scripts and restore the previous transition table. No database rollback is required because no schema or stored status value is added.

## Documentation Impact

DOC-IMPACT: REQUIRED. This ADR records the new sale-entry paths, the canonical order-label mapping, and the reject-only-before-acceptance rule.
