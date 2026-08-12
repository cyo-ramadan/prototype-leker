# Stock, Production & Product Points Contract v1

Status: SUPERSEDED by `contracts/stock-production-points-v2.md`
Version: 1

> Historical contract retained for audit history. Current costing and fulfillment ownership boundaries are defined by v2 and ADR-015.

## Purpose

This contract defines how product stock, recipe-linked production, product points, and sale fulfillment interact without moving Accounting ownership into Prototype Leker.

## Quantity Invariant

All physical quantities are integers in each product's base unit.

If a business quantity would otherwise be fractional, Master Satuan must use a smaller base unit. Costing and HPP values are monetary calculations and may use decimal precision.

## Product Policy

Master Barang owns these operational policies:

- `points_per_unit`;
- `stock_tracking_enabled`;
- `production_mode`: `STOCK` or `DADAKAN`;
- `recipe_link_enabled`.

`DADAKAN` is valid only when:

- the output product has an ACTIVE recipe;
- recipe link is enabled;
- the output product is stock-tracked;
- every recipe component is stock-tracked.

Existing legacy products start with stock tracking disabled because reliable historical opening stock is not available. Admin can explicitly enable tracking after stock is initialized.

## Stock Source of Truth

Current quantity is held in `inventory_stock_balances`.

Canonical human-auditable movement history is `stock_movements`.

Every movement snapshots:

- product and base unit;
- direction and integer quantity;
- source type and source id;
- drawer where applicable;
- actor and timestamp.

Movement `source_key` is unique to prevent duplicate posting.

Supported source types include sale, approved goods flow, production input, and production output. Future stock adjustment and purchase posting must use the same movement contract.

A tracked stock balance may not become negative. Any database constraint failure rolls back the complete posting batch.

## STOCK Sale Mode

A STOCK-mode sale does not auto-produce.

If stock tracking is enabled, the sale deducts the sold quantity from existing stock. Insufficient quantity rejects the whole sale.

Legacy products whose stock tracking remains disabled preserve previous sale behavior until Admin explicitly activates tracking.

## DADAKAN Sale Mode

When a sale line is DADAKAN and recipe-linked:

1. Snapshot the currently ACTIVE recipe id and revision.
2. Calculate the minimum integer batch count needed to satisfy sale quantity.
3. Create one `AUTO_DADAKAN` production run.
4. Deduct each tracked recipe component according to `quantity_per_batch × batches`.
5. Add the full produced output quantity.
6. Deduct the sale quantity from output stock.
7. Persist sale item recipe/production references.
8. Persist customer points when an identified customer exists.
9. Persist the normal sale/order lifecycle.

These statements execute inside the same D1 batch as the sale. Failure in component stock, output stock, sale, points, or tracking rolls back everything.

Batch output may exceed the requested sale quantity. The remainder stays as output stock.

## Manual Production

The cashier Produksi action uses the same production engine and recipe snapshots as DADAKAN sales.

Manual production is drawer-authenticated and creates a `MANUAL` production run. It deducts components and adds output in one atomic batch.

No duplicate BOM or stock calculation is allowed in the UI layer.

## Product Points

`points_per_unit` is an integer Master Barang value.

A sale snapshots:

- `points_per_unit` per sale item;
- `line_points`;
- `sales.total_points`.

Points are credited only when the sale is linked to a valid `customer_id`. Customer mobile orders already carry customer identity. Direct cashier sales use lazy customer search to select a customer identity.

The customer point ledger uses one unique SALE/EARN record per customer and sale to prevent duplicate credit.

## HPP / Costing Seam

Production runs reserve nullable decimal fields:

- `hpp_total`;
- `hpp_per_unit`;
- component `unit_cost_snapshot`;
- component `total_cost_snapshot`.

V1 does not invent a costing method. FIFO, average cost, standard cost, purchase landed cost, waste/yield valuation, and journal mapping must be defined by the future Inventory/Costing + Accounting integration.

Prototype Leker may emit a `PRODUCTION_POSTED` Accounting business fact, while Accounting retains ownership of journal interpretation.

## Admin Read Models

Admin provides separate operational panels:

- **Master**: Barang, Kategori, Supplier, Pelanggan, Kasir/Staf, Tipe Barang, Satuan, Recipe/BOM;
- **Stok**: current balance and lazy movement history;
- **Transaksi**: bounded transaction facts plus lazy detail.

Historical transaction detail is immutable and may display the exact recipe revision used. It must never edit current recipe linkage.

## Performance

- Customer lookup is lazy and capped at 10 results.
- Stock movements and transaction lists use bounded cursor pagination.
- Transaction detail is fetched only on click.
- No periodic polling is introduced.

## DOC-IMPACT

**REQUIRED** — historical v1 retained; current behavior moved to v2.
