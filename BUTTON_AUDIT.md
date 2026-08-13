# Transaction Button Functional Audit — 2026-08-13

Status: ACTIVE WORKING AUDIT
Scope: transaction/action surfaces in Cashier and Branch Admin.

Legend: PASS = handler + server capability exist. PASS + APPROVAL = functional through authorization. PARTIAL/HOLD = action works up to a boundary whose business meaning must not be guessed.

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
| Penyesuaian Stok | PASS + APPROVAL | Approval Queue, target snapshot, stale guard, canonical stock movement. |
| Produksi | PASS V1 | linked recipe + batch production works. Production V2 editable output/material template is separate future work. |
| Arus Kas | PARTIAL/HOLD | operational approval/posting works; Accounting counterpart presets exist; CASH_FLOW Accounting delivery is not active yet. |
| Arus Barang | PARTIAL/HOLD | store-level quantity posting works; warehouse routing and exact Accounting valuation are intentionally held. |
| Aset | PASS + APPROVAL | aggregate asset-value V1. |
| Hapus Penjualan | PASS + APPROVAL, conditional HOLD | request + Admin ACC/Reject + soft-delete + stock/HPP/points + Accounting reversal. Sale with AUTO_DADAKAN remains HOLD pending production-correction meaning. |
| Hapus Pembelian | PASS + APPROVAL, guarded | deterministic only before later dependent stock/cost movement; otherwise explicit HOLD. |
| Hapus Operasional | PASS + APPROVAL | soft-delete + drawer reconciliation + Accounting reversal when original journal exists. |
| Rincian Aktif | PASS | current drawer report reads only active source transactions. |
| Detail Laci | PASS | lazy drawer history/detail API. |
| Refresh Pesanan | PASS | explicit authenticated refresh path. |

## Branch Admin

| Surface | Status | Evidence / boundary |
|---|---|---|
| Transaksi filters / Refresh / Muat lagi | PASS | `admin-transactions-ui.js` + paginated read model; corrected POS facts remain history with status `voided`. |
| Detail transaksi | PASS | lazy detail APIs. |
| Approval Queue ACC / Reject | PASS | operational approval queue. |
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
3. Warehouse routing for Arus Barang: canonical stock is still store-scoped.
4. Generic Arus Barang Accounting valuation: quantity alone has no exact valuation meaning.
5. Production V2: editable output Qty, dynamic raw materials, optional recipe template, and production-cost allocation into HPP.

## DOC-IMPACT

REQUIRED whenever an action changes HOLD/PARTIAL/PASS state or a transaction action is added.
