# ADR-036 — Warehouse sebagai modul opsional, di luar Business Settings/Accounting

Status: PROPOSED — audit dan konsep, atas usulan Bos Cyo 2026-08-20. Tidak ada kode yang
berubah dari ADR ini. Tidak menyentuh path Setting Transaksi Fase 3-4 yang sedang
dikerjakan Karen (`ADR-033`, issue #107/#109).
Date: 2026-08-20
Change ID: `MAXI-WAREHOUSE-OPTIONAL-20260820`
Dikerjakan oleh: `hana1.1` — arsitektur, atas usulan Bos Cyo

## 1. Usulan Bos Cyo

Logika yang sama dengan `ADR-034` (Accounting jadi extension opsional dari Business
Settings) diterapkan ke Warehouse: POS harus bisa jalan sendiri tanpa Warehouse. Gerai yang
cuma butuh catat cashflow — semua bahan dianggap beban langsung — dipaksa ikut membawa
Warehouse hari ini karena HPP masih bergantung padanya. Sistem yang sudah jalan (Leker)
tetap pakai Warehouse seperti sekarang; yang dibutuhkan adalah opsi untuk gerai yang
memang tidak mau pakai Warehouse maupun Accounting sama sekali.

Dua pertanyaan eksplisit dari Bos Cyo:
1. Benar begitu perilaku pelaku usaha kuliner kaki lima (pentol, mie ayam, bakso)?
2. Bisa Setting Transaksi (Choice Group, `ADR-033`) dipakai sebagai jembatan ke Warehouse?

## 2. Validasi pasar

Dicek lewat pencarian, bukan diasumsikan:

- Tingkat bawah (Loyverse, Small Vendor POS, iReap Lite, Qasir versi awal) — cuma
  transaksi cepat, struk, laporan dasar. Tidak ada pelacakan bahan baku per-item.
- Tingkat menengah ke atas (Kasir Pintar, Nutapos, MarketMan) — baru di sini pelacakan
  bahan baku, resep, dan HPP otomatis muncul sebagai fitur yang **disebut eksplisit**
  sebagai pembeda dari tingkat bawah.

Polanya cocok dengan dugaan Bos Cyo: pelaku usaha kaki lima pada umumnya memang berhenti di
"catat kas masuk-keluar", bukan karena fiturnya belum tahu, tapi karena kebutuhannya memang
segitu — beli bahan hari ini, habis hari ini, dianggap beban langsung. Pelacakan stok jadi
relevan begitu ada bahan yang disimpan lintas hari atau lintas cabang.

## 3. Audit — di mana sebenarnya Warehouse hidup di kode hari ini

Beda dari `ADR-034`, Warehouse **tidak** punya satu titik pemanggilan tunggal seperti
Accounting (`attachAccountingBridgeToCommittedResponse`, dipanggil dari tiga tempat di
`src/index.js`). Yang ditemukan:

1. **`products.average_cost`** — dihitung dan ditulis **inline di dalam** commit Pembelian
   (`src/cashier-purchase.js`), pakai rumus moving average, sebagai bagian dari transaksi
   yang sama dengan mencatat pembelian itu sendiri. Bukan panggilan ke modul terpisah —
   secara kode, Purchase dan "Warehouse costing" adalah satu file, satu transaksi.
2. **`stock_movements`** (`migrations/0017`) — ledger kuantitas generik (`source_type`/
   `source_id`), ditulis dari Sale, Purchase, dan Produksi.
3. **`inventory_stock_balances` / `inventory_ledger_entries`** (`migrations/0014`) — jalur
   terpisah, terikat `approval_request_id`, dipakai penyesuaian stok manual (opname/adjustment)
   yang lewat approval.
4. **`line_cogs`** di `sale_items` — dihitung saat commit penjualan langsung dari
   `products.average_cost` (`src/cashier-sales-tracking.js:104`), lalu itu yang jadi input
   `item_category_cogs`/`item_category_inventory` di resolver Accounting
   (`src/accounting-pos-bridge.js`).
5. Produksi (`src/stock-production.js`, `src/warehouse-production.js`) menambah satu lapis
   lagi: konsumsi bahan lintas Jenis Barang, snapshot HPP produksi. Sengaja **tidak**
   diaudit dalam sekali jalan ini — pelaku kaki lima pada umumnya tidak pakai Produksi/BOM
   formal, mereka masak langsung tanpa resep tercatat.

**Audit lanjutan 2026-08-20** — peta lengkap per-file, mana yang aman (layar Admin/laporan,
tinggal disembunyikan) dan mana yang duduk langsung di jalur commit kasir, ada di
`WAREHOUSE_POS_LINKAGE_MAP.md`. Satu temuan dari situ yang mengubah urutan risiko: dialog
Beli Bahan kasir (`src/cashier-purchase.js`'s `listPurchaseOptions`) memfilter produk
dengan `WHERE stock_tracking_enabled = 1` — kalau flag itu di-default-kan `0` begitu
Warehouse dimatikan **tanpa** query-nya ikut diubah, dialog Beli Bahan langsung kosong
total (bukan jatuh ke mode "catat sebagai beban langsung" yang sudah dibahas §4). Ini
kandidat kuat jadi langkah pertama Fase 1 implementasi, karena silent-nya paling
berbahaya — gejalanya "gak ada barang yang bisa dibeli", bukan error yang jelas.

**Temuan yang perlu digarisbawahi:** `ADR-034` bisa membuat Accounting opsional dengan
gating satu titik pemanggilan, tanpa mengubah `accounting-pos-bridge.js` sama sekali,
karena dispatch-nya memang sudah post-commit dan best-effort. Warehouse **tidak** punya
seam sebersih itu — average-cost math hidup di dalam commit Pembelian sendiri. Membuat
Warehouse benar-benar opsional berarti mengubah `cashier-purchase.js`, bukan cuma menambah
gerbang di satu titik seperti Accounting kemarin. Ini lebih besar dari yang terlihat dari
luar, dan itu sebabnya ADR ini baru audit dan konsep, belum implementasi.

## 4. Jawaban ke pertanyaan "Setting Transaksi sebagai jembatan?"

**Sebagian iya, sebagian bukan — dan penting untuk tidak dicampur.**

**Bagian yang sudah bisa, tanpa nunggu apa pun:** sisi Accounting dari gerai
tanpa-Warehouse **sudah bisa** diwujudkan hari ini lewat konfigurasi `journal_rules` biasa
(dengan atau tanpa Choice Group) — Setting Transaksi cocok dipakai di sini:

- `purchase_material` sisi Debit dipasang ke akun **Beban Bahan Langsung** (bukan
  Persediaan) — persis pola `fixed_account` yang sudah ada, atau lewat Setting Transaksi
  kalau adminnya mau pilihan bermacam-macam beban bahan.
- `sale` **tidak** dipasangi rule `item_category_cogs`/`item_category_inventory` sama
  sekali — penjualan cuma mencatat Pendapatan vs Kas, tanpa baris HPP/Persediaan. Ini
  bukan fitur baru; resolver (`accounting-pos-bridge.js`) sudah menghasilkan baris jurnal
  persis sebanyak rule aktif yang ada — nol rule `item_category_*` berarti nol baris itu,
  otomatis, tanpa kode tambahan.

**Bagian yang bukan urusan Setting Transaksi:** apakah Pembelian tetap **menulis**
`average_cost`/`stock_movements` walau baris jurnalnya tidak dipakai. Kalau tidak
ditangani, gerai tanpa-Warehouse tetap membawa ongkos komputasi dan ruang tabel yang tidak
pernah dipakai siapa pun — bukan salah secara akuntansi, tapi tidak menjawab keluhan asli
"mubazir". Ini keputusan di modul Warehouse/Purchase sendiri, bukan sesuatu yang bisa
diselesaikan dari sisi Setting Akuntansi.

Jadi: Setting Transaksi **cukup** untuk membuat *pembukuan* gerai tanpa-Warehouse benar.
Ia **tidak cukup** untuk membuat gerai itu berhenti membawa beban Warehouse di jalur
Pembelian. Dua masalah, satu nyambung ke Accounting (sudah terjawab), satu nyambung ke
Purchase/Warehouse (butuh keputusan terpisah, §5).

## 5. Konsep yang diusulkan — dua sumbu, bukan satu

`ADR-034` mengusulkan `stores.edition` berurut: `LITE` → `FLEXIBLE` → `ACCOUNTING`, karena
Accounting butuh Business Settings sebagai prasyarat. Warehouse **tidak** punya hubungan
prasyarat yang sama ke Accounting — faktanya, gerai boleh punya Accounting **aktif** tapi
Warehouse **mati** (persis pola §4: Pembelian dicatat sebagai beban langsung, bukan
Persediaan). Memaksakan Warehouse ke tangga linear yang sama akan menciptakan kombinasi
yang tidak masuk akal atau kolom `edition` yang harus disebutkan berulang untuk tiap
kombinasi.

**Usul:** dua sumbu independen pada `stores`, bukan satu:

```
edition          : LITE | FLEXIBLE | ACCOUNTING     (ADR-034, urutan tetap)
warehouse_enabled : 0 | 1                             (baru, independen dari edition)
```

| `edition` | `warehouse_enabled` | Produk |
|---|---|---|
| `LITE` | `0` | POS murni — kaki lima, cashflow doang |
| `LITE` | `1` | POS + pelacakan stok, tanpa pembukuan (jarang, tapi tidak dilarang) |
| `ACCOUNTING` | `0` | Leker versi "semua bahan beban langsung" — F&B kecil yang mau laporan rapi tanpa ribet stok |
| `ACCOUNTING` | `1` | Leker hari ini, persis seperti sekarang |

Baris terakhir (`ACCOUNTING` + `warehouse_enabled=1`) **wajib** identik dengan perilaku
Leker saat ini untuk semua gerai yang sudah ada — sama seperti syarat `ADR-034`.

## 6. Konsekuensi

- **Tidak mengubah apa pun hari ini.** `ADR-034` sendiri masih Fase 0 (belum ada satu baris
  kode dari 4 fasenya berjalan) — ADR ini eksplisit menumpuk di atas fondasi yang juga
  belum dibangun, bukan mendesak dikerjakan lebih dulu.
- **Warehouse tidak akan seringan Accounting untuk dijadikan opsional.** §3 sudah
  menjelaskan kenapa — `cashier-purchase.js` perlu gating internal, bukan cuma satu
  gerbang di `src/index.js`.
- Setting Transaksi (Choice Group) tetap jalan seperti rencana `ADR-033` — ADR ini tidak
  menambah maupun mengubah scope Fase 3-4 yang sedang dikerjakan Karen.

## 7. Open — milik Bos Cyo

1. ~~**Prioritas.**~~ **Dijawab 2026-08-20 — paralel, bukan antre.** Prinsip Bos Cyo:
   kalau sebuah task sudah dirancang dengan barrier yang tidak membahayakan struktur lain,
   defaultnya boleh paralel; sequence cuma dipaksakan kalau memang ada ketergantungan
   nyata, dan itu dicatat eksplisit di task-nya, bukan diam-diam ditahan.

   Dicek ulang dengan prinsip itu: `ADR-034` dan ADR ini **tidak** punya ketergantungan
   struktural. `warehouse_enabled` dirancang sebagai sumbu independen (§5) — kolom
   `ALTER TABLE stores ADD COLUMN warehouse_enabled` tidak butuh `stores.edition` (`ADR-034`)
   sudah ada lebih dulu. Keduanya **boleh dikerjakan paralel oleh agen berbeda**.

   Satu catatan koordinasi (bukan sequence, cuma supaya tidak tabrakan nomor):
   implementer kedua yang mulai duluan mengambil nomor migration berikutnya; yang kedua
   cek dulu migration terbaru di `main` sebelum menetapkan nomornya sendiri.
2. **`warehouse_enabled` default gerai baru** — `1` (aman, sama seperti hari ini, mirip
   alasan `ADR-034` pilih default `ACCOUNTING`) atau `0` (mencerminkan porsi pasar kaki
   lima yang lebih besar)?
3. Kalau `warehouse_enabled=0` lalu di-upgrade ke `1` di kemudian hari — data historis
   yang sudah tercatat sebagai beban langsung tidak bisa direkonstruksi jadi Persediaan.
   Ini keputusan produk (migrasi manual dengan asumsi, atau mulai bersih dari titik
   upgrade), bukan sesuatu yang bisa Hana putuskan sendiri.

## 8. Related

- `ADR-034` — Business Settings/POS Core boundary, fondasi yang jadi tumpuan ADR ini
- `ADR-033` — Setting Transaksi (Choice Group), sudah cukup untuk sisi Accounting §4
- `ADR-032` — semantik Inventory → Accounting, jadi rujukan kenapa `item_category_*`
  sengaja tidak dipaksa ada
- `HANDOFF-business-settings-implementation.md` — urutan kerja `ADR-034`, ADR ini belum
  punya HANDOFF sendiri karena masih tahap konsep

## DOC-IMPACT

Tidak ada — status masih PROPOSED/konsep, belum ada perilaku yang berubah. HANDOFF
implementasi ditulis setelah §7 dijawab Bos Cyo.
