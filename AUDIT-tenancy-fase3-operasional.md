# Tenancy Fase 3 Audit — Operasional

Status: audit-only evidence for `karen-TENANCY-AUDIT-OPERASIONAL`
Scope: `src/cashier-*.js`, `src/operational-posting.js`, `src/approval-queue.js`, `src/orders*.js`.
Execution baseline: `main` at `7831a64d302511c25dfada084e32bce885af3b57` (2026-08-23).
DOC-IMPACT: REQUIRED by the claimed DOCS task and fulfilled by this file. No runtime, migration, schema, or implementation-task changes are made here.

## Classification

- **A — operational store scope:** `store_id` is correctly used to keep a cashier/operational fact inside the selected gerai after the caller's store is already authorized.
- **B — tenant boundary today:** the path accepts or derives a store boundary without proving that the selected Entity belongs to the caller's authorized Tenant/Entity set.
- **C — intentional cross-store:** the path deliberately expands beyond one store and therefore needs an explicit authorization relation rather than treating the database-wide store set as implicitly trusted.

## Executive finding

The cashier execution path is substantially stronger than the management reporting path because a valid cashier session is joined to exactly one `cashiers.store_id`, and nearly all operational writes derive `storeId` from `auth.cashier.store.id`. Sales, purchases, expenses, drawer activity, stock effects, production, and approval requests therefore remain operationally store-scoped.

Two seams need tenancy attention:

1. Cashier customer search and sales point attribution intentionally expand customer visibility through `resolveCustomerScope()`. That is **C** and inherits the Customer Sharing Group tenancy risk: the group relation itself is not proof of same-Tenant membership.
2. Management approval remains **B** for Owner scope. A Store Admin approval is pinned to the admin's store, while an Owner may omit `?store=` and list/decide approvals across all stores, or select an arbitrary resolvable store. That behavior may be intentional platform-owner access, but it is not a Tenant authorization boundary.

## File-by-file audit

| File / path | Access shape | Class | Finding |
| --- | --- | --- | --- |
| `src/cashier-auth.js` | `requireCashier()` joins the bearer session to a cashier and that cashier's single store. Cashier master CRUD is store-filtered after a management-selected store is resolved. | A + B | Runtime cashier identity is strong A. Admin-side cashier CRUD inherits management store-selection semantics and is B for global Owner/legacy management identities. |
| `src/cashier-drawer.js` | Drawer lookup/open/close, menu, suppliers, sales, purchases, expenses and other income all use `cashier.store.id`; product/supplier validation also binds that store. | A | Strong operational gerai boundary. Drawer ownership adds cashier-level write protection inside the store. |
| `src/cashier-purchase.js` | Purchase options, supplier validation, purchase header/items, product cost update, balances and stock movements all bind the cashier store. | A | Store isolation is explicit through every purchasing and inventory effect. |
| `src/cashier-operational-expense.js` | Cost masters/types, expense rows and Accounting reference snapshot use `auth.cashier.store.id`. | A | Expense posting remains store-scoped and does not enumerate other stores. |
| `src/cashier-production.js` | Production options/preparation and Accounting dispatch receive `storeId` from the authenticated cashier. | A | Production initiation is operational-store scoped. Downstream warehouse/accounting modules must preserve the supplied store/Entity identity. |
| `src/cashier-sales-tracking.js` | Products, orders, sale headers/items, stock effects and status updates use the authenticated store. Customer lookup/points can expand through Customer Sharing Group. | A + C | Core sale/order writes are A. Shared-customer lookup and point context are intentional C and require tenant-safe sharing membership. |
| `src/cashier-customers.js` | Starts from authenticated cashier store, then searches customers across `resolveCustomerScope(...).storeIds`. | C | Cross-store visibility is explicit. Safe only if the sharing group is authorized across the represented Entities/Tenants. |
| `src/cashier-workspace.js` | Workspace composition delegates to cashier-authenticated store-scoped handlers and carries no independent global-store authority. | A | No separate tenancy boundary should be inferred here; preserve the authenticated cashier store from delegated handlers. |
| `src/operational-posting.js` | Normalization and posting helpers receive `storeId` / `request.storeId` and bind it to products, cash ledger, inventory balances/ledger, movements and assets. | A | This is a store-scoped posting primitive. It does not authorize the store, so callers must provide a previously authorized operational store. |
| `src/approval-queue.js` cashier routes | Request creation/list/options derive store from authenticated cashier and drawer. | A | Strong store scope for cashier-submitted approvals. |
| `src/approval-queue.js` management routes | Store Admin scope is fixed to `auth.admin.store.id`; Owner scope can be global (`storeId: null`) or request-selected through `resolveStore()`. Legacy PIN is explicitly rejected for approval decisions. | A + B | Store Admin path is A. Owner path is B until Owner's platform-wide vs Tenant-owner semantics and authorized Entity set are explicit. |
| `src/orders-multistore.js` | Create/read/status/reset functions receive an explicit store and delegate to `db-multistore` with store ID. | A | Active multistore order flow preserves operational gerai scope. |
| `src/orders.js` | Legacy order flow uses single-store `db.js` helpers and has no `store_id` parameter. | Historical / migration debt | Current multistore routing should not reintroduce this helper as a tenancy-aware path. It cannot represent a Tenant/Entity boundary by itself. |

