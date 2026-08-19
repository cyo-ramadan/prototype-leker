# Stock, Production, Costing & Product Points Contract v3

Status: ACTIVE for Prototype Leker
Version: 3
Supersedes: `contracts/stock-production-points-v2.md` for manual production execution and production-accounting integration. All unchanged v2 quantity, costing, sale, DADAKAN, and points rules remain active.

## Purpose

This revision defines Production Panel V2 as an editable execution snapshot. Recipe/BOM remains immutable Master data and acts only as a starting template for a production transaction.

## Manual Production V2

The cashier Production panel contains:

1. output product;
2. actual output quantity;
3. Recipe/BOM reference selector;
4. editable material/component rows;
5. actual quantity per material;
6. add/remove material controls.

Selecting a Recipe/BOM copies its current ACTIVE revision into the transaction form. After that copy, the cashier may change actual output quantity, change material quantities, add materials, or remove materials.

Those transaction edits **must not update, rewrite, or create a new Master Recipe revision**. Recipe maintenance remains exclusively in Manufacturing Master.

The selected recipe ID and revision are retained as the transaction's reference/template provenance. `production_run_components` stores the actual consumed component snapshot and `production_runs.total_output_quantity` stores the actual produced output.

`production_runs.template_modified = 1` indicates that the actual one-run execution differs from the selected recipe template. Legacy batch-based manual calls remain accepted for backward compatibility and are expanded from the recipe without changing Master data.

## Warehouse Execution Boundary

The browser reports actual production facts only. It does not calculate stock mutation, HPP, moving-average cost, or journal entries.

The Warehouse production engine owns:

- validating output capability and stock tracking;
- validating that every actual component can be consumed and tracked;
- rejecting duplicate/self-referencing actual materials;
- snapshotting component costs from authoritative scaled `products.average_cost`;
- creating `PRODUCTION_INPUT` stock movements for consumed materials;
- creating `PRODUCTION_OUTPUT` stock movement for produced output;
- preserving the same production run ID across both directions;
- rejecting a complete posting when any material would drive tracked stock below zero;
- calculating `hpp_total_scaled` from actual component cost snapshots;
- calculating `hpp_per_unit_scaled` from actual output quantity;
- updating output product moving-average cost using the production HPP.

`stock_movements` remains the canonical movement history and `inventory_stock_balances` remains the current physical balance source of truth.

## Production HPP

For each actual component:

`total_cost_snapshot_scaled = unit_cost_snapshot_scaled × actual_component_quantity`.

Production total HPP:

`hpp_total_scaled = sum(actual component total_cost_snapshot_scaled)`.

Production HPP per actual output unit:

`hpp_per_unit_scaled = rounded(hpp_total_scaled / actual_output_quantity)`.

The output product's `average_cost` then follows the existing exact scaled moving-weighted-average rule using the pre-production output stock and the newly produced quantity/HPP.

Master Recipe quantities do not control HPP once the execution form is edited. HPP always follows the posted actual component quantities and their immutable cost snapshots.

## Accounting Product-Kind Snapshot

Manual Production V2 snapshots the output Product Kind and each component Product Kind into the production run/component rows. These snapshots are immutable transaction evidence for the Warehouse -> Accounting bridge and prevent later Product Master classification changes from altering the meaning of an already-posted production fact.

## Warehouse -> Accounting Bridge

Production is a Warehouse business fact. Warehouse does not decide journal account mapping directly.

After the production stock batch commits, the Warehouse Production Accounting Bridge consumes the production fact through Accounting Settings transaction category `wh_production`.

Accounting Settings must contain exactly the canonical production inventory rules:

- Debit `item_category_inventory` for output/finished inventory;
- Credit `item_category_inventory` for input/material inventory.

The bridge resolves the account IDs from the snapshotted Product Kinds through `item_categories`.

### Same inventory account

When the output and all consumed components resolve to the same inventory account, the production does not change the Chart of Accounts balance. The bridge records a successful `POSTED` delivery with accounting change `NONE_SAME_INVENTORY_ACCOUNT` and creates no empty journal.

### Different inventory accounts

For every component whose inventory account differs from the output inventory account:

- Credit that component inventory account by its actual cost snapshot;
- Debit the output inventory account by the sum of all costs transferred from different inventory accounts.

Components already mapped to the same account as the output create no debit/credit noise because their value remains inside the same account.

Multiple input inventory accounts are aggregated deterministically by account ID.

### Missing configuration

Missing Product Kind, missing Item Category inventory mapping, or invalid `wh_production` rules do not silently guess an account. Production stock remains committed and the Accounting delivery is recorded as `NEEDS_CONFIGURATION` for explicit correction/retry.

## Atomicity and Post-Commit Integration

The Warehouse stock mutation, production snapshots, output HPP update, and stock movements are one D1 batch and roll back together on failure.

Accounting is a separate post-commit integration step. It is idempotent by production run ID through `accounting_bridge_deliveries` and Accounting journal idempotency key `LEKER_WAREHOUSE:PRODUCTION:<productionRunId>`.

## Backward Compatibility

- AUTO_DADAKAN continues to use the existing canonical recipe execution engine.
- Existing legacy manual clients that send `outputProductId + batches` remain accepted and are expanded from the active Recipe/BOM.
- Existing production rows remain readable.
- Legacy REAL production cost columns remain read compatibility only; new costing remains exact scaled INTEGER.

## DOC-IMPACT

**REQUIRED** — this revision changes authoritative manual-production execution semantics and activates the Warehouse -> Accounting production fact boundary.
