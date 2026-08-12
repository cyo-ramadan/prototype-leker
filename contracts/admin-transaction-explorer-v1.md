# Admin Transaction Explorer Contract v1

Status: ACTIVE for Prototype Leker
Version: 1

## Purpose

The Admin transaction explorer is an operational read model. It gives Admin Gerai and Owner one place to track business transactions without moving ownership away from the source modules.

## Included Facts

V1 surfaces:

- SALE
- PURCHASE
- EXPENSE
- OTHER_INCOME
- CASH_FLOW approval/posting facts
- GOODS_FLOW approval/posting facts
- ASSET approval/posting facts

Future production, stock-adjustment, transfer, payroll, deposit, and other transaction types must be added as explicit fact kinds instead of being disguised as one of the existing kinds.

## Source Ownership

The explorer never becomes the source of truth for a transaction. Each row keeps a `sourceReference` containing source type and source id.

The source tables/modules remain authoritative.

## Accounting Boundary

Admin exposes an Accounting bridge reference only:

- contract name;
- source program;
- fact type;
- stable fact id;
- eligibility;
- sync status;
- optional journal reference after integration exists.

Admin must not create or edit journal debit/credit lines, chart-of-accounts mapping, general ledger balances, trial balance, balance sheet, income statement, or accounting closing logic.

Those behaviors belong to the Accounting program.

## Pagination and Performance

The explorer is lazy-loaded only when its Admin tab is opened.

Pagination uses a deterministic composite cursor of `occurredAt + id`, ordered descending. This prevents rows with identical timestamps from being skipped between pages.

Maximum page size is 100 and the default page size is 50. No periodic polling is introduced.
