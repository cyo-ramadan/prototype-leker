# ADR-012 — Manufacturing Master, Transaction Explorer, and Accounting Boundary

Status: Accepted
Date: 2026-08-12

## Context

Admin Gerai needs structured product types, units, recipes/BOM, and a consolidated transaction tracking panel. Recipe data will later support production and HPP. A separate Accounting program is being developed independently.

Putting journal detail into Admin would duplicate Accounting ownership and create cross-program drift. Storing recipe data as mutable current-state rows would also destroy historical production/costing traceability.

## Decision

1. Introduce a dedicated Manufacturing Master module in Prototype Leker.
2. Product type is capability-driven (`can_sell`, `can_purchase`, `can_produce`, `can_consume`, `track_stock`) rather than a hard-coded UI label only.
3. Product has a store-scoped item type and base unit.
4. Recipe/BOM uses immutable revisions. Creating a new recipe revision archives the previous active revision for the output product.
5. Circular BOMs and cross-store master references are rejected.
6. Product sale/menu reads enforce the type's `can_sell` policy.
7. Admin gets a lazy operational transaction explorer. It is a read model and never becomes the source of truth for source transactions.
8. Admin exposes only an Accounting integration seam and source reference. Journal interpretation, COA, buku besar, neraca, laba rugi, and accounting closing remain owned by the separate Accounting program.
9. No direct database access between Prototype Leker and Accounting is allowed.

## Consequences

- Raw materials can remain active inventory items without appearing in customer/cashier sellable menus.
- Recipe history can be referenced by future production snapshots and costing logic.
- Accounting development can proceed independently while Prototype Leker maintains stable business-fact references.
- HPP cannot be considered complete until Inventory/Costing defines valuation and Production defines actual-consumption/yield snapshots.
- Unit conversion is intentionally deferred beyond Manufacturing Master v1; V1 recipe quantities use each product's base unit.

## Documentation

- `contracts/manufacturing-master-v1.md`
- `contracts/admin-transaction-explorer-v1.md`
- `contracts/accounting-bridge-seam-v1.md`
- migration `0016_manufacturing_master_v1.sql`

DOC-IMPACT: REQUIRED.
