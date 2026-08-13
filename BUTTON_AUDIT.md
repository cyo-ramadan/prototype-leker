# Transaction Button Functional Audit — 2026-08-13

Status: ACTIVE WORKING AUDIT
Scope: transaction/action surfaces in Cashier and Branch Admin.

Legend: PASS = handler + server capability exist. PASS + APPROVAL = functional through Approval Queue. PARTIAL/HOLD = action works up to a boundary whose business meaning must not be guessed.

## Cashier

| Surface | Status | Evidence / boundary |
|---|---|---|
| Buka Laci | PASS | `openDrawerBtn` → drawer open API. |
| Tutup Laci | PASS | close flow → drawer close API + optional Live Photo. |
| Penjualan | PASS | tracked sale → Stock/Production + Accounting POS bridge. |
| Pesanan | PASS | dynamic sales/orders workspace and status actions. |
| Beli Bahan | PASS | itemized purchase → stock/cost + Accounting POS bridge. |
| Pengeluaran | PASS | operational expense → Accounting POS bridge. |
| Pendapatan Lain | PASS | operational income route exists; separate Accounting taxonomy remains future work. |
| Penyesuaian Stok | PASS + APPROVAL | existing Approval Queue, target snapshot, stale guard, canonical stock movement. |
| Produksi | PASS | recipe/stock-production module. |
| Arus Kas | PARTIAL/HOLD | operational approval/posting works; Accounting counterpart presets exist; CASH_FLOW Accounting delivery is not active yet. |
| Arus Barang | PARTIAL/HOLD | store-level quantity posting works; warehouse routing and exact Accounting valuation are intentionally held. |
| Aset | PASS + APPROVAL | aggregate asset-value V1. |
| Permit koreksi transaksi | PARTIAL/HOLD | request + Admin ACC/Reject works; downstream Sale/Purchase/Expense correction executors remain explicit HOLD. |
| Rincian Aktif | PASS | current drawer report API. |
| Detail Laci | PASS | lazy drawer history/detail API. |
| Refresh Pesanan | PASS | explicit authenticated refresh path. |

## Branch Admin

| Surface | Status | Evidence / boundary |
|---|---|---|
| Transaksi filters / Refresh / Muat lagi | PASS | `admin-transactions-ui.js` + paginated read model. |
| Detail transaksi | PASS | lazy detail APIs. |
| Approval Queue ACC / Reject | PASS | operational approval queue. |
| Permit koreksi ACC / Reject | PARTIAL/HOLD | authorization is real; unresolved executors return visible HOLD. |
| Raport Kasir Refresh | PASS | shared Raport read model; scoring unconfigured. |
| Akuntansi workspace | PASS | account, journal, journal data, GL, P&L, Balance Sheet. |
| Sync Transaksi POS | PASS | existing Accounting bridge reconciliation. |
| Setting Akuntansi | PASS | canonical registries + cash/goods counterpart presets. |
| Warehouse Settings | PASS | real warehouse master/access/settings; transaction routing remains separate. |
| Stok / detail | PASS | canonical stock/movement read model. |

## Held business meanings

1. KPI period, target, weights, grade thresholds.
2. Sale correction: stock, COGS, points, order/production lineage, Accounting reversal.
3. Purchase correction: moving-average HPP history and later dependent stock/cost facts.
4. Expense correction: auditable operational status + Accounting reversal executor.
5. Warehouse routing for Arus Barang: canonical stock is still store-scoped.
6. Generic Arus Barang Accounting: quantity alone has no exact valuation meaning.

## DOC-IMPACT

REQUIRED whenever an action changes HOLD/PARTIAL/PASS state or a transaction action is added.
