# Katalog modul — status siap-pakai per modul

Ditulis oleh: Hana, atas permintaan Bos Cyo 2026-08-22. Dokumen ini jawaban buat
pertanyaan "modul mana yang udah bersih, boleh dijadiin contoh/basis kalau mau
bikin program baru?" — bukan status fitur, bukan roadmap.

**Komposisi modul per Tenant sudah punya pondasi registry, tetapi migrasi modul
existing belum selesai.** ADR-040 menetapkan satu platform dengan modul yang
dipasang per Tenant. Migration `0080_game_module_foundation.sql` menambahkan
`platform_modules` + histori `tenant_module_installations`; `GAME` menjadi modul
opsional pertama yang memakai bentuk canonical tersebut. Migration tidak
auto-enroll Tenant mana pun. Modul existing seperti Accounting/Warehouse masih
punya compatibility gate lama sampai migrasinya sendiri selesai.

Tenant/Entity/Gerai tetap mengikuti ADR-030. Entity menjadi anchor data yang
tidak ditulis ulang ketika kepemilikan Tenant berubah, sedangkan entitlement
module berada di Tenant dan punya histori efektif sendiri.

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

## Status per modul

| Modul | Status | Bukti | File utama |
|---|---|---|---|
| POS Core | READY (pondasi, selalu ada) | Baseline seluruh modul lain, tidak berdiri sendiri sebagai "modul opsional" | `src/index.js`, `src/cashier-*.js`, `src/pos-payment-methods.js` |
| Manufaktur (HPP) | **READY** | PR #133/#134, diff dibaca langsung, 336/336 test. Satu modul untuk semua hitungan HPP, dipanggil dari Penjualan+Produksi | `src/manufacture-costing.js` |
| Warehouse (stok) | **READY** | PR #135, diff dibaca langsung, 342/342 test. Saklar `stores.warehouse_enabled`, 4 titik gate terbukti nurut | `src/stock-production.js`, `src/warehouse-production.js`, `src/admin-stock.js`, gate di `cashier-purchase.js`/`operational-posting.js` |
| Customer & Sharing | **VERIFIED_NO_WORK_NEEDED** | Tabel Customer terpisah dari Accounting; isolasi operational tetap store-scoped | `src/customers.js`, `src/customer-sharing.js`, `src/customer-membership.js`, `src/customer-feedback.js` |
| Business Settings | **IN_PROGRESS** | Registry tenant mulai tersedia, tetapi compatibility switch existing belum seluruhnya dipindah | `src/business-settings.js`, `src/product-kinds.js`, `src/platform-module-registry.js` |
| Accounting | **IN_PROGRESS** | Dispatch/capability masih punya compatibility path `stores.edition`; belum dimigrasikan penuh ke tenant module entitlement | `src/accounting-*.js` |
| Tenancy / Entity foundation | **IN_PROGRESS** | ADR-030 foundation + Store→Entity/Tenant resolution aktif; registry module tenant ditambahkan secara additive pada 0080 | `src/stores.js`, `migrations/0039_tenancy_and_consolidation_foundation.sql`, `migrations/0080_game_module_foundation.sql` |
| Game | **IN_PROGRESS** | ADR-042 + `MAXI_GAME_MODULE_V1`; schema `game_*` provider-neutral dan entitlement `GAME` per Tenant. Legacy Roda Puter belum dimigrasikan dan route Game belum dihubungkan ke router production | `src/game.js`, `src/platform-module-registry.js`, `migrations/0080_game_module_foundation.sql` |

## Game — batas foundation saat ini

Foundation Game sengaja belum memindahkan Roda Puter existing. `src/roda-puter.js`
dan tabel `roda_puter_*` masih compatibility surface yang langsung terkait
Voucher. Tahap berikutnya wajib memigrasikan setting, campaign, outcome, play
history, fulfillment adapter, serta lazy-loaded customer UI secara eksplisit.

`artwork_ref` di Game adalah opaque reference. Keputusan tempat menyimpan file
asset tidak dikunci oleh module Game dan tidak memiliki dependency ke R2.

## Temuan yang belum jadi task (dicatat, bukan dilupakan)

- Accounting bridge tidak pernah membawa `customer_id`/`supplier_id` — Akuntansi
  tidak bisa lapor piutang per-pelanggan. Bukan bug modularitas, tidak
  menghalangi POS atau Customer, murni keterbatasan fitur. Prioritas lain
  dulu sebelum ini jadi task.
- `trg_stores_seed_accounting_workspace_sequences` (0024) dan dua trigger di
  0026/0028 masih menulis beberapa baris `chart_of_accounts`/`accounting_sequences`
  untuk gerai LITE/FLEXIBLE. Cleanup terpisah kalau suatu saat dibutuhkan.
- Owner final untuk module `game` belum ditetapkan. Sampai owner dicatat di
  `MODULE_OWNERSHIP.md`, Game tetap **IN_PROGRESS** dan tidak boleh diberi status
  READY.

## DOC-IMPACT

**REQUIRED** — update tabel status setiap kali module entitlement/migration
existing berubah, atau modul mana pun disentuh ulang.
