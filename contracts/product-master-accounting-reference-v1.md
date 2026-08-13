# Product Master & Accounting Reference Contract v1

Status: SUPERSEDED by `contracts/product-master-accounting-reference-v2.md`
Version: 1

> Historical contract retained for audit history. Current Product Master/costing behavior is defined by v2 and ADR-015.

## Purpose

This contract consolidates product configuration into **Master Barang** while keeping Tipe Barang, Satuan, and Resep/BOM as separate reusable master entities. It also defines a connector-only Accounting reference surface without moving journal ownership into Prototype Leker.

## Master Barang Ownership

Master Barang owns the configuration of one sellable/stockable product record:

- name, category, purchase price, selling price, image, active state;
- `item_type_id`, selected from Master Tipe Barang;
- `base_unit_id`, selected from Master Satuan;
- `points_per_unit` as a non-negative integer;
- `stock_tracking_enabled`;
- `production_mode`: `STOCK` or `DADAKAN`;
- `linked_recipe_id`, selected from active Master Resep revisions;
- optional Accounting account references for sales, inventory, and COGS/HPP.

The old standalone Product Policy card is retired from the UI. These fields are edited from the same Tambah/Edit Barang form.

## Separate Technical Masters

The following remain independent master data and are not embedded CRUD inside Master Barang:

- **Tipe Barang**: capability rules such as sell, purchase, produce, consume, and stock tracking;
- **Satuan**: smallest physical unit; physical quantities remain integer;
- **Resep/BOM**: immutable recipe revisions and components.

Master Barang only selects references to those masters. The duplicate Klasifikasi Barang editor inside the technical-master view is hidden while its legacy DOM remains available for compatibility with existing scripts.

## Recipe Link

`linked_recipe_id` is an explicit Product Master reference.

Rules:

1. The linked recipe must be ACTIVE.
2. The linked recipe must belong to the same store.
3. The linked recipe output product must be the product being edited.
4. `recipe_link_enabled` remains as a compatibility/derived flag and is true only when a recipe link is present.
5. `DADAKAN` requires an active Recipe Linked and stock tracking.
6. Sale/production facts continue to snapshot the exact recipe id and revision actually used, so historical transactions do not change when the master recipe is revised later.

A brand-new product cannot link a recipe before the product exists because a recipe itself references its output product. The supported flow is: create product → create recipe → edit product → choose Recipe Linked.

## Base Unit Safety

Physical stock quantities are integers in the selected base unit.

Changing a base unit is rejected after the product already has recipe history, stock movement history, or a non-zero stock balance. A future unit-conversion/migration contract must handle those changes explicitly instead of silently rewriting historical quantities.

## Accounting Reference Boundary

Prototype Leker provides `MAXI_ACCOUNTING_REFERENCE_V1` as a connector-side reference registry.

It is **not** the canonical Accounting chart of accounts and it does not own:

- debit/credit journal creation;
- posting rules;
- general ledger;
- trial balance;
- balance sheet;
- profit and loss;
- accounting closing.

Those remain owned by the separate Accounting module.

The reference registry exists so operational masters and future transaction mappings can hold stable provisional references before the external Accounting module is connected.

## Basic Provisional Account References

V1 seeds these basic references per prototype store:

- 1101 Kas — ASSET
- 1102 Bank — ASSET
- 1201 Piutang Usaha — ASSET
- 1301 Persediaan — ASSET
- 2101 Utang Usaha — LIABILITY
- 3101 Modal — EQUITY
- 3201 Laba Ditahan — EQUITY
- 4101 Penjualan — REVENUE
- 5101 Harga Pokok Penjualan — EXPENSE
- 6101 Beban Operasional — EXPENSE
- 6201 Beban Gaji — EXPENSE
- 6301 Beban Utilitas — EXPENSE

All start with `sync_status = PROVISIONAL` and no external Accounting account id. They are selectable references only; no journal mapping is inferred automatically.

## Product Accounting Portal

Master Barang may explicitly select:

- sales account reference → REVENUE only;
- inventory account reference → ASSET only;
- COGS/HPP account reference → EXPENSE only.

Database triggers and server validation enforce store scope and account type. Empty references are valid. No default account is silently assigned.

## Future Transaction Mapping

Transaction-level Accounting mapping is intentionally not defined by this contract. It will be added incrementally by explicit user configuration and must emit/consume versioned Accounting bridge contracts rather than writing directly to another program database.

## Compatibility

Existing product endpoints remain available for legacy behavior. The Admin Product Master UI uses the unified Product Master editor endpoint so product core fields and extended product references are handled by one module.

No normal sale/order state machine is changed by this contract.

## DOC-IMPACT

**REQUIRED** — historical v1 retained; current behavior moved to v2.
