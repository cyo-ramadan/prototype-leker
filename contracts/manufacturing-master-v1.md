# Manufacturing Master Contract v1

Status: ACTIVE for Prototype Leker
Version: 1

## Ownership

Prototype Leker owns operational product classification and recipe/BOM master data for the store scope.

This contract does not own inventory costing, accounting journals, production posting, or financial statements.

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

## Unit

Canonical entity: `units`.

A product has one `base_unit_id`. Recipe V1 records quantities in the product base unit with up to three decimal places using scaled integer storage (`quantity_milli`).

Default units are PCS, GRAM, KG, ML, and LITER.

Unit conversion and packaging conversion are intentionally outside V1. A later version must define conversion semantics before recipes mix different measurement units for the same product.

## Product Classification

`products.item_type_id` and `products.base_unit_id` classify each product.

Existing products are backfilled as Barang Jadi + PCS for backward compatibility. New products receive the same defaults automatically at database level.

Item type and unit references must belong to the same store as the product. Cross-store references are rejected at database level.

## Recipe / BOM

Canonical entities:

- `manufacturing_recipes`
- `manufacturing_recipe_components`

A recipe contains:

- one output product;
- output quantity;
- output base unit snapshot;
- one or more component products;
- quantity for every component;
- component base unit snapshot;
- revision number;
- status ACTIVE or ARCHIVED;
- creator and timestamp metadata.

Only one ACTIVE recipe may exist for one output product in one store.

Updating a recipe creates a new immutable revision and archives the previous ACTIVE revision. Historical revisions are never rewritten.

Direct self-reference and circular BOM graphs are rejected.

## Manufacturing and HPP Boundary

Recipe master provides the quantity structure required by future production and HPP calculation.

Production posting must later snapshot the exact recipe revision used, actual output quantity, actual component consumption, waste/yield variance, and inventory costing references.

HPP must not be calculated by blindly reading the latest `products.purchase_price`. Cost valuation belongs to the Inventory/Costing domain and accounting interpretation belongs to Accounting.

## Performance

Manufacturing data is loaded only when the Admin Manufaktur tab is opened. Recipe components are fetched in one grouped query for the selected recipe set. No periodic polling is introduced.
