# ADR-005 — Customer Approval, Points Visibility, and Order Identity

Status: ACCEPTED for Prototype Leker

## Context

Customer-facing testing exposed four gaps: G002 still displayed the original copied G001 fixture menu, customer point balance was not visible, logged customers could edit the displayed order name, and self-registration had no approval workflow. The customer also needs a persistent way to inspect recent order status after returning to the menu.

Bos Cyo subsequently set a duplicate-identity rule for self-registration: once a WhatsApp number already belongs to a Master Customer in the authorized customer-sharing scope, the same person must not create another customer identity merely by changing the phone-number formatting or username.

Bos Cyo later chose a zero-fee/manual WhatsApp acquisition flow for membership. Customer registration should be able to open a prefilled WhatsApp message to the destination configured by the selected Store, while the platform must remain explicit that a normal `wa.me` handoff cannot prove the message was actually sent. The existing manual approval remains the authority that activates the member.

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
11. WhatsApp number is a duplicate-identity guard for customer registration within the authorized customer-sharing scope. The server compares a normalized digits-only value and treats Indonesian local `0...` and country-code `62...` forms as equivalent; formatting characters do not create a new identity. An empty phone remains optional and is not treated as a duplicate key. If a normalized WhatsApp number matches any existing Master Customer row in scope, both new registration and later `APPROVE` review fail with HTTP `409`, code `CUSTOMER_ALREADY_REGISTERED`, and message `Customer sudah terdaftar.` The approval-time recheck closes the race where the phone becomes registered after a request was first submitted.
12. The WhatsApp destination used for membership registration is Store-scoped configuration in `customer_membership_settings`, not a hardcoded number in customer UI.
13. Store Admin may read/update the WhatsApp destination only for its own Store. Entity Admin may read/update the same Store setting for any Store inside its own Entity. Both panels therefore edit one canonical value, not duplicated Store-vs-Entity copies.
14. On successful self-registration, the request is committed as `PENDING` first. If the selected Store has a WhatsApp destination configured, the API returns a `wa.me` URL with a prefilled manual-verification message containing the request code and non-secret registration data. Plaintext password is never included in the WhatsApp message.
15. The free/manual WhatsApp flow provides no delivery or send acknowledgement. A redirect/open to WhatsApp must never be represented as proof that the customer pressed Send. `sendConfirmed` remains false, and the member becomes active only through the existing Admin `APPROVE` action.
16. A Store with no configured WhatsApp destination keeps the previous registration behavior: the `PENDING` request is still stored and can still be approved manually, but the customer is not redirected to WhatsApp. This keeps rollout backward-compatible while each Store configures its destination.

## Recovery

Migration `0010_customer_registration_points_order_ux.sql` is additive except for retiring untouched G002 clone fixtures. It detects unchanged copied rows before deactivation. If deployment fails, stop promotion and use the established D1 recovery process before retrying a corrected migration.

The WhatsApp duplicate guard is code-only and adds no schema or data migration. Recovery for that rule is a normal code rollback; existing Master Customer and registration rows require no database rewrite.

Migration `0082_customer_membership_whatsapp_settings.sql` is additive and stores only current Store-level configuration. Application rollback may leave this table unused without altering existing registration requests or Customer masters. If the deployment fails after migration application, roll back the application version or deploy the corrected version through the canonical pipeline; do not rewrite an already-applied migration.

## DOC-IMPACT

REQUIRED — customer registration lifecycle, duplicate WhatsApp identity policy, manual WhatsApp handoff, Store/Entity Admin configuration authority, order identity authority, points visibility, customer order-status access, kiosk-label retirement, and branch demo menu behavior materially changed.