## Cashier identity boundary

`requireCashier()` is the strongest invariant in this domain: the request does not choose a store after authentication. The session resolves cashier → store, and later handlers copy that store ID into business facts. This makes cashier operations naturally store-safe even before Tenant authorization is fully generalized.

The login lookup uses globally unique cashier username rather than a Tenant-qualified credential. That does not create cross-store data access after login because the matched cashier carries exactly one store. It does mean username namespace is platform-wide today, which is a product/identity policy detail rather than a query isolation leak.

## Customer Sharing Group seam

`cashier-customers.js` and `cashier-sales-tracking.js` intentionally call `resolveCustomerScope()` and accept customers from every store returned by the group. Points record the `share_group_id` and `source_store_id`, so the cross-store behavior is deliberate.

Classification: **C**.

This relation must not be promoted into a Tenant boundary by assumption. If Customer Sharing Group contains stores belonging to different Tenants, cashier customer search, customer attachment to sales, and points behavior can cross Tenant boundaries. The tenancy layer therefore needs an explicit policy stating whether cross-Tenant customer sharing is forbidden or separately authorized.

## Approval seam

Cashier-created approvals are A: `store_id`, drawer and cashier all originate from the authenticated cashier session.

Management decision scope is mixed:

- Store Admin: A, because `managementScope()` takes `auth.admin.store.id` and later rejects a request from another store.
- Legacy PIN: excluded from approval decisions, reducing risk.
- Owner: B. With no `?store=`, `listRequests()` receives `storeId: null` and can list approvals globally. With `?store=`, the Owner can resolve any existing store. Whether that is valid depends on an explicit platform-superowner policy or a Tenant/Entity allowlist.

## Safe invariants to preserve

- Cashier sessions remain bound to one cashier and one store.
- Drawer ownership remains checked before transactional writes.
- Product, supplier, cost, purchase, expense, sale, stock, production and order mutations retain store predicates even after Tenant authorization is introduced.
- Operational posting helpers continue to treat `storeId` as gerai scope while Entity/Tenant authorization happens before the helper is invoked.
- Approval decisions continue to reject a request whose store differs from a store-bound Admin scope.

## Boundary requirements exposed by this audit

This document records requirements only and does not create implementation tasks.

- Customer Sharing Group needs explicit Tenant/Entity membership policy before its cross-store scope can be considered tenancy-safe.
- Owner approval access needs an explicit definition: platform-wide superowner or Tenant-bound owner with an authorized Entity set.
- Cross-store customer sharing must never be used as a substitute for Tenant authorization.
- Store-level predicates on operational facts should remain even when server-side Tenant/Entity authorization is added.
- Legacy single-store order helpers must not be treated as tenancy-aware without an explicit multistore boundary.

## Audit conclusion

Operational cashier writes are predominantly **A: safe store scope** because the authenticated cashier determines the gerai and that store ID is propagated through the fact chain. The principal cross-Tenant concerns are **C: Customer Sharing Group expansion** and **B: global/request-selected Owner approval scope**. Those seams need explicit Tenant/Entity authorization semantics before the second Tenant can be considered isolated across operational workflows.

No source or migration changes were made by this audit.
