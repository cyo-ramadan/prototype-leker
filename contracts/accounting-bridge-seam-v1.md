# Accounting Bridge Seam v1

Status: SUPERSEDED by `contracts/accounting-pos-bridge-v1.md` and `contracts/accounting-workspace-v1.md`
Contract identifier: `MAXI_ACCOUNTING_BUSINESS_FACT_V1`

## Historical Goal

This contract prepared a stable integration seam from Prototype Leker to a separate Accounting program before an Accounting work module or active POS-to-Accounting bridge existed in Prototype Leker.

## Historical Prototype Leker Responsibility

Prototype Leker owned operational business facts and stable source references, including sales, purchases, expenses, other income, posted cash flow, posted inventory movement, and posted asset movement.

An eligible fact could expose:

- `sourceProgram`
- `factType`
- `factId`
- `sourceReference`
- transaction timestamp
- business amount/quantity snapshot available from the source domain
- integration eligibility
- sync status
- optional `journalReference` after a real integration existed

## Accounting Responsibility

Accounting ownership remains valid:

- journal interpretation;
- debit and credit lines;
- chart of accounts;
- account mapping interpretation;
- general ledger / buku besar;
- trial balance / neraca saldo;
- balance sheet / neraca;
- income statement / laba rugi;
- period closing and accounting adjustments.

Business applications must not write directly to another program's Accounting database.

## Why Superseded

The active stacked draft now contains:

- an actual Accounting composition host in Prototype Leker for account/journal/ledger/report work;
- a separate Setting Akuntansi mapping registry;
- an Integration Bridge that resolves committed POS business facts through Settings and calls the Accounting posting boundary;
- delivery/reconciliation states and journal references.

The old `NOT_CONNECTED`-only behavior is therefore historical and must not be treated as the current contract for SALE/PURCHASE/EXPENSE.

Use:

- `MAXI_ACCOUNTING_WORKSPACE_V1` for Accounting work;
- `MAXI_ACCOUNTING_POS_BRIDGE_V1` for current POS bridge behavior.

The legacy helper `src/accounting-bridge-seam.js` remains only for operational fact kinds that have not yet been migrated to the active bridge.
