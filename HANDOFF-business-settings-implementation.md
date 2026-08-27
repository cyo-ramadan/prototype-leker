# Handoff — implementasi Business Settings / POS Core boundary

Disiapkan oleh: `hana1.1` — arsitektur
Tanggal: 2026-08-19
Pembaruan implementasi: 2026-08-22 oleh Karen
Architecture: `adr/ADR-034-business-settings-pos-core-boundary.md`

Baca dulu, berurutan: `CLAUDE.md` → `ADR-034` → `ADR-017`/`ADR-029`/`ADR-031` →
`KNOWN_PITFALLS.md`.

## Requirement yang tidak bisa ditawar

**Full Leker (G001/G002/M002) tidak boleh berubah perilaku sama sekali.** Semua
gerai existing berakhir dengan `edition = 'ACCOUNTING'` — kalau ada satu saja
transaksi, laporan, atau jurnal yang hasilnya berbeda sebelum/sesudah fase mana pun di
bawah, fase itu salah, bukan Leker yang perlu disesuaikan.

## Aturan yang berlaku di seluruh fase

- Satu PR, satu migration per fase, hijau sendiri, bisa di-deploy tanpa fase
  berikutnya.
- `npm test` dan `npm run check` wajib hijau. File baru wajib masuk script `check`.
- Tes yang ditambahkan harus **gagal bila perubahanmu dicabut**.
- Jangan memutuskan kebijakan akuntansi atau bentuk produk (jalur upgrade edition,
  dll). Itu daftar "Open" di `ADR-034` — gagal-tertutup lalu tulis `escalations`.
- Jangan menyentuh `package.json` script `deploy` — baru saja dipulihkan dua kali
  dalam sehari yang sama, lihat riwayat commit `f36ca2d`/`244ed88`.

## Fase 0 — kepemilikan modul, tanpa migration

**Status: LANDED** — route admin Business Settings dan alias compatibility mendarat
melalui PR #136 (`f777e4a`).

**Paths:** `src/business-settings.js` (baru), `src/accounting-settings.js`,
`public/business-settings-panel.js` (baru), `test/business-settings-payment-methods.test.js`

1. Pindahkan route `POST/PATCH /api/admin/settings/accounting/payment-methods` ke
   `src/business-settings.js` di path baru
   `/api/admin/settings/business/payment-methods`. **Tabel tidak berubah** — masih
   `payment_methods`.
2. `accounting-settings.js` menyisakan endpoint lama sebagai alias yang memanggil
   fungsi yang sama, ditandai deprecated di komentar satu baris, sampai UI lama
   berhenti memanggilnya.
3. Perbaiki pesan error di `src/cashier-operational-expense.js:44,105` — jangan lagi
   menuduh "Setting Akuntansi" untuk kegagalan yang sebenarnya "cara bayar tidak
   ditemukan". Ganti jadi *"Cara bayar tidak aktif / tidak terdaftar."*
4. Route UI baru `public/business-settings-panel.js` untuk mengelola Payment Method,
   bisa berupa kerangka tipis dulu.

**Acceptance:** dua route (lama dan baru) menghasilkan efek identik di database;
`resolvePosPaymentMethod`/`listPosPaymentMethods` tidak disentuh; pesan error baru
tidak menyebut "Setting Akuntansi".

**Risiko rendah** — murni pemindahan lokasi. Bisa dikerjakan siapa pun, kapan pun,
terlepas dari fase-fase berikutnya.

## Fase 1 — `payment_method_accounts`, extension table

**Status: SUPERSEDED, jangan diimplementasikan.** PR #128 (`9a656cf`) sudah menetapkan
boundary yang dipakai saat ini: POS Core hanya membaca identitas/status/default cara
bayar, `payment_methods.account_id` boleh `NULL`, dan Accounting bridge membaca mapping
compatibility itu post-commit secara fail-closed sebagai `NEEDS_PAYMENT_MAPPING`.
Extension table yang direncanakan di bawah tidak dibuat; butir-butirnya dipertahankan
sebagai riwayat rencana awal ADR, bukan backlog aktif.

