# Manufacturing Master Contract v1

Status: ACTIVE for Prototype Leker
Version: 1

## Ownership

Prototype Leker owns operational product classification and recipe/BOM master data for the store scope.

Inventory movement and production execution are defined separately by the Stock, Production & Points Contract. Accounting journal interpretation remains owned by the separate Accounting program.

## Item Type

Canonical entity: `item_types`.

Each type carries explicit capabilities:

- `can_sell`
- `can_purchase`
- `can_produce`
- `can_consume`
- `track_stock`
- `is_active`

Default store types:

- `FINISHED_GOOD` / Barang Jadi
- `RAW_MATERIAL` / Bahan
- `SEMI_FINISHED` / Bahan Setengah Jadi

`RAW_MATERIAL` defaults to `can_sell = false`.

Product menu/order/sale reads must respect `can_sell`. Database guards also reject new sale/order lines for a product whose type is not sellable.

## Unit and Integer Quantity Invariant

Canonical entity: `units`.

A product has one `base_unit_id`. All physical quantities in product stock, recipe output, recipe component usage, production output, production consumption, sale quantity, and stock movement are stored as **positive integers** in that base unit.

Fractional physical quantities are not represented with decimal quantity fields. The master must choose a sufficiently small base unit so the operational quantity becomes an integer. Example: use GRAM instead of 1.5 KG when the business needs 1500 GRAM.

Default units are PCS, GRAM, KG, ML, and LITER. Additional smaller operational units may be created when needed.

Unit conversion and packaging conversion are intentionally outside V1. A later version must define conversion semantics before one product can transact in multiple physical units.

Costing/HPP values are a separate monetary calculation and may use decimal precision.

## Product Classification

`products.item_type_id` and `products.base_unit_id` classify each product.

Existing products are backfilled as Barang Jadi + PCS for backward compatibility. New products receive the same classification defaults automatically at database level.

Item type and unit references must belong to the same store as the product. Cross-store references are rejected at database level.

## Recipe / BOM

Canonical entities:

- `manufacturing_recipes`
- `manufacturing_recipe_components`

A recipe contains:

- one output product;
- integer output quantity in the output product base unit;
- output base unit snapshot;
- one or more component products;
- integer quantity for every component in each component base unit;
- component base unit snapshot;
- revision number;
- status ACTIVE or ARCHIVED;
- creator and timestamp metadata.

Only one ACTIVE recipe may exist for one output product in one store.

Updating a recipe creates a new immutable revision and archives the previous ACTIVE revision. Historical revisions are never rewritten.

Direct self-reference and circular BOM graphs are rejected.

## Product Link Boundary

A recipe remains a standalone master revision. Whether an active recipe is automatically used by sales is a **Master Barang policy**, not a property of a historical transaction.

Historical transactions may only reference the exact recipe revision and production run that were used. A transaction detail view must never edit the recipe link.

## HPP Boundary

Recipe master supplies physical quantity structure. Production execution snapshots the exact recipe revision and component/output quantities.

HPP fields may use decimal precision. Current production snapshots reserve decimal HPP/cost fields, while valuation logic remains a future Inventory/Costing integration concern. Accounting interpretation remains owned by Accounting.

HPP must not be calculated by blindly reading the latest `products.purchase_price`.

## Performance

Master data is loaded only when the relevant Master section is opened. Recipe components are fetched in grouped queries rather than one request per row. No periodic polling is introduced.
