# Accounting Bridge Seam v1

Status: PREPARED / NOT_CONNECTED
Contract identifier: `MAXI_ACCOUNTING_BUSINESS_FACT_V1`

## Goal

Prepare a stable integration seam from Prototype Leker to the separate Accounting program without implementing Accounting behavior inside Prototype Leker.

## Prototype Leker Responsibility

Prototype Leker owns operational business facts and stable source references, including sales, purchases, expenses, other income, posted cash flow, posted inventory movement, and posted asset movement.

An eligible fact may expose:

- `sourceProgram`
- `factType`
- `factId`
- `sourceReference`
- transaction timestamp
- business amount/quantity snapshot available from the source domain
- integration eligibility
- sync status
- optional `journalReference` after a real integration exists

## Accounting Responsibility

The Accounting program owns:

- journal interpretation;
- debit and credit lines;
- chart of accounts;
- account mapping;
- general ledger / buku besar;
- trial balance / neraca saldo;
- balance sheet / neraca;
- income statement / laba rugi;
- period closing and accounting adjustments.

Prototype Leker must never write directly to the Accounting database.

## Current State

The code adapter `src/accounting-bridge-seam.js` returns `NOT_CONNECTED` for eligible posted facts and `NOT_POSTABLE` for facts that have not reached a postable operational state.

No network call, journal write, account mapping, or accounting fallback is active in V1.

When the Accounting or Integration Bridge contract is finalized, this seam can be adapted without changing the Admin transaction explorer's source-reference model.
