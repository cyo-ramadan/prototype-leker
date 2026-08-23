# Audit Tenancy Fase 3 — Accounting

Task: `karen-TENANCY-AUDIT-ACCOUNTING`
Claim: `karen10-TENANCY-AUDIT-ACC-claim`
Audit basis: `HANDOFF-tenancy-implementation.md` Fase 3 + `adr/ADR-030-multi-entity-tenancy-and-accounting-consolidation.md`
Audited baseline: `main@bcb813029c03d77912dd000a21037cad9f4635d8`

## Scope and classification

Audit ini read-only terhadap runtime. Seluruh file `src/accounting-*.js` pada baseline di-enumerasi langsung dari `src/`, lalu setiap pemakaian `store_id` ditinjau sebagai berikut:

- **A — operational store scope:** `store_id` memang membatasi fakta/aktivitas operasional satu gerai dan boleh tetap dipakai setelah tenancy enforcement.
- **B — data-owner / tenant boundary:** `store_id` sedang bertindak sebagai batas books/data owner atau sebagai satu-satunya authorization boundary. Ini tidak cukup ketika tenant kedua hadir; path harus menerima/resolve authorized Entity set sesuai ADR-030.
- **C — cross-store query:** query sengaja membaca beberapa `store_id`. Jalur ini hanya sah bila lewat relasi lintas-gerai yang memang dimiliki kontraknya (Customer Sharing Group untuk customer sharing). Tidak ditemukan query C di file Accounting saat audit ini.

ADR-030 tetap membolehkan `store_id` sebagai scope operasional. Audit ini tidak mengusulkan menghapus `store_id`; fokusnya adalah titik di mana `store_id` masih menyamar sebagai books/tenant boundary.

## Executive findings

1. **CRITICAL B — writer jurnal baru belum mengisi `entity_id`.** Migration `0046_tenancy_ledger_entity_column.sql` menambahkan dan membackfill `entity_id` pada `accounting_journal_headers` dan `accounting_journal_lines`, tetapi kolomnya nullable dan migration tidak membuat trigger/default untuk mengisi row baru. Current `postAccountingJournal()` masih INSERT header/line dengan `store_id` tanpa `entity_id` (`src/accounting-ledger.js:430-492`). Akibatnya jurnal yang diposting setelah 0046 dapat lahir dengan `entity_id = NULL`, sementara historical rows hasil migration sudah ter-anchor ke Entity. Ini membuat invariant ADR-030 §2 tidak dipertahankan oleh writer.
2. **B — seluruh report finansial masih store-only.** List jurnal, General Ledger, Profit/Loss, dan Balance Sheet membaca `accounting_journal_*` + CoA menggunakan `store_id` sebagai satu-satunya books boundary (`src/accounting-ledger.js:498-760`). Ini benar untuk single-tenant sekarang, tetapi belum tenant-safe menurut ADR-030 §4.
3. **B — Accounting admin endpoints memilih gerai lalu langsung memakai store sebagai authorization/data boundary.** `accounting-workspace.js`, `accounting-settings.js`, `accounting-reference.js`, `accounting-reconciliation-guard.js`, dan handler bridge memakai `resolveStore()` lalu query finansial/config per `store.id`; belum ada enforcement authorized Entity set pada call sites yang diaudit.
4. **A tetap banyak dan valid.** Sale/Purchase/Expense, cash-flow facts, production facts, serta item/product snapshots memang business facts per-gerai. Filter `store_id` di pembacaan fakta itu tidak perlu dihapus. Yang perlu dipisahkan adalah transisi dari fact operasional menuju books-owned config/journal/delivery.
5. **C = 0.** Tidak ditemukan Accounting query yang menggabungkan beberapa store atau memakai Customer Sharing Group. Karena itu audit ini tidak menemukan cross-store bypass; risiko saat ini adalah store-only boundary pada data finansial, bukan cross-store aggregation liar.