**Paths:** `migrations/00XX_payment_method_accounts.sql`,
`src/accounting-pos-bridge.js`, `src/accounting-settings.js`,
`test/payment-method-accounts.test.js`

1. Tabel sesuai `ADR-034` §1. Backfill: satu baris per `payment_methods` yang
   `account_id`-nya sudah terisi.
2. `resolvePosPaymentMethod`/`listPosPaymentMethods` membaca `payment_method_accounts`
   dulu; fallback ke `payment_methods.account_id` kalau baris ekstensi belum ada.
3. `savePaymentMethod` di Accounting Settings (bukan Business Settings — ini
   pemetaan akun, ranahnya Accounting) menulis ke `payment_method_accounts`, bukan
   lagi `payment_methods.account_id`.
4. `payment_methods.account_id` **tidak dihapus**. Kolom lama, tidak ditulis lagi oleh
   jalur baru.

**Acceptance — ini yang menentukan:** ambil satu fakta yang bisa diposting sebelum
migration ini, resolve, simpan `journalLines`. Jalankan migration. Resolve fakta yang
sama. **Baris jurnalnya harus identik.** Pola tes yang sama dengan
`HANDOFF-choice-groups-implementation.md` Fase 2 — tulis tes ini duluan.

## Fase 2 — `stores.edition`

**Status: IMPLEMENTED** — migration `0045_stores_edition.sql` dan empat regression test
di `test/stores-edition.test.js` menjadi changeset fase ini.

**Paths:** `migrations/0045_stores_edition.sql`, `test/stores-edition.test.js`

1. Kolom sesuai `ADR-034` §4, default `'ACCOUNTING'`.
2. Bungkus `trg_stores_seed_accounting_settings_defaults`
   (`migrations/0022_accounting_warehouse_settings.sql`) dengan
   `WHEN NEW.edition = 'ACCOUNTING'`. Ini rebuild trigger, bukan rebuild tabel — lebih
   ringan dari rebuild `journal_rules` di rencana Choice Group, tapi tetap: **daftar
   dulu** semua trigger `AFTER INSERT ON stores` yang ada sebelum menyentuh salah
   satunya (lihat §"paling mudah salah" di bawah).
3. Bungkus `trg_product_kinds_seed_accounting_mapping`
   (`migrations/0029_purchase_accounting_defaults.sql`) dengan kondisi yang menoleh ke
   `stores.edition` milik `NEW.store_id`. SQLite trigger boleh melakukan sub-select di
   `WHEN`, jadi ini tidak perlu rebuild tabel `product_kinds`.
4. Gate hanya bagian seed `RECEIVABLE_OFFSET` dalam
   `trg_payment_methods_cash_default_after_insert` untuk `ACCOUNTING`; pemilihan `CASH`
   sebagai default tetap berlaku pada semua edition.
5. Pertahankan `trg_stores_seed_accounting_bridge_compat` pada semua edition, termasuk
   `NON_CASH` dengan `account_id=NULL`. Untuk `LITE`/`FLEXIBLE`, seed POS Core
   `CASH`/`BANK`/`PAYABLE` juga tetap ada tanpa account mapping.

**Acceptance:**
- membuat gerai `edition='ACCOUNTING'` menghasilkan scaffolding **identik** dengan
  sebelum migration ini — dibuktikan tes snapshot tabel, bukan spot-check;
- membuat gerai `edition='LITE'` atau `'FLEXIBLE'` tetap mendapat registry POS Core
  `CASH`/`BANK`/`PAYABLE` serta compatibility `NON_CASH`, semuanya tanpa Account ID,
  dan `CASH` tetap default;
- gerai `LITE`/`FLEXIBLE` tidak mendapat seed Accounting target dari `0022`, mapping
  `item_categories` dari `0029`, atau `RECEIVABLE_OFFSET`;
- residual `accounting_sequences` (`0024`), akun dari `0026`/`0028`, serta kategori dan
  journal rule Arus Kas dari `0028` sengaja tetap ada; ketiganya di luar scope fase ini
  dan dipin eksplisit oleh regression test;
- menambah `product_kinds` di gerai `LITE`/`FLEXIBLE` **tidak** membuat baris
  `item_categories` dan **tidak** gagal FK;
