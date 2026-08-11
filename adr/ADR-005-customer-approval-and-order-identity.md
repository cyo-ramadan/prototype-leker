# ADR-005 — Customer Approval, Points Visibility, and Order Identity

Status: ACCEPTED for Prototype Leker

## Context

Customer-facing testing exposed four gaps: G002 still displayed the original copied G001 fixture menu, customer point balance was not visible, logged customers could edit the displayed order name, and self-registration had no approval workflow. The customer also needs a persistent way to inspect recent order status after returning to the menu.

## Decision

1. G002 demo fixtures are made visibly different from G001. Only untouched copied seed rows are retired; rows already changed manually are preserved.
2. Customer registration creates a `PENDING` registration request scoped to the selected gerai. It does not create an active customer row.
3. Admin Gerai may approve or reject registration requests only for its own gerai. Approval creates the Customer ID and active login identity. Owner may also perform branch management through the existing management authority.
4. Customer passwords remain stored as hashes. Plaintext passwords are never stored in registration-request rows.
5. Logged customer order identity is server-derived from the authenticated customer session. Client-supplied customer name cannot override the account name.
6. Guest checkout remains supported and guest customer names remain editable.
7. Customer point balance is computed from `customer_point_ledger` using the signed sum of `points_delta`. With no ledger entries the visible balance is `0`.
8. The customer page exposes a `Pesanan Saya` action. Logged customers read recent orders by authenticated Customer ID within the authorized customer-sharing scope. Guest devices may inspect recent locally remembered orders for the current gerai.
9. Kiosk/device label is retired from customer and cashier UI. The legacy database column remains empty for new orders for backward compatibility; no destructive table rebuild is performed.
10. Customer sharing continues to widen customer identity scope only. Product/menu data remains strictly branch-scoped.

## Recovery

Migration `0010_customer_registration_points_order_ux.sql` is additive except for retiring untouched G002 clone fixtures. It detects unchanged copied rows before deactivation. If deployment fails, stop promotion and use the established D1 recovery process before retrying a corrected migration.

## DOC-IMPACT

REQUIRED — customer registration lifecycle, order identity authority, points visibility, customer order-status access, kiosk-label retirement, and branch demo menu behavior materially changed.
