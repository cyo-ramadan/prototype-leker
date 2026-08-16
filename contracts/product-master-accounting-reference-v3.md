# Product Master & Accounting Reference Contract v3

Status: ACTIVE for Prototype Leker
Version: 3
Supersedes: `contracts/product-master-accounting-reference-v2.md` only for purchase-price ownership; all unaffected v2 rules remain active.

## Purchase-price sources

The Product Master exposes three separate cost concepts:

- `purchase_price`: editable integer-rupiah default owned by Master Barang;
- `last_purchase_price`: read-only scaled INTEGER derived from the latest itemized purchase transaction;
- `average_cost`: read-only scaled INTEGER and the current running HPP source.

Editing `purchase_price` must not rewrite `last_purchase_price`, `last_purchase_at`, `average_cost`, purchase snapshots, sale HPP snapshots, or production cost snapshots.

Purchase posting and purchase correction update transaction-owned cost fields only. They must not overwrite the editable master `purchase_price`.

## Cashier default

The current cashier purchase composer reads `purchase_price` as its default Harga Beli. The field remains editable before the line is added. A future explicit source selector may choose `last_purchase_price`, but no automatic switch is active in v3.

When `last_purchase_at` is null, the management UI may display Harga Beli Terakhir using `purchase_price` as a clearly described temporary fallback. The stored `last_purchase_price` remains transaction-owned, so the system does not fabricate purchase history.

## Existing data

Migration `0032_master_purchase_price.sql` bootstraps `purchase_price` only when it is zero and a non-zero `last_purchase_price` with `last_purchase_at` proves an actual purchase exists.

## Unchanged boundaries

- `average_cost` remains the HPP source.
- Accounting owns journal interpretation and posting.
- Inventory owns stock and costing mutation.
- Product Kind, base-unit safety, recipe linkage, exact scaled-cost representation, and transaction snapshots continue to follow v2.

## DOC-IMPACT

**REQUIRED** — this version records the newly approved separation between editable Master Harga Beli and automatic transaction-owned cost values.