- seluruh tes existing tetap hijau tanpa satu pun diubah — kalau ada yang perlu diubah,
  itu tanda fase ini bocor ke luar scope-nya.

## Fase 3 — gating dispatch, bukan resolver

**Status: IMPLEMENTED** — caller-side gating di `src/index.js` dan regression matrix di
`test/accounting-dispatch-gating.test.js` menjadi changeset fase ini. Keputusan edition
tetap berada di boundary pemanggil; modul Accounting tidak diberi pengetahuan tentang
edition.

**Paths:** `src/index.js`, `test/accounting-dispatch-gating.test.js`,
`HANDOFF-business-settings-implementation.md`

1. Setelah business fact SALE/PURCHASE/EXPENSE berhasil committed, caller mengambil ID
   fakta dari response, membaca `store_id` fakta tersebut, lalu membaca
   `stores.edition` server-side. Query-string/store token dari request tidak dipakai
   sebagai sumber keputusan dispatch.
2. Untuk `LITE`/`FLEXIBLE`, response business yang sudah committed dikembalikan tanpa
   memanggil Accounting dispatcher. Untuk `ACCOUNTING`, caller tetap memanggil
   `attachAccountingBridgeToCommittedResponse` seperti perilaku sebelumnya.
3. Jika fact ID, store, atau edition tidak bisa di-resolve secara aman, jalur lama
   tetap dipertahankan supaya kegagalan Accounting/reconciliation tidak hilang diam-diam.
4. `accounting-pos-bridge.js`, `accounting-pos-bridge-response.js`, dan
   `accounting-cash-flow-bridge.js` tidak diubah.

**Acceptance:** regression membuktikan `LITE`/`FLEXIBLE` tidak memanggil dispatcher
untuk SALE/PURCHASE/EXPENSE, `ACCOUNTING` tetap memanggil dispatcher untuk ketiga fakta,
dan unresolved edition mempertahankan jalur fail-closed sebelumnya. Full repository
check/test wajib tetap hijau sebelum fase ini mendarat.

## Yang paling mudah salah

1. **Menghapus `payment_methods.account_id` terlalu awal.** Baris lama yang masih
   membacanya (kalau ada) akan pecah diam-diam. Ikuti disiplin `0038`: biarkan sampai
   dibuktikan tidak ada yang membaca, baru dibuang di fase terpisah.
2. **Menganggap trigger rebuild itu rebuild tabel.** `journal_rules` di rencana Choice
   Group memang butuh rebuild tabel karena `CHECK`; trigger di sini cukup di-drop dan
   dibuat ulang dengan `WHEN` baru — jangan menyalin resep Fase 1 Choice Group ke sini,
   bebannya beda.
3. **Menambahkan gating di dalam resolver**, bukan di titik pemanggilan. Ini
   memindahkan keputusan produk ke dalam modul yang tidak boleh tahu soal edition —
   `accounting-pos-bridge.js` tugasnya menafsirkan fakta, bukan memutuskan apakah
   fakta itu boleh ditafsirkan.
4. **Lupa gerai default harus `'ACCOUNTING'`.** Default `'LITE'` terlihat lebih "aman"
   tapi diam-diam mengubah perilaku setiap gerai yang dibuat tanpa menyatakan
   `edition` secara eksplisit — termasuk kemungkinan skrip seed test yang lupa
   diperbarui.

## Cara mengambil pekerjaan ini

Sama seperti `HANDOFF-choice-groups-implementation.md`: papan tugas di Cloudflare D1
`maxi-agent-bus`, ikuti `agent-bus/CLAIM-PROMPT.md`. Fase 0 aman diklaim segera; Fase
1-3 sebaiknya menunggu Fase 0 selesai karena keduanya menyentuh `payment_methods` di
jalur yang berdekatan.

Kalau ada yang ambigu — terutama soal jalur upgrade edition atau bentuk UI Business
Settings — jangan menebak. Tulis `escalations` lalu berhenti.

## DOC-IMPACT

**REQUIRED** — perbarui dokumen ini setiap fase mendarat.
