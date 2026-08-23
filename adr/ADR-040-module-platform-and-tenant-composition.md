# ADR-040 — Platform modul dan komposisi tenant

Status: ACCEPTED
Tanggal: 2026-08-23
Diputuskan oleh: Bos Cyo
Ditulis oleh: Hana
Menggantikan sebagian: catatan "Bukan plug-and-play — untuk sekarang" di `MODULE_CATALOG.md`

## Keputusan Bos Cyo

MAXI menuju satu platform dengan **modul yang dipasang per tenant**, bukan satu
program yang di-fork per pelanggan.

- **Modul vertikal** — Olshop (asal Ikan Galeh), F&B (asal Leker). Satu tenant
  memilih vertikal yang cocok.
- **Modul horizontal** — Accounting, Warehouse, Manufaktur, Customer & Sharing,
  Business Settings. Dipasang tambahan kalau tenant butuh.
- Empat tenant berikutnya sudah punya UI/UX sendiri. Platform menyediakan modul;
  UI mereka memanggilnya.

Aturan yang mengikat semua keputusan turunan:

> **Bug diperbaiki sekali, di modulnya.** Kalau memperbaiki satu tenant menuntut
> mengedit salinan yang sama di tempat lain, itu bukan modul — itu fork, dan
> harus dibetulkan sebagai utang, bukan diterima sebagai desain.

## Kondisi hari ini — jawaban jujur: belum siap

Ikan Galeh dan Leker **sudah satu Worker dan satu database**, dan sudah punya
Tenant/Entity sendiri (`TEN-GALEH`/`ENT-GALEH` vs `TEN-PROTOTYPE`, migration
0050). Yang belum ada adalah **modularitasnya**. Tiga temuan konkret, semua
dibaca langsung dari `origin/main`, bukan dari ringkasan:

### 1. `src/ikan-*.js` bukan modul Olshop — itu salinan paralel

Enam file `ikan-*.js` berdiri sendiri dengan tabel `ikan_*` sendiri. Yang
disalin bukan cuma fitur, tapi **invariant platform**:

- `src/ikan-money.js` mendefinisikan ulang `SCALE = 1_000_000`. Skala uang yang
  sama sudah ada di `src/accounting-ledger.js` (`ACCOUNTING_AMOUNT_SCALE`) dan
  di-copy lagi sebagai `COST_SCALE` di `admin-production-detail.js`,
  `admin-purchase-detail.js`, `admin-transaction-detail.js`, `cashier-purchase.js`.
  **Enam definisi konstanta yang sama untuk invariant #1.**
- `src/ikan-quantity.js` memperkenalkan `QTY_SCALE = 1000` (qty pecahan 3
  desimal) yang tidak dikenal jalur Leker sama sekali.

Kalau nanti pembulatan uang salah, perbaikannya harus diketik enam kali. Itu
persis keluhan Bos Cyo: *"repot kalau suatu tenant ada problem harus benerin
satu-satu."*

### 2. Tidak ada registry modul — routing-nya rantai `if` yang di-hardcode

`src/index.js` menyambung Ikan lewat enam baris `if (pathname.startsWith(...))`
di dalam satu fungsi. Tenant ketiga berarti menambah rantai `if` ketujuh, dan
seterusnya. Tidak ada tempat yang bisa ditanya "tenant ini punya modul apa".

### 3. Saklar yang ada itu per-gerai, bukan per-tenant, dan cuma dua

`stores.edition` (LITE/FLEXIBLE/ACCOUNTING) dan `stores.warehouse_enabled`
adalah kolom di tabel `stores`. Mekanismenya benar dan terbukti jalan — tapi
skalanya salah untuk SaaS: satu kolom boolean per modul tidak bertahan sampai
sepuluh modul, dan levelnya gerai, bukan tenant.

**Kesimpulan:** yang sudah jadi adalah *isolasi data* (Tenant/Entity, ADR-030).
Yang belum sama sekali adalah *komposisi modul*. Dua hal berbeda, sering
tertukar.

## Yang diputuskan

### D1 — Modul punya kontrak, bukan cuma folder

