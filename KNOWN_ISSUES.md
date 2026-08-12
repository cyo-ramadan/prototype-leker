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

V1 intentionally does not define accounting journal/account mapping, inventory costing/valuation, lot/expiry, or individual asset depreciation.

## Manufacturing master active; production posting masih pending

Manufacturing Master v1 is now defined by:

- `contracts/manufacturing-master-v1.md`;
- ADR-012;
- migration `0016_manufacturing_master_v1.sql`;
- `src/manufacturing-master.js`.

Item Type, Unit, product classification, and versioned Recipe/BOM masters are active in the Admin architecture. Product sellability can now be governed by item-type policy.

The **Produksi** and **Penyesuaian Stok** cashier write workflows are still intentionally inactive. Production posting still needs a separate versioned contract for production order/batch identity, recipe revision snapshot, actual component consumption, actual output, waste/yield variance, and inventory movement linkage.

HPP is also intentionally not calculated yet. Cost valuation must be defined by Inventory/Costing; recipe quantity alone is not a valid HPP source.

## Accounting integration seam prepared

Prototype Leker exposes only the `MAXI_ACCOUNTING_BUSINESS_FACT_V1` integration seam and operational source references. The separate Accounting program owns journals, account mapping, buku besar, neraca saldo, neraca, laba rugi, and accounting closing.

Current sync state is `NOT_CONNECTED`. This is expected while the Accounting/Integration Bridge implementation is being developed and is not a blocker for operational transaction tracking.

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

**REQUIRED** — approval posting is implemented under Operational Posting Contract v1; Live Photo / Staff Portal attendance is implemented under `contracts/live-photo-staff-portal-v1.md`; Manufacturing Master and the Admin transaction/accounting boundary are defined under ADR-012 and their versioned contracts. Remaining inactive Production, Stock Adjustment, KPI, Deposit, and Payroll writes stay explicitly visible until their own contracts are introduced.
