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
- PRODUCTION posted facts
- ASSET approval/posting facts
- ADMIN_PAYMENT payments made by management, including BANK and REKBER
- ADMIN_EXPENSE operational expenses made by management; direct-payment expenses linked to ADMIN_PAYMENT appear once through the payment fact

Future stock-adjustment, transfer, payroll, deposit, and other transaction types must be added as explicit fact kinds instead of being disguised as an existing kind.

## Source Ownership

The explorer never becomes the source of truth for a transaction. Each row keeps a `sourceReference` containing source type and source id.

The source tables/modules remain authoritative.

## Lazy Detail Contract

The transaction list contains only bounded summary facts. Detail payloads are fetched only after the Admin selects **Detail**.

SALE detail may expose:

- sale header and source order;
- customer identity and points snapshot;
- sale-item quantity and price snapshots;
- recipe revision used;
- production-run reference;
- production component/output snapshots;
- Accounting bridge reference.

PRODUCTION detail may expose:

- manual vs AUTO_DADAKAN mode;
- exact recipe id and revision;
- batch count;
- integer component consumption;
- integer output quantity;
- nullable decimal HPP/cost snapshots;
- source sale/order references when applicable.

Historical detail is read-only. It must never mutate current Master Barang policy or recipe links.

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

Maximum page size is 100 and the default page size is 50. Detail is a separate request and no periodic polling is introduced.


## Admin and Cashier Filters

Admin Transaksi follows the Data Kasir table/card layout, search, page sizes (5/20/50/100), and sorting of loaded rows. Admin starts with all historical dates and may set an optional WIB date range or return to **Semua waktu**. No active drawer or attendance is required for management reads.

Both views accept `createdBy=ROLE:id` and expose `createdBy` plus `creatorName` per row. Role is part of the identity: an Admin and Cashier with the same ID remain distinct. Creator options cover the authorized store's full history, independent of the current page and filters. Clients load those options once when opening the view (and on Admin Refresh), then send `includeCreators=0` for filter/page changes to avoid repeating the full-history query.

Admin accepts the cashier's Tunai, QRIS (including mixed QRIS portions), and Campuran filters, plus Rekening and individual configured methods. Rekening means BANK/REKBER or a POS method linked to a shared account. These filters combine with type, creator, search, and dates. Admin-only source facts never appear through the Cashier list/detail endpoints.

Admin source details read their original records. They do not invent a POS Accounting delivery or alter any source record, journal, or account. The list includes voided rows with a read-only label.

<!-- DOC-IMPACT: 2026-10-20 Admin Transaksi follows Data Kasir, adds management bank facts, all-time/WIB date selection, payment and creator filters; no migrations or journal mutations. -->