Sebuah modul = satu titik masuk (`handle<X>Api`), miliknya sendiri atas tabel
yang diprefiks namanya, dan **nol impor langsung ke modul sesama-level**. Modul
boleh mengimpor lapisan platform (di bawah), tidak boleh mengimpor saudaranya.
Komunikasi antar-modul lewat business fact, sama seperti batas POS↔Accounting
yang sudah berlaku hari ini (invariant #4).

### D2 — Lapisan platform: satu sumber untuk invariant yang dibagi

Uang, kuantitas, waktu, id — hal yang invariantnya berlaku ke semua tenant —
pindah ke satu tempat yang diimpor semua modul. Ini yang menutup temuan #1.
Konsolidasi ini **tidak boleh mengubah angka yang sudah tersimpan**: skalanya
sudah sama (`1_000_000`) di semua salinan, jadi ini penyatuan definisi, bukan
migrasi data. Kalau di tengah jalan ternyata ada salinan yang skalanya beda,
**berhenti dan eskalasi** — itu berarti ada data yang sudah salah, dan itu
temuan keuangan, bukan refactor.

### D3 — Modul aktif dicatat per tenant, di tabel, bukan di kolom

`stores.edition` dan `stores.warehouse_enabled` diganti perannya oleh tabel
pendaftaran modul per tenant. Kolom lamanya **tidak dihapus dulu** — dibaca
sebagai sumber awal saat migrasi, dihapus hanya setelah terbukti tidak ada
jalur baca yang tersisa. Menghapus lebih awal adalah cara paling gampang
mematikan gerai yang sedang jalan.

### D4 — Dua tenant yang ada ikut jadi modul, tidak ditulis ulang

Leker jadi modul F&B, Ikan Galeh jadi modul Olshop, dari kode yang sudah ada dan
sudah lulus test. Harapan Bos Cyo eksplisit: **jangan menulis ulang dari nol.**
Kalau sebuah bagian terlalu kusut untuk dipindah apa adanya, yang ditulis adalah
task perapian terpisah dengan alasannya — bukan diam-diam ditulis ulang.

### D5 — Urutannya wajib, dan alasannya bukan kerapian

1. Lapisan platform dulu (D2). Modul tidak bisa berhenti menyalin invariant
   sebelum ada tempat tujuan menyalinnya.
2. Registry + pendaftaran modul per tenant (D3).
3. Baru pemisahan vertikal (D4).

Membalik urutan berarti memindahkan file dua kali. Ini satu-satunya ketergantungan
keras di proyek ini; sisanya boleh paralel.

## Yang sengaja TIDAK diputuskan di sini

- **Bentuk teknis registry** (tabel + kolom apa persisnya) — itu keputusan
  implementer setelah membaca kode, bukan sesuatu yang berguna kalau Hana tebak
  dari luar.
- **Batas modul Olshop vs F&B yang tepat** — hasil audit, bukan asumsi. Penjualan
  Leker dan Penjualan Ikan mungkin satu modul dengan dua profil, mungkin dua modul
  berbeda. Yang menentukan adalah seberapa banyak logikanya benar-benar sama.
- **Kapan `store_id` berhenti jadi batas** — sudah ditangani ADR-030 Fase 3, jalan
  terpisah, jangan digabung ke sini.

## Konsekuensi

**Yang membaik:** perbaikan bug sekali jalan; tenant baru dipasang, bukan
di-fork; UI tenant tetap milik mereka sendiri.

**Ongkosnya:** proyek ini menyentuh hampir semua file `src/`, berbarengan dengan
ADR-030 Fase 3 yang juga sedang jalan. Dua-duanya menyentuh isolasi. Yang jalan
duluan wajib menang, yang belakangan menyesuaikan — **jangan** dua-duanya
mengedit file isolasi yang sama tanpa membaca ulang.

**Risiko terbesar:** konsolidasi invariant uang (D2) menyentuh jalur yang
memegang angka keuangan sungguhan. Salah di sini bukan test merah — itu uang
salah. Karena itu D2 punya syarat berhenti sendiri, dan tidak boleh digabung
dengan perubahan perilaku apa pun dalam satu PR.

## DOC-IMPACT

**REQUIRED** — `MODULE_CATALOG.md` (catatan "bukan plug-and-play" jadi usang
begitu registry mendarat), `MODULE_OWNERSHIP.md` (modul baru butuh pemilik),
`CLAUDE.md` (invariant #1 menunjuk ke lapisan platform begitu D2 selesai).
