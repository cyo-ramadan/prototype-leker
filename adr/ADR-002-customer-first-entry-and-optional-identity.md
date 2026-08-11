# ADR-002 — Customer-first entry and optional customer identity

Status: ACCEPTED for Prototype Leker

## Context

The public domain should open directly to the customer ordering experience. Owner and cashier access should still be discoverable from that same entry page. Customer purchasing must remain possible without authentication, while a logged-in customer needs a stable customer identity scoped to the selected branch.

## Decision

1. `/` and `/customer` remain the default customer ordering experience.
2. The customer page exposes one Login control with three roles: Customer, Cashier, Owner.
3. Successful Cashier login stores the existing cashier session token and redirects to `/cashier`.
4. Successful Owner login stores the existing Owner session token and redirects to `/admin`.
5. Customer authentication is optional. Guest checkout remains supported.
6. Customer masters are owned by a branch and stored with `store_id`.
7. Each customer always has a stable `customer_code`; username/password are optional account credentials managed from the branch workspace.
8. Customer sessions are scoped to their branch. The browser stores customer tokens per store code.
9. When an authenticated customer creates an order, the server derives `customer_id` from the bearer session. The browser is not trusted to choose a customer ID.
10. Existing legacy branch contacts are copied into the new customer master without automatic login credentials.

## Consequences

- A branch may have customers who never log in and customers who do.
- Guest orders have `customer_id = NULL`.
- Logged-in orders retain branch-safe customer attribution.
- Existing `contacts` data remains for compatibility, but the branch UI promotes the new `customers` master as canonical for customer identity.
- Owner and cashier authentication protocols remain unchanged; the customer page is an additional entry surface for them.

## Recovery

Migration `0007_customer_identity_unified_entry.sql` is additive. If deployment fails during migration, stop promotion and restore the D1 database using the established prototype backup/Time Travel recovery procedure before retrying a corrected migration.
