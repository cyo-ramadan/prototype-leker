# Transaction Button Functional Audit — 2026-08-18

Status: ACTIVE WORKING AUDIT
Scope: transaction/action surfaces in Cashier and Branch Admin.

Legend: PASS = handler + server capability exist. PASS + APPROVAL = functional through authorization. PARTIAL/HOLD = action works up to a boundary whose business meaning must not be guessed.

## Cashier

| Surface | Status | Evidence / boundary |
|---|---|---|
| Buka Laci | PASS | `openDrawerBtn` → drawer open API. |
| Tutup Laci | PASS | close flow → drawer close API + optional Live Photo. |
| Penjualan | PASS | tracked sale → Stock/Production + Accounting POS bridge; active payment method is selected from Setting Akuntansi. |
| Pesanan | PASS | dynamic sales/orders workspace and status actions. |
| Beli Bahan | PASS | itemized purchase → stock/cost + Accounting POS bridge; active payment method is selected from Setting Akuntansi. |
| Pengeluaran | PASS | operational expense → Accounting POS bridge; payment method comes from Setting Akuntansi and multiple Debit components require component selection by rule ID. |
| Pendapatan Lain | PASS | operational income route exists; separate Accounting taxonomy remains future work. |
| Penyesuaian Stok | PASS + APPROVAL | Approval Queue, target snapshot, stale guard, canonical stock movement. |
| Produksi | PASS V2 | output product + actual Qty, Recipe/BOM as immutable editable template, dynamic actual materials add/remove/edit, exact scaled HPP + moving-average output cost, `PRODUCTION_INPUT`/`PRODUCTION_OUTPUT` stock ledger, and post-commit Warehouse → Accounting inventory-account transfer. Same inventory account intentionally creates no journal movement. |
| Arus Kas | PASS + APPROVAL / Accounting config-gated | operational ACC posts first; approved fact then resolves `cash_flow_in`/`cash_flow_out` through Setting Akuntansi and the Accounting journal engine. Missing mapping remains `NEEDS_CONFIGURATION` and can be retried idempotently. |
| Arus Barang | PARTIAL/HOLD | store-level quantity posting works; warehouse routing and exact Accounting valuation are intentionally held. |
| Aset | PASS + APPROVAL | aggregate asset-value V1. |
| Hapus Penjualan | PASS + APPROVAL, conditional HOLD | request + Admin ACC/Reject + soft-delete + stock/HPP/points + Accounting reversal. Sale with AUTO_DADAKAN remains HOLD pending production-correction meaning. |
| Hapus Pembelian | PASS + APPROVAL, guarded | deterministic only before later dependent stock/cost movement; otherwise explicit HOLD. |
| Hapus Operasional | PASS + APPROVAL | soft-delete + drawer reconciliation + Accounting reversal when original journal exists. |
| Rincian Aktif | PASS | current drawer report reads only active source transactions; only payment code `CASH` counts as physical drawer cash, every other active method is non-cash. |
| Detail Laci | PASS | lazy drawer history/detail API. |
| Refresh Pesanan | PASS | explicit authenticated refresh path. |

## Branch Admin

| Surface | Status | Evidence / boundary |
|---|---|---|
| Transaksi filters / Refresh / Muat lagi | PASS | `admin-transactions-ui.js` + paginated read model; corrected POS facts remain history with status `voided`. |
| Detail transaksi | PASS | lazy detail APIs. |
| Approval Queue ACC / Reject | PASS | operational approval queue; CASH_FLOW Accounting delivery is post-commit and does not roll back an operational ACC. |
| Permit Hapus ACC / Reject | PASS + guarded execution | same Approval Queue surface; recent lifecycle shows approval, execution, Accounting status, and journal references. |
| Raport Kasir Refresh | PASS | shared Raport read model; score/grade remains `NEEDS_KPI_POLICY`. |
| Akuntansi workspace | PASS | account, journal, journal data, GL, P&L, Balance Sheet. |
| Sync Transaksi POS | PASS technical / UX rename pending | retry/reconciliation only; corrected source facts are excluded. Normal POS posting remains automatic. |
| Setting Akuntansi | PASS | canonical registries + cash/goods counterpart presets. |
| Warehouse Settings | PASS | real warehouse master/access/settings; transaction routing remains separate. |
| Stok / detail | PASS | canonical stock/movement read model. |

## Held business meanings

1. KPI period, target, weights, grade thresholds.
2. Sale + AUTO_DADAKAN correction: whether generated production is reversed or produced goods remain stock.
3. Warehouse routing for Arus Barang: whether the cashier flow is warehouse transfer-first, also supports one-sided IN/OUT, and how canonical stock becomes location-aware.
4. Generic Arus Barang Accounting valuation: quantity alone has no exact valuation meaning.
5. Return taxonomy: Supplier Return, Customer Return, and internal return must not be collapsed until the transaction UX/taxonomy is decided.

## DOC-IMPACT

REQUIRED whenever an action changes HOLD/PARTIAL/PASS state or a transaction action is added.
