# Tenancy Fase 3 Audit — Admin & Reporting

Status: audit-only evidence for `karen-TENANCY-AUDIT-ADMIN-REPORTING`
Scope: `src/admin*.js`, `src/db-multistore.js`, `src/orders-multistore.js`, plus the Customer Sharing Group path needed to classify intentional cross-store reads.
Execution baseline: `main` at `7831a64d302511c25dfada084e32bce885af3b57` (2026-08-23).
DOC-IMPACT: REQUIRED by the claimed DOCS task and fulfilled by this file. No runtime, migration, schema, or implementation-task changes are made here.

## Classification

- **A — operational store scope:** `store_id` is correctly used to isolate one gerai after an already-authorized store has been selected.
- **B — tenant boundary today:** the code uses a single selected `store_id` as the effective access boundary, but authorization does not yet prove that the selected store belongs to the caller's authorized Tenant/Entity set.
- **C — intentional cross-store:** the code deliberately enumerates or combines multiple stores. This is safe only when the cross-store set is constrained by a tenant-aware authorization rule or an explicitly authorized cross-Entity relation.

The classification distinguishes query correctness from authorization correctness. A query can be perfectly store-scoped (A) while its preceding store-selection step is still a tenancy boundary risk (B).

## Executive finding

The per-store data queries in the active Admin implementation are generally disciplined: products, categories, contacts, transactions, drawers, stock, purchase detail, production detail, orders, and order items bind `store_id` consistently. The high-risk seam is one level above those queries.

`requireManagement()` has three paths:

1. Store Admin sessions are bound to one store and reject a different `?store=` value. This is currently the strongest boundary in the domain.
2. Owner sessions are global. The owner session row has no Tenant/Entity membership and therefore does not constrain which store may be selected.
3. The legacy PIN fallback is also global and has no store/Tenant allowlist.

At the same time, `resolveStore()` accepts the request-selected store, and Admin/Owner cross-store features can enumerate stores. With Ikan Galeh now representing a second active Tenant, an Owner or legacy-PIN request can select a store from another Tenant unless a higher layer outside these handlers provides a restriction. No such restriction is visible in the audited path.

The Customer Sharing Group path is a second critical seam. Group creation validates store existence and duplicate customer usernames, but does not validate that all member stores belong to the same Tenant or that the caller is authorized for every Entity represented. The resulting group scope is therefore already **C** and can become a cross-Tenant data bridge if stores from different Tenants are placed in one group.

## File-by-file audit

| File / path | `store_id` use and access shape | Class | Finding |
| --- | --- | --- | --- |
| `src/admin-multistore.js` | `selectedStore()` resolves `?store=`; product/category/contact CRUD then binds `store.id`. `adminBootstrap()` also calls `listStores()` and store creation/update are Owner-capable management actions. | A + B + C | Per-store CRUD is A. Request-selected store is B for Owner/legacy PIN because authorization has no Tenant allowlist. `listStores()` / store administration is C because it intentionally spans stores and currently has no Tenant filter in this handler. |
| `src/admin-transactions.js` | Every fact union (`sales`, `purchases`, `expenses`, `other_income`, `approval_requests`, `production_runs`) filters by the selected `store.id`; Accounting delivery lookup also filters by the same store. | A + B | The transaction query itself is A. Store selection is B for globally authorized Owner/legacy PIN sessions. No cross-store aggregation occurs inside this file. |
| `src/admin-transaction-detail.js` | Sale, purchase, expense, other-income, approval, production-run and component lookups consistently bind `storeId`; joins commonly reinforce equality with the fact's store. | A + B | Detail reads are A. The selected-store authority remains B for Owner/legacy PIN. IDs cannot escape the chosen store because the fact lookup also requires `store_id`. |
| `src/admin-purchase-detail.js` | Purchase header, supplier join and purchase items all constrain to selected `store.id`; Accounting snapshot receives that store ID. | A + B | Strong A query isolation after selection; B at the management store-selection seam. |
| `src/admin-production-detail.js` | Production run and component reads bind selected `store.id`; sale join additionally matches `s.store_id = pr.store_id`. | A + B | Strong A query isolation after selection; B at the management store-selection seam. |
| `src/admin-stock.js` | Product balances and stock movements bind selected `store.id`; joins to item types, units, balances and recipes match product/store pairs. | A + B | Strong A store isolation. B remains at request-selected store authorization. |
| `src/admin-product-classification.js` | Product mutation requires both product ID and selected `store.id`; master reference resolution receives the same store. | A + B | Mutation cannot target the same numeric product in another selected store. B remains at store selection for global management identities. |
| `src/admin-drawers.js` | Drawer list/report functions are called with selected `store.id`. | A + B | Store parameterization is A; selection authority is B for Owner/legacy PIN. |
| `src/admin.js` | Legacy single-store Admin implementation has no `store_id` filters because it predates the active multistore router. | Historical / not active in current router | `src/index.js` imports `handleAdminApi` from `admin-multistore.js`, not this file. It should not be treated as the current tenancy boundary, but its presence is migration debt if reintroduced accidentally. |
| `src/db-multistore.js` | Products, orders, order items, sequence allocation, status updates and resets bind an explicit `storeId`; inserted rows copy the caller-provided `order.storeId`. | A | This helper is consistently operational-store scoped. It does not choose or authorize the store, so callers must pass an already-authorized store. |
| `src/orders-multistore.js` | Order creation uses `store.id`; reads/status changes/reset pass an explicit store ID into `db-multistore`. | A | Operational scope is consistent. Tenancy correctness depends on the upstream resolver/auth path that supplied `store`. |

