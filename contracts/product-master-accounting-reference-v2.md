# Product Master & Accounting Reference Contract v2

Status: SUPERSEDED IN PART by `product-master-accounting-reference-v3.md`
Version: 2
Supersedes: `contracts/product-master-accounting-reference-v1.md`

## Purpose

This contract defines the current Product Master boundary after the Product Kind and moving-average costing revision.

Master Barang owns product identity and operational references. It does not own journal generation and it no longer owns the future sale fulfillment choice.

## Master Barang Ownership

Master Barang owns:

- name, category, selling price, image, active state;
- `item_type_id`, selected from Master Tipe Barang;
- `product_kind_id`, selected from Master Jenis Barang;
- `base_unit_id`, selected from Master Satuan;
- `points_per_unit` as a non-negative integer;
- `stock_tracking_enabled`;
- `linked_recipe_id`, selected from an ACTIVE recipe whose output is the same product;
- read-only `average_cost`;
- read-only `last_purchase_price`;
- cost timestamps.

`average_cost` and `last_purchase_price` are server-owned values. Client Product Master writes must not set or override them.

## Exact Cost Representation

Monetary transaction totals remain exact integer rupiah in the current Prototype Leker schema.

Unit-cost and HPP values that need sub-rupiah precision are stored as **scaled INTEGER**, never SQLite `REAL/FLOAT`:

- scale = `1,000,000` cost units per rupiah;
- `12500000` scaled cost = `Rp12.5`;
- API/UI presentation divides the stored value by the scale;
- calculations use integer arithmetic with deterministic rounding.

Authoritative scaled fields include product Average Cost / Harga Beli Terakhir, purchase unit-cost snapshots, sale HPP snapshots, and the production `*_scaled` costing fields introduced by migration `0021_exact_production_costing.sql`.

Legacy `REAL` cost columns from migration 0017 remain nullable compatibility columns for old production history. New production writers do not populate them.

## Jenis Barang

`product_kinds` is a store-scoped, user-defined classification master.

Each kind has a stable `code`, editable `name`, and active state. V2 intentionally seeds no business-specific product kinds because Accounting classification must be explicit.

`product_kind_id` is the Product Master classification seam intended for later Accounting rule linkage. Transactions snapshot kind identity so historical facts are not reclassified when the master changes later.

Tipe Barang remains a separate operational capability master. Jenis Barang must not duplicate Tipe Barang capability rules.

## Fulfillment Ownership

Mode Pemenuhan is removed from the Product Master editor and Product Master write API.

The legacy `products.production_mode` column remains temporarily for backward-compatible runtime behavior only. It is exposed as legacy state and must not be treated as the new configuration authority.

A later Sale contract will own transaction-level fulfillment and will define `DADAKAN` as its default. That sale-level migration is intentionally not performed by this contract so existing sale behavior is not changed silently.

## Recipe Link

`linked_recipe_id` remains an explicit Product Master reference.

Rules:

1. The linked recipe must be ACTIVE.
2. It must belong to the same store.
3. Its output product must equal the product being edited.
4. `recipe_link_enabled` remains a compatibility/derived flag.
5. A new product is saved before its recipe can be created and linked.
6. Historical sale/production facts snapshot the exact recipe used.

## Base Unit Safety

Current deployed inventory tables still store physical stock quantities using the legacy integer representation in the product's selected base unit. The approved canonical direction is fractional-capable exact decimal quantity; that storage migration is handled separately so no partial dual source of truth is introduced in this Product Master change.

A base unit cannot be changed after recipe history, stock movement history, or a non-zero stock balance exists. Unit conversion requires a separate migration contract.

## Automatic Purchase Costing

A purchase that affects inventory is itemized by:

- product selected from the active store-scoped Product Master database; free-text product identity is not accepted;
- explicit quantity shown to the cashier;
- exact line total;
- exact scaled unit cost derived from line total / quantity.

The current inventory quantity engine still accepts integer purchase quantities until the canonical fractional-quantity migration replaces the legacy stock representation. The UI and API must not hide the quantity field.

Purchase posting atomically creates the purchase fact, item snapshots, stock-in movement, stock balance update, Accounting connector snapshot, and product costing update.

For each purchased product:

- `last_purchase_price_scaled = round(line_total × COST_SCALE / purchased_quantity)`;
- if current stock quantity is zero or less, `average_cost_scaled = last_purchase_price_scaled`;
- otherwise moving average uses exact scaled integer arithmetic over old stock, old average cost, incoming line total, and incoming quantity.

Purchase rows snapshot scaled `average_cost_before` and `average_cost_after`.

Legacy `products.purchase_price` is retained only for compatibility and mirrors a rounded latest purchase price. It is not the HPP source of truth.

## Operational Expense Quantity

Operational expense entry stores an explicit `quantity` in addition to description and total amount.

The quantity is customer-behaviour metadata and is stored as canonical positive decimal text with up to six decimal places. It does not create an inventory movement by itself. Examples include multiple refills, parking units, service units, or other repeated operational consumption that the user wants to quantify.

`amount` remains the total monetary value of the operational expense. Quantity does not silently multiply or rewrite the total amount.

## HPP Source of Truth

`products.average_cost` is the current running HPP source for stock valuation snapshots in this prototype, stored as scaled INTEGER.

Sale items snapshot the product average cost and scaled line COGS when the sale posts. Later changes to Product Master cost do not rewrite historical sale HPP.

Production components snapshot their current scaled product average cost. The production run derives exact scaled HPP total/unit from those component snapshots. The output product then receives a moving-average update using its existing stock and the cost of newly produced output.

## Accounting Reference Boundary

`MAXI_ACCOUNTING_REFERENCE_V1` remains a connector-only provisional reference surface for the current prototype.

Prototype Leker may persist operational Accounting references and immutable transaction mapping snapshots, but it does not own:

- automatic journal generation;
- general ledger posting;
- trial balance;
- financial statements;
- closing.

Those remain owned by the separate Accounting program.

Product classification (`product_kind_id`) is data prepared for later Accounting rules. V2 does not create product-level debit/credit fields.

## Compatibility

- `products.production_mode` remains in the database only to preserve existing behavior until Sale fulfillment is versioned.
- `products.purchase_price` remains as a compatibility mirror; new Product Master UI treats latest purchase price as read-only.
- legacy production `REAL` costing columns are read-only fallback for historical rows; authoritative new writes use scaled INTEGER fields.
- purchase product identity comes from the active store Product Master; legacy free-text purchase UI is superseded.
- operational expenses default quantity to `1`, so historical rows remain valid after migration 0020.
- existing Product Master and transaction routes remain store-scoped and management/cashier authenticated as applicable.
- no direct write to another program database is introduced.

## DOC-IMPACT

**REQUIRED** — this contract, ADR-015, migrations `0019_product_costing_and_kinds.sql`, `0020_expense_quantity_behavior.sql`, and `0021_exact_production_costing.sql`, Product Master/Purchase/Operational/Production code, and regression tests form one change set.
