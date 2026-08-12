# POS Integration Runbook

## Current state

Prototype Leker owns POS facts only. It references `@maxi/pos-core@1.0.0`, `@maxi/accounting@1.3.0`, and `@maxi/warehouse@2.0.0` through versioned envelopes. It does not copy shared-module source and never writes to another module database.

On a cashier transaction, the POS fact and its outbox rows are committed in one D1 batch. Accounting receives one command candidate per transaction. Warehouse receives one stock-deduction candidate per sale line. Missing mappings create `NEEDS_MAPPING` rows with stable `ACCOUNT_MAPPING_MISSING` or `WAREHOUSE_ITEM_MAPPING_MISSING` codes. No fake journal or stock deduction is produced.

## Leker configuration checklist

1. Apply additive migration `0012_pos_integration_foundation.sql` to a disposable/local database first.
2. In each gerai, set terminal ID and warehouse ID.
3. Review the seeded neutral COA hierarchy; add business-specific groups/subaccounts where required.
4. Select a postable Equity account for retained earnings.
5. Map each transaction type and payment method to distinct active postable debit/credit accounts.
6. Map every active POS product to its canonical warehouse item and deduction quantity.
7. Confirm the Reports panel has no unexpected `NEEDS_MAPPING` rows after a controlled test sale.
8. Connect a dispatcher that claims only `PENDING` outbox rows and calls the shared module contract using the included tenant-scoped idempotency key.
9. Reconcile dispatched IDs against Accounting/Warehouse acknowledgements before marking `DISPATCHED`.

## Recovery

- Application rollback: redeploy commit `0f6f57720bd3c2fceef8348999673d1a408c35c6`. The additive tables may remain unused.
- Database rollback: prefer Cloudflare D1 Time Travel/backup. Do not manually drop integration tables after messages have been dispatched.
- Dispatcher incident: stop claiming new `PENDING` rows; do not delete outbox records. Retry with the same idempotency key.
- Mapping correction: fix the mapping, then explicitly requeue affected `NEEDS_MAPPING` rows in a reviewed maintenance operation. Automatic guessing is prohibited.

## Known limitations

- No dispatcher or remote module binding is enabled in this repository yet; the bridge is connection-ready, not live-connected.
- No Cloudflare live migration/deploy was performed.
- Split tender, refund/void authorization, tax, discount, recipe/BOM, costing, and printer profile require canonical configuration/contracts.
- Financial statements must come from Accounting after successful posting; the POS does not calculate a substitute ledger.