## Management authorization boundary

`requireManagement()` currently produces materially different isolation guarantees:

| Auth path | Current scope | Tenancy assessment |
| --- | --- | --- |
| Store Admin | Session joins directly to one `stores.id`; `adminStoreMatchesRequest()` rejects a mismatched requested store. | A for the assigned gerai. This is store-safe, although it still expresses authorization in store terms rather than an Entity/Tenant set. |
| Owner | `owner_sessions` joins only to `owner_accounts`; no Tenant/Entity relation is resolved. | B/C risk. Any store resolvable by the handler is reachable to the Owner identity. That may be intended for a platform super-owner, but it is not a Tenant boundary and must not be silently treated as one. |
| Legacy PIN | Global `store_settings.admin_pin_hash`; successful PIN fallback has no store match check. | B risk and the weakest management boundary. A valid legacy PIN can pair with an arbitrary resolvable `?store=`. |

The audit cannot infer whether an Owner account is intended to be a platform-wide super-admin or a customer/Tenant owner. That is an authorization-policy decision. Until the role is explicit, code that treats `requireManagement()` as Tenant authorization is unsafe.

## Intentional cross-store paths

### `admin-multistore` store enumeration

`adminBootstrap()` returns `listStores(... includeInactive: true)` to an authenticated management caller. For a Store Admin, the request is constrained to its own store but the bootstrap store list itself is not filtered in this module. For an Owner or legacy PIN, the list is explicitly cross-store. Classification: **C**.

This becomes a cross-Tenant disclosure as soon as the store catalog contains multiple Tenants unless `listStores()` or the caller's authorization set constrains the result. The current Admin handler does not apply such a constraint.

### Customer Sharing Group

`resolveCustomerScope()` intentionally expands one store into all active stores in the same `customer_share_group_stores` group. `handleOwnerCustomerSharingApi()` can also list all stores and create/update groups from arbitrary existing store IDs.

Classification: **C**.

Current validation protects group uniqueness and customer username collisions, but does not enforce Tenant membership. Therefore Customer Sharing Group is an explicit cross-store relation that must not be assumed to be a valid cross-Tenant relation. If a group contains stores from different Tenants, customer visibility can cross the Tenant boundary by design of the current resolver.

## Highest-risk scenarios with a second Tenant

1. **Owner reads another Tenant's transactions by changing `?store=`.** The transaction/detail queries remain store-correct, but the selected store is not proven to be in an Owner-authorized Tenant set.
2. **Legacy PIN reads or mutates another Tenant's selected store.** The fallback authenticates the PIN globally and does not call the Store Admin mismatch guard.
3. **Admin bootstrap exposes the global store catalog.** A caller can learn stores outside the intended Tenant even when the subsequent data pane is store-filtered.
4. **Customer Sharing Group crosses Tenant membership.** Group membership validation accepts any existing stores, so customer lookup scope can bridge Tenants if configured that way.
5. **Future reporting code reuses `listStores()` as an authorization source.** `listStores()` is a catalog/read helper, not proof that the caller may access every returned Entity.

## Safe invariants already present

- Transaction list and detail endpoints consistently include selected `store_id` on primary fact reads.
- Purchase/production detail joins include store equality on related rows.
- Stock reads and movement pagination are scoped by store and product.
- Order helpers carry `store_id` through headers, items, status history, reads, updates and reset operations.
- Store Admin sessions are tied to one store and reject cross-store selection.

These invariants should be preserved when Tenant/Entity authorization is introduced; replacing them with broad Tenant-only filters would accidentally weaken operational gerai isolation.

## Boundary requirements exposed by this audit

This document records requirements only; it does not create implementation tasks.

- A management request that accepts `?store=` needs an authorization check proving the resolved store/Entity belongs to the caller's authorized Entity set, except for an explicitly defined platform-superadmin role.
- Store enumeration returned to management/reporting callers needs to be derived from that same authorized Entity set rather than from the global store catalog.
- Legacy PIN fallback cannot serve as a Tenant boundary because it carries no Tenant/Entity identity.
- Customer Sharing Group membership needs an explicit policy for whether cross-Tenant membership is forbidden or separately authorized. Existing group membership must not be presumed Tenant-safe.
- Cross-store reports must distinguish “all stores in this Tenant / authorized Entity set” from “all stores in the database.”
- Store-level predicates should remain in operational queries after Tenant authorization is added.

## Audit conclusion

The active Admin/reporting data access layer is mostly **store-safe but not yet tenant-authorized**. The dominant risk is authorization scope, not missing `WHERE store_id = ?` clauses. Store Admin isolation is comparatively strong. Owner, legacy PIN, global store enumeration, and Customer Sharing Group need explicit Tenant/Entity semantics before the second Tenant can be considered isolated from Admin/reporting access.

No source or migration changes were made by this audit.