## Coverage

Ditemukan **11 file** `src/accounting-*.js` pada baseline:

1. `src/accounting-bridge-seam.js`
2. `src/accounting-cash-flow-bridge.js`
3. `src/accounting-ledger.js`
4. `src/accounting-pos-bridge-response.js`
5. `src/accounting-pos-bridge.js`
6. `src/accounting-pos-reversal.js`
7. `src/accounting-reconciliation-guard.js`
8. `src/accounting-reference.js`
9. `src/accounting-settings.js`
10. `src/accounting-warehouse-production-bridge.js`
11. `src/accounting-workspace.js`

`accounting-bridge-seam.js` tidak memakai `store_id`; sepuluh file lainnya memiliki pemakaian yang diklasifikasikan di bawah.

---

## 1. `src/accounting-bridge-seam.js`

**Tidak ada pemakaian `store_id`.** File hanya mendefinisikan contract/fact reference dari object transaksi dan tidak melakukan database read/write. Tidak ada temuan A/B/C.

## 2. `src/accounting-cash-flow-bridge.js`

### A — fakta operasional gerai

- `src/accounting-cash-flow-bridge.js:8-17` — `loadFact()` mengikat `approval_requests` dan `cash_ledger_entries` pada request + store yang sama. Ini adalah business fact arus kas satu gerai.

### B — books/config/delivery boundary

- `src/accounting-cash-flow-bridge.js:20-42` — `transaction_categories`, `journal_rules`, dan `chart_of_accounts` di-resolve hanya dengan `store_id`.
- `src/accounting-cash-flow-bridge.js:44-91` — counterpart rule/options dan account join tetap store-only.
- `src/accounting-cash-flow-bridge.js:94-138` — CASH account mapping serta `accounting_bridge_deliveries` di-key oleh store sebagai boundary.
- `src/accounting-cash-flow-bridge.js:141-223` — dispatch membawa `{ id: storeId }` ke `postAccountingJournal()`. Fact scope A berubah menjadi books write B pada titik ini; caller belum membawa authorized Entity context.

Tidak ada query C.

## 3. `src/accounting-ledger.js`

Semua `store_id` di file ini terkait CoA, sequence, posted journals, atau financial report. Karena ADR-030 menetapkan Entity sebagai pemilik books, pemakaian tersebut adalah **B**, walaupun `store_id` tetap boleh disimpan sebagai operational provenance.

### B — CoA dan account configuration

- `src/accounting-ledger.js:165-177` — accounting sequence di-key `store_id`.
- `src/accounting-ledger.js:185-205` — list Chart of Accounts hanya `WHERE store_id = ?`.
- `src/accounting-ledger.js:207-232` — reference-count account menggabungkan payment method, item category, journal rule, dan choice option dalam store yang sama.
- `src/accounting-ledger.js:234-271` — create account menulis `chart_of_accounts.store_id` dari `store.id`.
- `src/accounting-ledger.js:273-314` — update/active-account checks tetap store-only.
- `src/accounting-ledger.js:316-326` — system Adjustment account dicari hanya lewat store.

### B — posted journal reads

- `src/accounting-ledger.js:328-379` — `getAccountingJournal()` memilih header/lines + CoA dengan `store_id` sebagai satu-satunya owner boundary.

### B — posted journal writer, **critical entity-anchor gap**

- `src/accounting-ledger.js:381-429` — duplicate/idempotency, allowed accounts, adjustment account, dan reversal source semuanya di-resolve by store.
- `src/accounting-ledger.js:430-492` — INSERT `accounting_journal_headers` dan `accounting_journal_lines` menulis `store_id` tetapi **tidak menulis `entity_id`**.
- `migrations/0046_tenancy_ledger_entity_column.sql` menambahkan `entity_id` nullable dan hanya backfill existing rows. Migration membuat scope + immutability triggers, tetapi tidak membuat trigger/default yang mengisi `entity_id` untuk insert baru. Karena itu writer current-main dapat menghasilkan new financial rows tanpa books-owner Entity.

