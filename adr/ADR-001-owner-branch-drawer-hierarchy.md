# ADR-001 — Owner → Branch → Drawer Hierarchy

Status: ACCEPTED for Prototype Leker
Date: 2026-08-10

## Context

The earlier prototype exposed branch management beside branch-level masters. That blurred two different scopes: organizational structure and operational master data. It also allowed authenticated cashiers to mutate queue data without an explicit cash-drawer ownership model.

Bos Cyo clarified the intended hierarchy:

- one highest account creates branches;
- each branch owns its own masters and transactions;
- products and suppliers may differ between branches;
- sales and purchases from one branch must never appear as another branch's transactions;
- many cashiers may be logged in, but only the cashier who opens the branch cash drawer may perform writes;
- cashier UI needs menu selection, a draft, and drawer actions for purchase, expense, other income, and detail review.

## Decision

Use this hierarchy:

1. Owner account
2. Branch (`stores`)
3. Branch workspace and branch-scoped masters
4. Cashier identity bound to one branch
5. Cash drawer session bound to branch + cashier
6. Store-scoped transactions attributed to the open drawer

`/admin` is the Owner Console. `/s/<CODE>/admin` is the branch workspace. Branch creation is not presented as a master-data tab.

All operational tables continue to use one prototype D1 database with explicit `store_id` isolation. New transaction tables also carry `drawer_session_id` and `cashier_id` where applicable.

Only one cash drawer session may be `OPEN` per store. Read access remains available to other authenticated cashiers. Transaction writes and customer-order status mutations require the authenticated cashier to own the active drawer.

Purchases recorded by this prototype are cash-movement facts only. They do not mutate official inventory quantities or valuation.

## Consequences

Positive:

- organizational hierarchy is visible in both UI and schema;
- branch data cannot be mixed merely by changing browser store context on cashier writes;
- multiple logged-in cashiers can coexist without concurrent write authority;
- drawer activity is attributable to a cashier and branch;
- supplier and transaction foundations are ready for later domain integrations.

Tradeoffs:

- a cashier who owns an open drawer must close it before another cashier can take write ownership;
- payment-method handling is not yet modeled, so drawer v1 represents prototype cashier cash movements only;
- Owner and cashier authentication remain prototype-grade and must be hardened before production.

## Compatibility

Existing `G001`, `G002`, Wowo, Wiwi, products, categories, contacts, and orders remain intact. New branches created by Owner start with empty masters. The legacy admin PIN remains only as a temporary compatibility fallback while the Owner account becomes the primary management path.

## Recovery

Migration `0006_owner_branch_drawer_transactions.sql` is additive. If migration or deployment fails, stop deployment and restore D1 using the approved backup/Time Travel process before retrying a corrected migration.
