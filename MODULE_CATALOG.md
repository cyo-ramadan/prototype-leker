# Katalog modul — status siap-pakai per modul

Ditulis oleh: Hana, atas permintaan Bos Cyo 2026-08-22. Dokumen ini jawaban buat
pertanyaan "modul mana yang udah bersih, boleh dijadiin contoh/basis kalau mau
bikin program baru?" — bukan status fitur, bukan roadmap.

**Bukan plug-and-play — untuk sekarang.** Leker dan program lain (mis. Program
Ikan) hari ini masih repo dan Worker terpisah, database terpisah. Status di sini
nandain "sudah diverifikasi bersih, aman dijadikan referensi/basis" — bukan
mekanisme impor otomatis.

**Arah akhirnya bukan begitu.** Keputusan Bos Cyo 2026-08-22: MAXI menuju satu
platform, banyak tenant (`ADR-030` — Tenant/Entity/Gerai empat lapis, fondasi
tabelnya sudah ada di `migrations/0039`; Langkah 4 sedang dikerjakan bertahap.
Fase resolusi Store→Entity/Tenant sudah landed lewat PR #139, sementara Fase
ledger anchor sudah landed lewat PR #141. Enforcement/filter lintas Entity
belum dimulai). Program Ikan
akan diarahkan Bos Cyo langsung buat nyesuaiin ke mode itu dari sisi sesinya
sendiri — bukan dikerjakan dari sesi Leker ini. Saklar per-gerai yang lagi
dibangun di sini (`warehouse_enabled`, `edition`) tetap relevan buat arah itu:
mekanismenya sama persis dengan yang dibutuhkan buat saklar per-tenant nanti,
cuma level scope-nya beda.

## Aturan status

- **READY** — sudah diverifikasi bersih (kode dibaca langsung, bukan cuma
  ringkasan), tidak ada ketergantungan tersembunyi ke modul lain, ada bukti
  test. Aman dijadikan basis.
- **IN_PROGRESS** — sedang dikerjakan atau baru separuh jalan. Jangan dijadikan
  basis dulu, tunggu sampai READY.
- **VERIFIED_NO_WORK_NEEDED** — dicek dalam, hasilnya sudah bersih dari awal,
  tidak ada task perbaikan yang perlu dibuat. Beda dari READY karena belum
  pernah sengaja dipisahkan/dirapikan sebagai modul (kebetulan sudah rapi).

**Begitu modul yang statusnya READY/VERIFIED disentuh lagi** (fitur baru,
refactor, bugfix di file miliknya) — turunkan ke IN_PROGRESS sampai diverifikasi
ulang. Jangan percaya status lama begitu ada perubahan kode.

## Status per modul (per 2026-08-23)

| Modul | Status | Bukti | File utama |
|---|---|---|---|
| POS Core | READY (pondasi, selalu ada) | Baseline seluruh modul lain, tidak berdiri sendiri sebagai "modul opsional" | `src/index.js`, `src/cashier-*.js`, `src/pos-payment-methods.js` |
| Manufaktur (HPP) | **READY** | PR #133/#134, diff dibaca langsung, 336/336 test. Satu modul untuk semua hitungan HPP, dipanggil dari Penjualan+Produksi | `src/manufacture-costing.js` |
| Warehouse (stok) | **READY** | PR #135, diff dibaca langsung, 342/342 test. Saklar `stores.warehouse_enabled`, 4 titik gate terbukti nurut | `src/stock-production.js`, `src/warehouse-production.js`, `src/admin-stock.js`, gate di `cashier-purchase.js`/`operational-posting.js` |
| Customer & Sharing | **VERIFIED_NO_WORK_NEEDED** | Tabel `customers`/`customer_share_groups` cuma dibuat sekali, nol trigger, nol referensi ke `chart_of_accounts`/`account_id`/`journal_rules`/`item_categories`. Isolasi `store_id` per invariant #5 benar | `src/customers.js`, `src/customer-sharing.js`, `src/customer-membership.js`, `src/customer-feedback.js` |
| Business Settings | **IN_PROGRESS** | Route admin Cara Bayar sudah pindah (PR #136). Saklar `stores.edition` (LITE/FLEXIBLE/ACCOUNTING) masih dikerjakan (`karen-BS-STORES-EDITION`) | `src/business-settings.js`, `src/product-kinds.js` |
| Accounting | **IN_PROGRESS** | Cara panggilnya sudah rapi dari dulu (satu titik, post-commit, tidak pernah block POS). Cara nyalain/matiinnya nunggu `stores.edition` + `karen-BS-DISPATCH-GATING` | `src/accounting-*.js` |
| Tenancy / Entity foundation | **IN_PROGRESS** | ADR-030 foundation sudah ada di migration 0039. PR #139 sudah menambahkan Store→Entity/Tenant resolution; PR #141 sudah menambahkan additive `entity_id` anchor pada lima financial/value ledgers tanpa mengubah filter runtime. Enforcement Entity belum dimulai | `src/stores.js`, `migrations/0039_tenancy_and_consolidation_foundation.sql`, `migrations/0046_tenancy_ledger_entity_column.sql` |

## Temuan yang belum jadi task (dicatat, bukan dilupakan)

- Accounting bridge tidak pernah membawa `customer_id`/`supplier_id` — Akuntansi
  tidak bisa lapor piutang per-pelanggan. Bukan bug modularitas, tidak
  menghalangi POS atau Customer, murni keterbatasan fitur. Prioritas lain
  dulu sebelum ini jadi task.
- `trg_stores_seed_accounting_workspace_sequences` (0024) dan dua trigger di
  0026/0028 masih menulis beberapa baris `chart_of_accounts`/`accounting_sequences`
  untuk gerai LITE/FLEXIBLE walau `karen-BS-STORES-EDITION` selesai. Baris
  menganggur, tidak nge-block apa pun — cleanup terpisah kalau suatu saat mau
  benar-benar nol residu, bukan syarat "POS bisa diambil sendiri".

## DOC-IMPACT

**REQUIRED** — update tabel status setiap kali `karen-BS-STORES-EDITION`/
`karen-BS-DISPATCH-GATING` mendarat, atau modul mana pun disentuh ulang.
