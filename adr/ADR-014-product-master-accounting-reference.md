# ADR-014 — Product Master Consolidation and Accounting Reference Boundary

Status: ACCEPTED
Date: 2026-08-13

## Context

Product configuration had become split between the legacy Tambah/Edit Barang form, a separate Product Policy card, and a duplicate classification editor under the technical manufacturing master. The user wants Master Barang to be the single product-edit surface while Tipe Barang, Satuan, and Resep remain reusable masters selected by reference.

The user also wants an Accounting portal and a basic account list now, while the real Accounting system is being built as a separate module by another AI/workstream.

An existing draft PR (#3) also touches Accounting/integration concepts from an old repository base. Its Accounting work must not be overwritten or treated as authoritative for the current branch without reconciliation.

## Decision

1. Create a dedicated Product Master module and unified editor API.
2. Keep Tipe Barang, Satuan, and Resep/BOM as separate master entities.
3. Move their selection, points, stock policy, mode, and recipe linkage into the same Tambah/Edit Barang form.
4. Hide the duplicate technical-master product classification UI while preserving its DOM for backward compatibility.
5. Add explicit `products.linked_recipe_id` with store/output/active validation.
6. Keep `recipe_link_enabled` as a compatibility flag derived from whether an explicit recipe link exists.
7. Reject unsafe base-unit changes after recipe or stock history exists.
8. Add a provisional `accounting_account_refs` registry and `product_accounting_refs` mapping table.
9. Seed a small basic reference list for future mapping, but never auto-map a product or transaction silently.
10. Treat all reference accounts as connector data only. Prototype Leker does not create journals, ledgers, trial balances, financial statements, or closing entries.
11. The separate Accounting module remains the owner of canonical accounts and journal interpretation. A future connector can replace provisional references with external account IDs.

## Consequences

- Admin has one coherent Product Master form.
- Product points, unit, type, stock behavior, recipe linkage, and optional Accounting references are visible together.
- Manufacturing master is cleaner: Tipe, Satuan, and Resep remain master CRUD; product classification is no longer a second visible editor.
- DADAKAN configuration becomes explicit and auditable.
- Accounting preparation can start without duplicating the Accounting engine.
- Transaction-level mapping remains intentionally future work and must be configured explicitly.

## Compatibility and Recovery

Migration `0018_product_master_accounting_reference.sql` is additive. Existing product policy fields remain and legacy endpoints are not removed.

Application rollback may ignore the new reference tables/columns. Do not destructively remove them after external Accounting references are connected; use a forward migration if the bridge contract evolves.

## Security and Scope

All Product Master and Accounting reference reads/writes remain management-authenticated and store-scoped. Database triggers reject cross-store recipe/account references and account-type mismatches.

## DOC-IMPACT

**REQUIRED** — contract `product-master-accounting-reference-v1.md`, tests, migration, UI, and this ADR are part of the same change.
