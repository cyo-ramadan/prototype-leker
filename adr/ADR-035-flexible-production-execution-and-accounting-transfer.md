# ADR-030 — Flexible Production Execution and Inventory-Account Transfer

Status: ACCEPTED
Date: 2026-08-18

## Context

The first manual Production UI only allowed an output product and batch count derived from the linked Recipe/BOM. That made the transaction form behave as if Master Recipe were an execution constraint.

Bos Cyo clarified the operational requirement:

- Recipe/BOM is an execution reference/template;
- real production may use a different output quantity;
- real production may change material quantities;
- materials may be added or removed for the actual run;
- transaction edits must not mutate Master Recipe;
- actual component consumption must reduce stock and actual output must increase stock;
- HPP of the output must follow the actual quantities and current authoritative HPP of consumed materials;
- Accounting should transfer inventory value from material inventory accounts to finished-goods inventory accounts only when those accounts are actually different;
- when the business uses one common inventory account for both materials and finished goods, production creates no net Accounting account movement.

The existing repository already has canonical exact scaled costing, `stock_movements`, Warehouse transaction category `wh_production`, Product Kind -> inventory-account mappings, Accounting journal posting, and a post-commit Integration Bridge pattern. The missing piece is flexible manual execution and the production-specific bridge resolver.

## Decision

### Recipe remains immutable Master data

Production Panel V2 loads an ACTIVE Recipe/BOM as a template and copies its quantities into an editable transaction form.

The production transaction stores the selected recipe revision as provenance and stores actual component/output quantities in production snapshot tables. No Production endpoint updates `manufacturing_recipes` or `manufacturing_recipe_components`.

### Warehouse owns actual stock and costing execution

`src/warehouse-production.js` owns manual-production execution facts and uses the canonical Prototype Leker inventory tables.

The browser submits actual output and component quantities. It does not calculate HPP, stock balances, or journal lines.

The Warehouse execution batch:

1. validates output/material capabilities and stock tracking;
2. snapshots actual components and exact scaled costs;
3. posts `PRODUCTION_INPUT` stock-out movements;
4. calculates actual `hpp_total_scaled` and `hpp_per_unit_scaled`;
5. updates output moving-average cost;
6. posts `PRODUCTION_OUTPUT` stock-in movement.

Tracked negative stock rejects and rolls back the complete production batch.

### Accounting receives an immutable production fact

Migration 0039 snapshots Product Kind identity on the output run and each actual component. This prevents later Master Barang reclassification from changing the accounting meaning of an already-posted production fact.

After Warehouse commit, `src/accounting-warehouse-production-bridge.js` resolves `wh_production` through Accounting Settings and posts through the Accounting journal API/module function.

Warehouse never hardcodes Chart of Account IDs.

### Inventory-account change is net-based

The Accounting bridge compares every component inventory account to the output inventory account.

- Same account: that component value stays inside the same account and produces no journal line.
- Different account: Credit component inventory account and Debit output inventory account by that component's exact scaled cost.
- Multiple distinct component accounts are aggregated by account.
- If all components use the same inventory account as the output, no journal is created and the delivery is recorded as successfully processed with `NONE_SAME_INVENTORY_ACCOUNT`.

This avoids meaningless Debit/Credit pairs to the same account while preserving exact inventory value transfer when the business distinguishes material and finished-goods inventory accounts.

### Accounting is post-commit and fail-closed

Production stock/cost facts remain committed even when Accounting configuration is incomplete. The Accounting delivery records `NEEDS_CONFIGURATION`; it does not guess Product Kind or account mappings.

Journal delivery and journal posting are idempotent by production run ID.

## Consequences

- Real production can differ from recipe without corrupting Recipe Master.
- Production HPP reflects actual consumed quantities.
- Stock history exposes production input/output with the same production run ID.
- Businesses with separate material/finished inventory accounts receive an inventory-value transfer journal.
- Businesses with one shared inventory account receive no artificial accounting movement.
- Product Kind mappings must be configured to obtain automatic production journals.
- Legacy batch-style manual calls remain compatible.
- AUTO_DADAKAN remains on the existing recipe execution path and is not redesigned by this change.

## Alternatives Rejected

### Edit Master Recipe from the production transaction

Rejected because a one-off real-world deviation would rewrite reusable Master data and historical meaning.

### Calculate HPP in browser JavaScript

Rejected because costing and inventory valuation belong to the server-side Inventory/Warehouse execution boundary.

### Always Debit and Credit the same inventory account

Rejected because it creates accounting noise with zero economic account movement.

### Let Warehouse choose account IDs

Rejected because Accounting owns journal interpretation and account mapping.

## Compatibility and Recovery

Migration 0039 is additive. Existing rows receive `template_modified = 0` and nullable/empty Product Kind snapshots.

Before deployment, rollback is branch/commit revert.

After migration deployment, do not remove the additive columns. Runtime rollback may revert application code while leaving the columns inert. Posted production, stock movements, Accounting deliveries, and journals remain immutable; corrections use existing adjustment/reversal patterns rather than destructive data edits.

## Canonical Contract

See `contracts/stock-production-points-v3.md`.

## DOC-IMPACT

**REQUIRED** — Production execution, Warehouse/Accounting boundary, migration, tests, changelog, and operational audit documentation change together.
