# Tenancy Fase 3 Audit — Warehouse

Status: audit-only evidence for `karen-TENANCY-AUDIT-WAREHOUSE`
Scope: `src/stock-production.js`, `src/warehouse-production.js`, `src/warehouse-settings.js`, `src/admin-stock.js`, `src/accounting-warehouse-production-bridge.js`.
Execution baseline: `main` at `7831a64d302511c25dfada084e32bce885af3b57` (2026-08-23).
DOC-IMPACT: REQUIRED by the claimed DOCS task and fulfilled by this file. No runtime, migration, schema, or implementation-task changes are made here.

## Classification

- **A — operational store scope:** `store_id` correctly isolates warehouse, stock, production, or bridge facts inside one gerai after that store has already been authorized.
- **B — tenant boundary today:** a management path selects a store without proving that the selected Entity belongs to the caller's authorized Tenant/Entity set.
- **C — intentional cross-store:** a path deliberately spans stores. No audited Warehouse runtime path performs a legitimate C aggregation today.

## Executive finding

Warehouse execution is predominantly **A**. Stock and production helpers receive a `storeId` from upstream and repeatedly bind the same store across products, recipes, components, balances, movements, production runs, Accounting mappings, bridge deliveries, and journal dispatch. The principal tenancy seam is Warehouse Settings/Admin Stock management selection, which inherits the same global Owner/legacy-management ambiguity seen in Admin/reporting.

No audited Warehouse posting helper independently enumerates all stores or resolves an arbitrary second store. That is a useful invariant to preserve when Tenant authorization is added.

## File-by-file audit

| File / path | Access shape | Class | Finding |
| --- | --- | --- | --- |
| `src/stock-production.js` | Sale/production products, recipe components, balances, movements, production runs and costing statements all carry one supplied `storeId`; joins reinforce `p.store_id`, recipe/component store equality and balance store equality. | A | Strong operational store isolation. The helper does not authorize the store, so its caller must supply an already-authorized gerai. |
| `src/warehouse-production.js` | Output product, recipe, material products, production components, balances and stock movements are all selected/written using one supplied `storeId`. | A | Manual production V2 is store-contained; no cross-store material substitution is visible. |
| `src/warehouse-settings.js` | Management auth is followed by request-selected `resolveStore()`. Warehouses, access, principals, opname settings and registered transaction categories are then filtered by that store. | A + B | Data mutations/reads are A after selection. The selection itself is B for globally authorized Owner/legacy management identities because this module does not verify an authorized Tenant/Entity set. |
| `src/admin-stock.js` | Stock products, balances and movement history are filtered by the selected management store and reinforce store equality on related records. | A + B | Query layer is store-safe; request-selected management scope carries the same B seam as Admin/reporting. |
| `src/accounting-warehouse-production-bridge.js` | Production fact, components, transaction rules, item-category mappings, bridge delivery idempotency and Accounting posting all use `store.id`. | A | Bridge preserves the producer store through Accounting resolution. It does not aggregate stores or infer Tenant identity. |

## Production and stock invariant

Both production engines treat `storeId` as a required execution context. Product/recipe/component lookups require store equality before statements are built. Stock deltas then update balances with `(store_id, product_id)` and emit movements carrying the same store. Production run snapshots also persist the same `store_id`.

Classification: **A**.

This is the correct gerai-level invariant even after Tenant/Entity authorization exists. A broader Tenant filter should be added before execution when needed, not substituted for the existing store predicates.

## Warehouse Settings seam

`warehouse-settings.js` authenticates through `requireManagement()`, then resolves `?store=` (or the default store) independently. Every subsequent warehouse/access/opname query is properly store-filtered, including principal lookup which requires Admin/Cashier membership in the selected store.

Classification: **A + B**.

Store-bound Admin semantics are strong when the upstream management identity is restricted to its gerai. A global Owner or legacy management identity can still select an arbitrary resolvable store unless Tenant/Entity authorization is enforced before this module treats the store as valid authority. The warehouse CRUD itself does not create the leak; the selection boundary does.

## Accounting bridge seam

The Warehouse → Accounting production bridge receives a concrete `store` object and uses `store.id` for:

- production fact and component snapshots;
- `wh_production` rule configuration;
- item-category inventory account mappings;
- bridge delivery idempotency;
- the call to `postAccountingJournal()`.

Classification: **A**.

This keeps Accounting facts tied to the producer gerai. The bridge should continue resolving Entity/Tenant context from the already-authorized store rather than widening queries to all stores in a Tenant. Cross-Entity consolidation belongs to the consolidation read model, not this posting path.

## Highest-risk second-Tenant scenarios

1. **Owner/legacy management selects another Tenant's Warehouse Settings store.** The resulting CRUD is internally store-safe but the caller's right to that Entity is not established in this module.
2. **Admin Stock reads another Tenant by request-selected store under a global management identity.** The stock queries themselves remain correctly filtered.
3. **A future caller passes a foreign store into production helpers.** The helpers will faithfully operate inside that foreign store because they are execution primitives, not authorization boundaries. Their callers must establish authority first.

## Safe invariants to preserve

- Product, recipe, component, balance, movement, run and bridge queries retain explicit store equality.
- Warehouse principals remain required to belong to the same store as the warehouse.
- Production Accounting bridge keeps producer store identity end-to-end.
- Bridge idempotency remains keyed with `store_id` so identical fact IDs in different stores cannot collide.
- No Warehouse helper treats the global store catalog as an authorization source.

## Boundary requirements exposed by this audit

This document records requirements only and does not create implementation tasks.

- Management Warehouse/Admin Stock store selection needs the same server-side authorized Entity-set check as other management modules, except for an explicitly defined platform-superadmin role.
- Production/stock helpers should remain authorization-agnostic execution primitives and receive only already-authorized store context.
- Store-level warehouse predicates must remain after Tenant authorization is introduced.
- Warehouse → Accounting posting must preserve producer Entity/store provenance and must not become a cross-Entity consolidation mechanism.

## Audit conclusion

Warehouse runtime data handling is overwhelmingly **A: safe operational store scope**. The important **B** seam is management-selected store authority in Warehouse Settings/Admin Stock. No legitimate **C** cross-store Warehouse aggregation is present in the audited runtime. Tenant isolation therefore depends on authorizing the selected Entity before entering these otherwise well-scoped warehouse primitives.

No source or migration changes were made by this audit.
