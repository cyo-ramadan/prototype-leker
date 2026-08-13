# Accounting Workspace v1

Status: ACTIVE IN STACKED DRAFT / NOT DEPLOYED
Contract identifier: `MAXI_ACCOUNTING_WORKSPACE_V1`
Canonical target: `@maxi/accounting@1.3.0`

## Purpose

Provide the actual Accounting work area for Prototype Leker while preserving MAXI module ownership and a clear future adapter path to the shared Accounting program.

`Akuntansi` and `Setting Akuntansi` are separate capabilities:

- **Akuntansi** owns account maintenance, journal posting, journal history, general ledger, Profit & Loss, and Balance Sheet.
- **Setting Akuntansi** owns mapping configuration only. It selects Accounting-owned accounts for payment, item-category, and transaction rules.

## Account Master

Accounting is the only UI/API in this stack that may create or maintain accounts.

Rules:

- account IDs are stable TEXT identifiers;
- account codes are generated server-side and unique per current Prototype store scope;
- users do not type or edit the generated code;
- account type is fixed after creation in v1;
- active accounts referenced by active Accounting Settings cannot be deactivated until the mapping is moved or disabled;
- hard delete is not exposed.

Prototype-generated codes use `ACC-xxxxxx`. Existing bootstrap codes from the Settings foundation remain valid account references and are not renumbered by this contract.

## Journal Posting

All posted journals, whether manual or system-produced, use the same Accounting journal store and posting entry point.

Required header facts:

- business date;
- occurred-at timestamp;
- source system;
- source reference ID;
- correlation ID;
- idempotency key;
- description;
- currency code `IDR`.

Required line facts:

- Accounting-owned account ID;
- `DEBIT` or `CREDIT`;
- positive exact `amountMinor` INTEGER;
- optional line description.

Posting gates:

- at least two lines;
- all accounts exist, are active, and belong to the same current store scope;
- total Debit equals total Credit exactly;
- duplicate idempotency keys return the existing journal rather than producing a second journal.

Journal numbers are generated server-side as `JRN-xxxxxx`.

## Immutability and Corrections

Posted journal headers and lines are immutable. Update/delete is rejected by database triggers.

Corrections must use a future approved reversal/adjustment flow. The storage already carries `reversalOfJournalId`; v1 does not expose a casual edit/delete workflow.

## Read Models

### Data Jurnal

Lists all posted journals from the shared journal store, including:

- source `MANUAL`;
- source `LEKER_POS` when a POS business fact resolves and posts through the bridge;
- future approved Accounting sources.

### Buku Besar

General Ledger is derived from posted journal lines for one account and period, with:

- opening balance;
- Debit/Credit movement rows;
- normal-side running balance;
- closing balance.

### Rugi Laba

For a requested period:

- Revenue uses credit-normal balances;
- Expense uses debit-normal balances;
- Net Income = Revenue - Expense.

Transactions outside the requested period must not leak into the report.

### Neraca

As of a requested date:

- Assets;
- Liabilities;
- Equity-account balances;
- current cumulative earnings from Revenue minus Expense through the report date.

The report exposes whether Assets equal Liabilities + Equity + current earnings.

## Composition Boundary

This implementation is a **Prototype Leker composition host**, not a claim that the shared Accounting service is deployed.

Current internal persistence is store-scoped because Prototype Leker is store-scoped. Public/module boundaries remain designed so the host can later adapt to canonical `tenantId` and shared Accounting APIs/events without making POS own Accounting logic.

## Prohibited Behavior

- POS must not insert directly into Accounting journal tables.
- Warehouse must not insert directly into Accounting journal tables.
- Setting Akuntansi must not create/post journals.
- POS/Settings must not send final account/debit-credit posting decisions as business facts.
- New financial source-of-truth fields must not use binary `REAL/FLOAT`.
- Reports must not read POS sales/purchases directly as a substitute for posted journals.

## Implementation

- `migrations/0024_accounting_workspace.sql`
- `src/accounting-ledger.js`
- `src/accounting-workspace.js`
- `public/admin-accounting-workspace.js`
- `test/accounting-workspace.test.js`

## DOC-IMPACT

REQUIRED — changes to account lifecycle, journal immutability, posting command, ledger semantics, or financial-report formulas require contract/ADR/test updates in the same changeset.
