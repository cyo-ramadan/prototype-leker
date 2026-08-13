# Warehouse Settings Contract v1

Status: ACTIVE for Prototype Leker draft implementation
Contract: `MAXI_WAREHOUSE_SETTINGS_V1`

## Purpose

Warehouse Settings owns store-scoped operational configuration for warehouse/location masters, warehouse access rights, and stock-opname parameters.

It does not own Accounting account mapping. Any warehouse transaction that may affect financial value is registered as a row in Accounting Settings `transaction_categories` and configured through Accounting Settings `journal_rules`.

## Owned Tables

### `warehouses`

A store-scoped warehouse/location master:

- stable `TEXT` ID;
- store ID;
- code and name;
- location label;
- active state;
- timestamps.

### `warehouse_access`

Access configuration per warehouse and staff principal:

- principal type `ADMIN | CASHIER`;
- stable principal ID plus name snapshot;
- Stock Opname permission;
- Transfer permission;
- Receive permission;
- Issue permission;
- active state.

Principal identity must come from active staff rows in the same store. The browser does not submit free-text staff identity.

### `warehouse_stock_opname_settings`

Operational stock-opname settings:

- exact decimal-text quantity tolerance;
- percentage tolerance stored as basis points (`INTEGER`, 0–10000);
- schedule type `MANUAL | DAILY | WEEKLY | MONTHLY`;
- optional schedule day;
- approval requirement.

Quantity tolerance is configuration metadata and follows the approved fractional-capable canonical quantity direction. It does not by itself alter the current legacy integer inventory ledger.

## Accounting Registration Boundary

Warehouse Settings has **no account-mapping table** and no endpoint that edits Chart of Accounts or Journal Rules directly.

Module B registers warehouse transaction types by inserting rows into Module A `transaction_categories` with `registered_by_module = WAREHOUSE`.

Registered categories:

- `wh_transfer` — Transfer Antar Gudang;
- `wh_opname` — Stock Opname;
- `wh_production` — Pemakaian Produksi / BOM;
- `wh_return` — Retur Gudang.

The Warehouse UI displays these registrations read-only and directs rule editing to Accounting Settings.

## Default Warehouse Rule Configuration

Default rows are configuration data only; they do not post journals.

### Transfer Antar Gudang

- Debit: `item_category_inventory` — Persediaan gudang tujuan.
- Credit: `item_category_inventory` — Persediaan gudang asal.

A future journal-generation engine must resolve source/destination warehouse context explicitly. This contract does not infer account dimensions or amounts.

### Stock Opname

Two business-direction patterns are represented by labeled rule rows:

Gain:
- Debit: `item_category_inventory` — Persediaan.
- Credit: fixed account `4201 Pendapatan Koreksi Stok`.

Loss:
- Debit: fixed account `6103 Beban Susut Persediaan`.
- Credit: `item_category_inventory` — Persediaan.

Both adjustment accounts are marked for owner review. A future posting engine must choose the correct gain/loss branch from the actual signed stock adjustment; it must not execute all four lines blindly.

### Production / BOM

- Debit: `item_category_inventory` — Persediaan hasil produksi.
- Credit: `item_category_inventory` — Persediaan bahan/BOM.

Future posting must resolve the relevant output and component Item Categories from production facts.

### Retur

`wh_return` is registered but deliberately receives no default journal rule. Return-to-supplier, customer return, internal return, and other directions can have different accounting meaning. The configuration therefore remains fail-closed until the owner chooses the specific return subtypes/rules.

## UI

Warehouse Settings provides:

1. warehouse/location list plus add/edit/deactivate;
2. explicit staff access settings per warehouse;
3. Stock Opname quantity/percentage tolerance and schedule settings;
4. read-only list of Warehouse transaction categories registered in Accounting Settings.

No account selector or journal rule editor exists in Module B.

## Explicitly Out of Scope

- warehouse stock movement execution;
- stock transfer transaction implementation;
- stock-opname counting/posting workflow;
- automatic journal generation;
- direct Account Mapping in Warehouse;
- valuation or journal write to another program database.

## Compatibility

The current Prototype Leker stock ledger remains the active operational inventory source. Warehouse Settings adds configuration only. The dedicated migration from legacy integer inventory quantities to the canonical fractional-capable quantity representation remains separate work.

## DOC-IMPACT

**REQUIRED** — migration 0022, `src/warehouse-settings.js`, Accounting Settings contract, UI, tests, and ADR-016 form one settings changeset.
