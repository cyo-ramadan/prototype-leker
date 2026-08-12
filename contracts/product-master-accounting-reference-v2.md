# Product Master & Accounting Reference Contract v2

Status: ACTIVE for Prototype Leker
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

Physical stock quantities remain integer values in the product's smallest selected base unit.

A base unit cannot be changed after recipe history, stock movement history, or a non-zero stock balance exists. Unit conversion requires a separate migration contract.

## Automatic Purchase Costing

A purchase that affects inventory is itemized by:

- product;
- integer quantity in base unit;
- exact line total;
- unit cost derived from line total / quantity.

Purchase posting atomically creates the purchase fact, item snapshots, stock-in movement, stock balance update, Accounting connector snapshot, and product costing update.

For each purchased product:

- `last_purchase_price = line_total / purchased_quantity`;
- if current stock quantity is zero or less, `average_cost = last_purchase_price`;
- otherwise moving average cost is `(old_stock_quantity × old_average_cost + line_total) / (old_stock_quantity + purchased_quantity)`.

Purchase rows snapshot `average_cost_before` and `average_cost_after`.

Legacy `products.purchase_price` is retained only for compatibility and mirrors a rounded latest purchase price. It is not the HPP source of truth.

## HPP Source of Truth

`products.average_cost` is the current running HPP source for stock valuation snapshots in this prototype.

Sale items snapshot the product average cost and line COGS when the sale posts. Later changes to Product Master cost do not rewrite historical sale HPP.

Production components snapshot their current product average cost. The production run derives total HPP and HPP per output unit from those component snapshots. The output product then receives a moving-average update using its existing stock and the cost of newly produced output.

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
- existing Product Master and transaction routes remain store-scoped and management/cashier authenticated as applicable.
- no direct write to another program database is introduced.

## DOC-IMPACT

**REQUIRED** — this contract, ADR-015, migration `0019_product_costing_and_kinds.sql`, Product Master/Purchase/Production code, and regression tests form one change set.
