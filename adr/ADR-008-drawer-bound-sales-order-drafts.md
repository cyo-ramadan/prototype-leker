# ADR-008 — Drawer-Bound Sales, Order Drafts, and Source Tracking

Status: ACCEPTED for Prototype Leker

## Context

ADR-007 introduced explicit Penjualan, Menu, and Pesanan modes and a shared sale draft. The next cashier iteration requires transaction navigation to live inside the active cash drawer context, customer-order acceptance to snapshot into a sale draft, and direct cashier sales to produce the same kitchen lifecycle history as customer orders.

## Decision

1. Penjualan and Pesanan are rendered inside the active cash-drawer workspace. Menu remains available in the same drawer workspace because it mutates the shared sale draft.
2. Customer orders remain unbound while status is `NEW`. On `NEW -> PREPARING` (Diterima), the status update atomically assigns the authenticated cashier's active `drawer_session_id` if the order is not already bound.
3. The PATCH response for Diterima is the canonical item snapshot used to populate the browser sale draft. The browser does not issue a second order/menu request for that drafting event.
4. Orders have `source` with canonical values `customer` and `cashier`. Existing rows default to `customer` for backward compatibility.
5. A sale created from an accepted customer order carries `sales.order_id = sourceOrderId` and does not create a duplicate cashier order.
6. A direct cashier sale creates a `cashier` order bound to the same active drawer. Its lifecycle history is emitted in one transactional D1 batch as `PREPARING` (Diterima), `READY` (Dibuat), then `COMPLETED` (Sudah Jadi).
7. Direct-sale order items and sale items use the same server-validated item snapshot. Customer-derived sale pricing comes from the accepted order snapshot.
8. Source filtering is a small UI state toggle. Order grouping is done in one pass to avoid chained array filtering during render.
9. Search selection adds the product, clears the input, hides results, and restores focus for the next item.
10. Existing event-driven cashier refresh remains unchanged. Periodic polling stays prohibited.

## Data and Migration Impact

Migration `0012_drawer_bound_sales_orders.sql` adds:

- `orders.source` with default `customer`;
- `orders.drawer_session_id`;
- `sales.order_id` for sale-to-order lineage;
- supporting indexes;
- an `order_items` rebuild raising the quantity ceiling from 20 to 50 so direct cashier tracking mirrors the existing sale-item limit.

Historical customer orders remain readable with `source = customer` and may have `drawer_session_id = NULL`.

## Security and Isolation

All status writes and sales still require the authenticated cashier to own the active drawer. The server derives store and drawer identity from authentication and drawer ownership; clients cannot select another store or drawer.

## Compatibility and Recovery

Existing endpoints remain canonical: `PATCH /api/cashier/orders/:id/status` and `POST /api/cashier/sales`. The sale endpoint accepts optional `sourceOrderId`; callers that omit it keep direct-sale behavior. Rolling back application code should be done before rolling back migration 0012 because older code tolerates the added nullable/defaulted columns.

## Documentation Impact

DOC-IMPACT: REQUIRED. This ADR supersedes ADR-007 only where navigation hierarchy, drawer binding, order source, sale-to-order lineage, and direct-sale lifecycle tracking are concerned. ADR-007 remains authoritative for the status-label mapping and transition rules for customer orders.
