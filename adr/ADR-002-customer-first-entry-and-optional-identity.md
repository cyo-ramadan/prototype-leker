# ADR-002 — Customer-first entry and optional customer identity

Status: ACCEPTED for Prototype Leker

## Context

The public domain should open directly to the customer ordering experience. Owner and cashier access should still be discoverable from that same entry page. Customer purchasing must remain possible without authentication, while a logged-in customer needs a stable customer identity scoped to the selected branch.

The login surface should not require a user to know or choose their authorization rank before entering credentials. At the same time, customer identity must remain separate from internal access identities such as Owner and Cashier.

## Decision

1. `/` and `/customer` remain the default customer ordering experience.
2. The customer page exposes one Login control with one username/password form and no role picker.
3. `POST /api/auth/login?store=<KODE>` resolves the matching account type server-side from the submitted credential pair.
4. Owner and Cashier are resolved globally from their internal account tables. Customer is resolved only inside the selected active branch.
5. If the same credential pair matches more than one active account type, authentication is rejected with `AMBIGUOUS_LOGIN` rather than applying role precedence.
6. Successful Cashier login stores the existing cashier session token and redirects to `/cashier`.
7. Successful Owner login stores the existing Owner session token and redirects to `/admin`.
8. Customer authentication is optional. Guest checkout remains supported.
9. Customer masters are owned by a branch and stored with `store_id`.
10. Each customer always has a stable `customer_code`; username/password are optional account credentials managed from the branch workspace.
11. Customer sessions are scoped to their branch. The browser stores customer tokens per store code.
12. When an authenticated customer creates an order, the server derives `customer_id` from the bearer session. The browser is not trusted to choose a customer ID.
13. Existing legacy branch contacts are copied into the new customer master without automatic login credentials.
14. Owner, future Admin roles, and Cashier accounts are never stored in the customer master. Internal access identities belong to access/staff domains, while `customers` contains customer identities only.

## Consequences

- A branch may have customers who never log in and customers who do.
- Guest orders have `customer_id = NULL`.
- Logged-in orders retain branch-safe customer attribution.
- Existing `contacts` data remains for compatibility, but the branch UI promotes the new `customers` master as canonical for customer identity.
- The public UI has a single login form even though Owner, Cashier, and Customer authentication remain separate domains beneath it.
- A future Admin role can be added to the internal access domain and unified resolver without contaminating customer master data.

## Recovery

Migration `0007_customer_identity_unified_entry.sql` is additive. The role-agnostic login update adds no new schema migration. If deployment fails, roll back the application version. If a prior database migration itself fails, stop promotion and restore D1 using the established prototype backup/Time Travel recovery procedure before retrying a corrected migration.
