# Known Issues — Prototype Leker

## Approval posting contract — resolved by V1

The posting-contract blocker introduced with approval queue 0013 is resolved by:

- `contracts/operational-posting-v1.md`;
- ADR-010;
- migration `0014_operational_posting_ledgers.sql`;
- `src/operational-posting.js`.

Current behavior:

- Kasir entry remains `pending_approval` + `unposted`;
- Admin Gerai can ACC/Reject only within its store;
- Owner can ACC/Reject across stores;
- ACC atomically writes the V1 domain movement and marks the approval `approved` + `posted`;
- failed non-negative stock/asset checks roll back the full batch and leave the request pending;
- CASH_FLOW affects drawer expected cash only after posting;
- GOODS_FLOW updates the quantity ledger/balance only after posting;
- ASSET updates aggregate asset-value ledger/balance only after posting.

V1 intentionally does not define accounting journal/account mapping, inventory costing/valuation, lot/expiry, individual asset depreciation, or production/BOM semantics. Those are future versioned contracts, not blockers for the V1 CASH_FLOW / GOODS_FLOW / ASSET workflow.

## Penyesuaian Stok dan Produksi

The action-bar entry points exist, but their write workflows are not yet active. They require their own versioned contracts because stock adjustment semantics and production recipe/BOM/yield behavior are separate domains from GOODS_FLOW.

This is a visible product limitation, not a blocker for ordinary sales/orders or V1 approval posting.

## Portal Staf V1

Live-photo attendance is active for authenticated cashier/employee sessions and is independent from drawer state. KPI, Riwayat Setoran, and Riwayat Gaji are intentionally exposed as isolated empty portal sections until their own versioned data contracts are implemented.

This is not a blocker for attendance or cashier operations.

## Staff session dan duplicate tab

Issue sebelumnya tentang duplicate cashier tab ditutup oleh kombinasi:

- canonical login dipisah menjadi Pelanggan dan Karyawan;
- satu staff account hanya mempunyai satu active server session;
- satu browser hanya mempunyai satu active staff tab melalui local browser lease;
- takeover session harus explicit;
- customer session tetap terpisah dan boleh coexist dengan satu staff tab.

Jika browser-tab lease atau takeover menghasilkan failure baru pada testing live, catat sebagai issue baru dengan langkah reproduksi dan jangan menghidupkan kembali periodic network polling sebagai workaround.

## DOC-IMPACT

**REQUIRED** — approval posting is implemented under Operational Posting Contract v1, and Live Photo / Staff Portal attendance is implemented under `contracts/live-photo-staff-portal-v1.md`. Remaining inactive Stock Adjustment, Production, KPI, Deposit, and Payroll writes stay explicitly visible until their own contracts are introduced.