### B — financial reporting

- `src/accounting-ledger.js:498-532` — list journal store-only.
- `src/accounting-ledger.js:534-615` — General Ledger opening/period entries store-only.
- `src/accounting-ledger.js:617-666` — `groupedBalances()` membatasi CoA + journal line/header melalui store.
- `src/accounting-ledger.js:694-704` — Profit/Loss memanggil grouped balances untuk satu store.
- `src/accounting-ledger.js:735-742` — Balance Sheet juga store-only.

Tidak ada query C. Financial aggregation tidak melintasi store sama sekali saat ini.

## 4. `src/accounting-pos-bridge-response.js`

### A — server-derived fact provenance

- `src/accounting-pos-bridge-response.js:6-12` — `storeForFact()` membaca `store_id` dari newly committed SALE/PURCHASE/EXPENSE fact berdasarkan server response. Ini bukan client-selected cross-store lookup; hasilnya dipakai membawa fact ke bridge store yang benar.

### B — inherited dispatch boundary

- `src/accounting-pos-bridge-response.js:44-75` — store hasil fact lookup diteruskan ke `dispatchPosAccountingFact()`. File ini sendiri tidak membaca books, tetapi downstream dispatch masih store-only; tenancy enforcement perlu memastikan fact-derived Entity termasuk authorized tenant context sebelum financial delivery.

Tidak ada query C.

## 5. `src/accounting-pos-bridge.js`

### A — business fact scope

- `src/accounting-pos-bridge.js:54-132` — SALE/PURCHASE/EXPENSE header dan item rows dibaca dengan `(fact id, store_id)`. Ini benar sebagai operational store scope.

### B — Accounting configuration resolution

- `src/accounting-pos-bridge.js:143-211` — transaction category, journal rules, CoA, payment account, dan item-category mappings hanya store-scoped.
- `src/accounting-pos-bridge.js:322-373` — Choice Group/options + active CoA resolution memakai `store_id` sebagai books/config boundary.
- `src/accounting-pos-bridge.js:377-530` — resolver menerima `store`, lalu seluruh Accounting configuration dan journal command dibentuk dari store-only config.

### B — delivery/reconciliation state dan journal posting

- `src/accounting-pos-bridge.js:535-575` — `accounting_bridge_deliveries` di-key `store_id`.
- `src/accounting-pos-bridge.js:588-638` — dispatch melakukan existing-delivery check, fact load, resolver, `postAccountingJournal()`, lalu save-delivery dengan store sebagai satu-satunya boundary.
- `src/accounting-pos-bridge.js:640-677` — bridge summary membaca deliveries per store.

### A + B — unsynced facts definition

- `src/accounting-pos-bridge.js:679-730` — source SALE/PURCHASE/EXPENSE tetap tepat bila difilter per store (**A**), tetapi `NOT EXISTS accounting_bridge_deliveries` membandingkan financial-delivery state hanya dengan store (**B**). Tidak ada tenant/entity predicate.

### B — management sync/read endpoint boundary

- `src/accounting-pos-bridge.js:744-758` — request memilih store via `resolveStore`; summary Accounting kemudian dibaca langsung by store. Ketika tenant kedua ada, management auth + arbitrary store resolution perlu dikaitkan ke authorized Entity set.

Tidak ada query C.

## 6. `src/accounting-pos-reversal.js`

### B — financial delivery + posted journal

- `src/accounting-pos-reversal.js:7-14` — source delivery dicari by `store_id`.
- `src/accounting-pos-reversal.js:23-40` — original journal dibaca melalui `getAccountingJournal(db, store.id, ...)`.
- `src/accounting-pos-reversal.js:48-65` — reversal diposting kembali lewat `postAccountingJournal(db, store, ...)`, sehingga mewarisi critical missing-`entity_id` writer gap di ledger.

