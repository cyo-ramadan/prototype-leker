# Accounting Workspace v1

Status: ACTIVE IN FEATURE BRANCH / NOT DEPLOYED
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
- hard delete is not exposed;
- the system account `Penyesuaian` is Accounting-owned, type `EQUITY`, subtype `ROUNDING_ADJUSTMENT`, and is not user-editable.

Prototype-generated user account codes use `ACC-xxxxxx`. Existing bootstrap codes from the Settings foundation remain valid account references and are not renumbered by this contract. The system adjustment account uses reserved code `SYS-ADJ` per store.

## Journal Amount Precision

Canonical Accounting journal precision for IDR in Prototype Leker is **6 decimal places per rupiah**:

- `1 rupiah = 1,000,000 scaled journal units`;
- authoritative persistence uses INTEGER `amountScaled` / SQL `amount_scaled`;
- binary `REAL/FLOAT` is prohibited as a journal source of truth;
- values with more than 6 decimal places are rounded **half-up** at the seventh decimal digit before posting.

Examples:

- `17500.1234564` -> `17500.123456`;
- `17500.1234565` -> `17500.123457`.

Journal-line amounts remain positive. Direction is represented by `DEBIT` or `CREDIT`. **Account/report balances may be negative and must retain their sign.** A negative balance is not itself a journal imbalance.

The legacy API field `amountMinor` remains temporarily as a whole-rupiah compatibility input/read projection for callers that only use integer rupiah. Exact integrations should use `amountScaled` or an exact decimal-string input through the active adapter.

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
- positive exact amount at the 6-decimal Accounting scale;
- optional line description.

Posting gates:

- at least two lines;
- all accounts exist, are active, and belong to the same current store scope;
- duplicate idempotency keys return the existing journal rather than producing a second journal;
- manual journals require exact `total Debit = total Credit` and never receive automatic balancing;
- system/integration journals may request the approved system-adjustment policy below.

Journal numbers are generated server-side as `JRN-xxxxxx`.

## System Adjustment Policy

For non-manual Accounting commands that explicitly request `AUTO_EQUITY_UP_TO_100_RUPIAH`:

- calculate exact scaled Debit/Credit totals after all business lines resolve;
- if the difference is zero, post normally;
- if absolute difference is `<= Rp100.000000`, Accounting adds exactly one system-generated line named `Penyesuaian` to the side that is short;
- the line uses the dedicated Equity account `Penyesuaian`, never the owner's primary Modal account;
- if the difference is greater than `Rp100.000000`, posting fails closed and no journal is written;
- the inserted line carries `isSystemGenerated = true` and becomes immutable with the posted journal.

This tolerance is only for system/integration journal balancing. It must not be used to hide manual-entry mistakes or to force an account balance positive.

## Immutability and Corrections

Posted journal headers and lines are immutable. Update/delete is rejected by database triggers.

Corrections must use an approved reversal/adjustment flow. The storage already carries `reversalOfJournalId`; casual edit/delete is not exposed.

## Read Models

### Data Jurnal

Lists all posted journals from the shared journal store, including:

- source `MANUAL`;
- source `LEKER_POS` when a POS business fact resolves and posts through the bridge;
- future approved Accounting sources.

System-generated `Penyesuaian` lines remain visible and auditable.

### Buku Besar

General Ledger is derived from posted journal lines for one account and period, with:

- opening balance;
- Debit/Credit movement rows;
- normal-side running balance;
- closing balance.

Opening/running/closing balances may be negative and must preserve the sign.

### Rugi Laba

For a requested period:

- Revenue uses credit-normal balances;
- Expense uses debit-normal balances;
- Net Income = Revenue - Expense.

Negative balances remain visible. Transactions outside the requested period must not leak into the report.

### Neraca

As of a requested date:

- Assets;
- Liabilities;
- Equity-account balances;
- current cumulative earnings from Revenue minus Expense through the report date.

The report exposes whether Assets equal Liabilities + Equity + current earnings exactly at the Accounting scale. Individual account balances may be negative.

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
- Negative account balances must not be silently converted to positive display values.
- Manual journals must not use the Rp100 system-adjustment tolerance.

## Implementation

- `migrations/0024_accounting_workspace.sql`
- `migrations/0026_accounting_six_decimal_precision.sql`
- `src/accounting-ledger.js`
- `src/accounting-workspace.js`
- `public/admin-accounting-workspace.js`
- `test/accounting-workspace.test.js`

## DOC-IMPACT

REQUIRED — changes to account lifecycle, journal precision, system adjustment tolerance, immutability, posting command, ledger semantics, or financial-report formulas require contract/ADR/test updates in the same changeset.