Tidak ada A terpisah yang membaca raw business fact dan tidak ada query C.

## 7. `src/accounting-reconciliation-guard.js`

### A — business fact state

- `src/accounting-reconciliation-guard.js:14-18` — `factState()` mengecek SALE/PURCHASE/EXPENSE by id + store. Ini operational fact scope.

### B — reconciliation/authorization boundary

- `src/accounting-reconciliation-guard.js:9-12,20-49` — endpoint memilih store dari request via `resolveStore()`, lalu re-dispatch satu fact atau seluruh backlog store. ADR-030 secara eksplisit memasukkan reconciliation sebagai path yang wajib resolve authorized Entity set server-side. Current handler belum melakukan entity-set enforcement di call site.

Tidak ada query C.

## 8. `src/accounting-reference.js`

### B — Accounting configuration readiness

- `src/accounting-reference.js:28-72` — transaction category, journal rule counts, payment-account mapping, dan item-category readiness semuanya memakai store sebagai books/config boundary.

### A — operational provenance pada snapshot

- `src/accounting-reference.js:75-108` — `transaction_accounting_snapshots.store_id` menyimpan provenance source fact/config snapshot per store. `store_id` tetap berguna sebagai operational provenance.

### B — snapshot lookup + management portal boundary

- `src/accounting-reference.js:111-130` — snapshot read hanya by `store_id + source_type + source_id`; ketika tenant kedua hadir caller authorization perlu Entity set, bukan mengandalkan store saja.
- `src/accounting-reference.js:20-23,164-193` — management endpoint memilih store via request and exposes Accounting settings/accounts through that store without explicit authorized-Entity enforcement.

Tidak ada query C.

## 9. `src/accounting-settings.js`

File ini mencampur POS-owned identities dengan Accounting mapping. Classification mengikuti tabel yang sedang di-scope, bukan nama file.

### B — CoA dan Accounting mappings

- `src/accounting-settings.js:58-74` — CoA list by store.
- `src/accounting-settings.js:83-103` — payment-method rows memang POS identity, tetapi query ini juga meng-resolve linked CoA; sebagai Accounting mapping read boundary, classification-nya B.
- `src/accounting-settings.js:105-139` — item category + product kind + CoA mapping store-only; mapping adalah books interpretation.
- `src/accounting-settings.js:141-220` — choice groups/options, journal-line provenance count, journal-rule usage, dan CoA joins store-only.
- `src/accounting-settings.js:260-286` — choice-group readiness memakai journal rules/options/CoA by store.
- `src/accounting-settings.js:327-372` — transaction categories + journal rules + CoA reads store-only.
- `src/accounting-settings.js:419-447` — active account/reference counting store-only.
- `src/accounting-settings.js:449-497` — CoA create/update writes store as books owner.
- `src/accounting-settings.js:499-557` — item-category accounting mapping reads/writes store-only.
- `src/accounting-settings.js:620-694` — Choice Option/account mapping and usage checks store-only.
- `src/accounting-settings.js:696-742` — transaction-category writes store-only.
- `src/accounting-settings.js:744-820` — journal-rule writes and fixed-account/choice-group resolution store-only.

### A — operational catalog checks used as readiness inputs

- `src/accounting-settings.js:231-259` — `postingBlockers()` reads active products/product kinds per store to see whether operational catalog is ready. The `products.store_id` and `product_kinds.store_id` parts are legitimate operational scope (**A**); the surrounding payment/item-category/choice/CoA checks in the same function remain **B**.

### B — management endpoint boundary

- `src/accounting-settings.js:35-47,822-874` — management context resolves a request-selected store, then exposes/mutates Accounting mappings for that store. Tenant/entity authorization is not enforced at these call sites yet.

Tidak ada query C.

## 10. `src/accounting-warehouse-production-bridge.js`

### A — Warehouse production fact

- `src/accounting-warehouse-production-bridge.js:72-112` — production run/components are loaded by production id + store. Ini business fact Warehouse satu gerai.

### B — accounting configuration, delivery, and posting

- `src/accounting-warehouse-production-bridge.js:114-145` — `wh_production` transaction category/rules and item-category account mapping are store-only.
- `src/accounting-warehouse-production-bridge.js:147-184` — Accounting delivery state is keyed by store.
- `src/accounting-warehouse-production-bridge.js:196-300` — dispatch resolves mappings and posts journal using `store`; it inherits the missing `entity_id` writer gap from `postAccountingJournal()`.

Tidak ada query C.

## 11. `src/accounting-workspace.js`

### B — Accounting management/read/write boundary

- `src/accounting-workspace.js:20-32` — request-selected store is resolved after management auth, but no authorized Entity-set enforcement exists at the Accounting call site.
- `src/accounting-workspace.js:39-57` — bootstrap loads CoA, journals, and bridge summary by `store.id`.
- `src/accounting-workspace.js:83-104` — account create/update + manual journal write operate against the selected store.
- `src/accounting-workspace.js:107-159` — journal list/detail, General Ledger, Profit/Loss, dan Balance Sheet all pass only `store.id` into books reads.

`store_id` may remain in returned journal/account provenance, but it cannot remain the sole tenant authorization/books filter when multi-tenant enforcement lands.

Tidak ada query C.

---

## Cross-store / Customer Sharing Group check

Tidak satu pun dari 11 `src/accounting-*.js` yang diaudit membaca `customer_share_group_stores`, Customer Sharing Group, atau melakukan query yang dengan sengaja menggabungkan beberapa `store_id`. Maka:

- **C findings: 0.**
- Tidak ada cross-store Accounting query yang perlu divalidasi sebagai Customer Sharing Group path.
- Future consolidated Accounting juga **tidak boleh** memakai Customer Sharing Group sebagai shortcut. ADR-030 menetapkan consolidated books melalui Entity + temporal `consolidation_membership`, sedangkan Customer Sharing Group tetap konsep customer-sharing yang berbeda.

## Boundary map for Hana Fase 3 design

Audit ini tidak menulis implementation task, tetapi hasil klasifikasinya memberi boundary map:

- **Pertahankan A:** fact reads SALE/PURCHASE/EXPENSE, cash-flow fact, production fact, product/product-kind operational provenance tetap scoped ke `store_id`.
- **Enforce B:** sebelum Accounting configuration, journal, report, bridge delivery, reconciliation, reversal, atau Accounting admin action memakai store, verified tenant context harus resolve authorized Entity set server-side dan memastikan selected store/fact Entity termasuk set itu.
- **Anchor writers:** journal header/line writer harus mempertahankan `entity_id` untuk every new row, bukan hanya historical backfill migration.
- **Financial reads:** journal/report paths perlu memakai `entity_id` as books-owner boundary while retaining `store_id` for outlet provenance/optional narrowing.
- **No C today:** consolidated/cross-Entity reporting belum ada di Accounting files ini; jangan memperkenalkannya lewat ad-hoc multi-store query.

## Risks ordered by urgency

1. **P0 / data integrity:** new posted journal header/line can have NULL `entity_id` after migration 0046 because runtime writer omits the new column.
2. **P0 before second tenant:** management Accounting endpoints and reconciliation are store-selected, not authorized-Entity enforced.
3. **P1 before multi-entity financial reporting:** GL/P&L/Balance Sheet/list-journal remain store-only, so Entity-owned books cannot yet be represented safely across multiple stores under one Entity.
4. **P1:** Accounting bridge delivery/reversal/config resolution still treats store as books boundary; fact-side store scoping itself should remain.

## DOC-IMPACT

`DOC-IMPACT: REQUIRED` for this audit task is satisfied by this file. No runtime/source/schema file is modified.
