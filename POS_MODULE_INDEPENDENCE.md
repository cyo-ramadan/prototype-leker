# Visi Bos Cyo — POS berdiri sendiri, modul lain nempel opsional

Ditulis oleh: Hana, atas permintaan Bos Cyo 2026-08-20 — jadi bahan pembahasan yang
dibawa masuk ke sesi mana pun, bukan cuma tercatat di satu percakapan.

Ini bukan ADR. Ini catatan arah — kenapa arahnya begini, sejauh mana sudah kejawab, dan
apa yang masih PR. ADR yang jadi rujukan teknisnya `ADR-033`, `ADR-034`, `ADR-036`,
`ADR-037`.

## Keinginannya, dalam satu kalimat

**Setting Akuntansi, Akuntansi, dan kuantitas stok Gudang harus bisa dicabut satu-satu —
POS-nya sendiri tetap jalan tanpa satu pun dari ketiganya.** Satu bagian yang **tidak**
ikut dicabut: cara HPP dibentuk (modul Manufaktur, `ADR-037`) — itu wajib selalu ada,
cuma modenya yang beda-beda tergantung kebutuhan gerai.

Bukan karena tiganya jelek. Karena Leker (produk sekarang) itu satu titik di ujung atas
dari rentang kebutuhan yang jauh lebih lebar, dan MAXI mau produknya bisa dijual ke ujung
bawah rentang itu juga — tanpa bikin produk baru dari nol, cukup lepas modulnya.

## Kenapa — bukan cuma dugaan, sudah dicek ke pasar

Pelaku usaha kaki lima (pentol, mie ayam, bakso, dan sejenisnya) itu polanya beda sama
resto/kafe yang jadi bayangan awal Leker:

- Yang mereka butuh cuma **catat kas masuk-keluar**. Beli bahan hari ini, habis hari ini,
  dianggap beban langsung — bukan persediaan yang dilacak.
- Aplikasi kasir kelas bawah (Loyverse, Small Vendor POS, iReap Lite, Qasir versi awal)
  memang berhenti di situ — transaksi cepat, struk, laporan dasar, titik.
- Pelacakan bahan baku + HPP otomatis baru muncul di kelas menengah ke atas (Kasir
  Pintar, Nutapos, MarketMan) — dan di situ **disebut eksplisit** sebagai pembeda kelas,
  bukan fitur yang "harusnya semua orang butuh".

Jadi bukan produk Leker yang salah bentuk. Rentang kebutuhannya memang lebar, dan
sekarang Leker cuma melayani ujung atasnya.

## Peta modulnya

```
POS Core (wajib, selalu ada)
  └── Manufaktur (wajib, selalu ada — cuma MODENYA yang beda)
        mode DIRECT_FROM_PURCHASE (default, gak butuh apa-apa)
        mode RECIPE_WEIGHTED_AVERAGE (butuh kuantitas dari Warehouse di bawah)
        mode lain menyusul (mis. dropship)
  └── Business Settings (opsional) — Cara Bayar, Jenis Barang, Master Biaya
        └── Accounting (opsional, butuh Business Settings) — jurnal, laporan keuangan
  └── Warehouse — kuantitas stok (opsional, TIDAK butuh Accounting maupun sebaliknya)
```

Poin yang gampang salah paham, dua lapis:

- **Accounting dan Warehouse itu sumbu yang berbeda, bukan satu tangga.** Gerai boleh
  punya Accounting nyala tapi Warehouse mati (dicatat sebagai beban langsung, tetap ada
  laporan keuangan rapi) — pola yang sama kayak F&B kecil yang gak ribet stok tapi tetap
  mau tahu untung-rugi. Jangan dipaksa jadi satu ladder linear; sudah dicoba dan hasilnya
  kombinasi yang gak masuk akal (lihat `ADR-036` §5).
- **Manufaktur bukan bagian dari Warehouse, walau sekilas mirip.** Manufaktur itu
  "bagaimana HPP dihitung" — wajib selalu ada, gak bisa dicabut, tapi ringan kalau
  modenya `DIRECT_FROM_PURCHASE`. Warehouse (di sini) itu "berapa sisa stok" — murni
  opsional. Yang bikin dua ini kelihatan satu paket selama ini: mode Manufaktur yang
  paling canggih (`RECIPE_WEIGHTED_AVERAGE`) kebetulan butuh angka dari Warehouse.
  Detailnya `ADR-037` §2.3.

## Status tiap bagian, per 2026-08-22

| Bagian | ADR | Status |
|---|---|---|
| Setting Transaksi (cara Setting Akuntansi bikin & pasang aturan posting) | `ADR-033` | **Sudah jadi, sudah jalan.** Dua tombol (Bikin Grup, Pasang Grup) sudah bisa dipakai admin hari ini. |
| Business Settings jadi lapisan generic, Accounting jadi extension opsional | `ADR-034` | **Implementasi parsial.** Route admin Business Settings sudah mendarat di PR #136; `stores.edition` dan gating seed target di migration `0045`. Rencana extension table disupersede boundary nullable/fail-closed PR #128. Dispatch gating masih pending. |
| Manufaktur — HPP dipusatkan, wajib ada, modenya pluggable | `ADR-037` | **Baru rancangan, arah disetujui Bos Cyo 2026-08-20.** Menyerap Produksi (`ADR-035`) dan menutup utang audit HPP (issue #88). Belum ada kode yang dipindah. |
| Warehouse jadi modul opsional — sekarang lingkupnya murni kuantitas stok | `ADR-036` | **Baru audit + konsep, direvisi menyempit oleh `ADR-037`.** HPP-nya sudah pindah ke Manufaktur; sisa PR-nya cuma soal kuantitas stok — jelasnya di bawah. |

Peta lengkap semua titik di kode yang nyambung ke Warehouse — file per file, mana yang
riskan mana yang aman — ada di `WAREHOUSE_POS_LINKAGE_MAP.md`. Dibaca kalau sudah mau
mulai implementasi, bukan buat diskusi arah.

## Temuan penting yang sudah ketemu — biar gak ditanya ulang tiap sesi

**Accounting gampang dicabut. Warehouse (kuantitas stok) tidak sama gampangnya — dan itu
ketahuan lewat audit kode, bukan tebakan.**

- Accounting hari ini sudah dipanggil dari **satu titik**, sesudah transaksi POS selesai
  disimpan, dan gagal-nya Accounting **tidak** membatalkan transaksi POS. Jadi bikin
  Accounting opsional tinggal kasih syarat di satu titik itu — modul Accounting sendiri
  sama sekali tidak perlu diubah.
- Warehouse (kuantitas stok) **tidak** punya titik sebersih itu — pengurangan stok pas
  jualan hidup **di dalam** proses penyimpanan transaksi itu sendiri, termasuk bisa
  **menolak transaksi** kalau stok gak cukup. Bikin ini opsional berarti mengubah bagian
  dalam pencatatan transaksi, bukan cuma nambah gerbang di satu tempat. Peta lengkapnya
  `WAREHOUSE_POS_LINKAGE_MAP.md`.

**HPP dulu dikira nempel jadi satu sama Warehouse — ternyata itu dua hal yang beda, dan
cuma kebetulan nempel.** Ini temuan yang mengoreksi audit `ADR-036` sebelumnya, bukan
cuma nambahin: "average cost" yang selama ini ditulis dari enam tempat berbeda
(`products.average_cost`, lihat issue #88) itu bukan urusan Warehouse — itu urusan
Manufaktur (`ADR-037`), yang **wajib selalu ada** karena setiap transaksi jualan butuh
tahu HPP-nya, beda dari kuantitas stok yang murni pilihan. Mode paling dasar Manufaktur
(HPP langsung dari harga beli) malah **gak butuh Warehouse sama sekali** — baru mode
"resep/rata-rata" yang butuh angka kuantitas dari Warehouse.

**Setting Transaksi sudah bisa jadi separuh jawaban buat gerai tanpa-Warehouse — tapi
cuma separuh.** Separuh yang sudah kejawab: gerai tanpa-Warehouse bisa catat pembelian
bahan langsung sebagai beban (bukan persediaan), dan penjualan cukup catat Pendapatan vs
Kas tanpa baris HPP terpisah (HPP-nya tetap ada, dari Manufaktur mode
`DIRECT_FROM_PURCHASE`) — ini sudah bisa dikonfigurasi hari ini, gak perlu nunggu apa-apa.
Separuh yang belum kejawab: apakah Pembelian tetap diam-diam nulis data stok yang gak
kepakai. Itu bukan urusan Setting Akuntansi, itu urusan modul Warehouse/Pembelian sendiri.

## Yang masih nunggu keputusan Bos Cyo

Soal Warehouse (kuantitas stok), detail lengkapnya di `ADR-036` §7 — tiga ini yang
paling nentuin arah:

1. **Default gerai baru** — Warehouse nyala atau mati secara default? Nyala = aman,
   sama kayak sekarang. Mati = lebih cocok sama pasar kaki lima yang lebih besar, tapi
   ubah kebiasaan default.
2. **Upgrade data lama** — kalau gerai mulai tanpa Warehouse terus nanti diaktifkan,
   data lama (yang tercatat sebagai beban) gak bisa otomatis jadi data stok. Mulai
   bersih dari titik upgrade, atau migrasi manual pakai perkiraan?
3. **Prioritas kerja** — `ADR-034` dan `ADR-036` **boleh dikerjakan paralel** (sudah
   dicek, dua-duanya gak saling butuh), bukan harus antre satu-satu.

Soal Manufaktur, detailnya `ADR-037` §4:

4. **Bentuk `average_cost`** — tetap satu baris ditimpa (sederhana, resiko sama seperti
   sekarang), atau jadi ledger append-only (usul Karen di issue #88, nutup jejak
   perubahan tapi kerjaannya lebih besar)? Bisa dua fase terpisah.
5. **Urutan `ADR-037` vs sisa `ADR-034`/`ADR-036`** — `ADR-037` perlu duluan karena
   `ADR-036` bergantung ke revisinya (§2.3), atau boleh paralel juga?

## Kalau mau lanjut bahas ini di sesi lain

Baca urutan ini duluan: dokumen ini → `ADR-037` (Manufaktur/HPP) → `ADR-034` (Business
Settings/Accounting) → `ADR-036` (Warehouse, sudah menyempit ke kuantitas stok saja).
`ADR-033` (Setting Transaksi) sudah selesai, dibaca kalau butuh detail teknis cara
kerjanya, bukan buat keputusan arah.

## Ikan-galeh — konsumen nyata pertama, 2026-08-22

Bos Cyo memutuskan: **Ikan-galeh (olshop ikan dari petani) jadi Tenant kedua di
platform yang sama** (`TEN-GALEH`, entity `ENT-GALEH`, store `IKAN01`), bukan
database terpisah — lewat Entity/Tenant `ADR-030`, karena `store_id` sendirian
tidak cukup begitu pelanggan kedua masuk (`KNOWN_PITFALLS.md`). Ini bukan lagi
skenario hipotetis di ADR — ini kebutuhan nyata pertama yang benar-benar
menagih janji `ADR-034`/`ADR-036`/`ADR-037` selesai dikerjakan.

**Klarifikasi soal "dropship" buat siapa pun yang menyambung ke sini:** dropship
**bukan** mode HPP baru yang perlu ditambah ke Manufaktur. Mode
`DIRECT_FROM_PURCHASE` (§2.3, sudah default) sudah persis "HPP = harga beli baris
itu sendiri" — itu yang dibutuhkan Ikan-galeh. Dropship murni soal **siapa yang
membuat baris Pembelian** (otomatis dari Sale, bukan diketik kasir) — itu domain
Operasional, bukan Manufaktur. Jangan desain mode HPP baru buat ini.

**Temuan baru waktu nyiapkan gerai `IKAN01`, dicatat di sini biar tidak
terulang:** gerai baru yang dibuat **setelah** migration `0040` tidak pernah
kebagian Jenis Barang default (`RAW_MATERIAL`) — seeding-nya di `0040` itu
backfill sekali jalan (`INSERT ... SELECT FROM stores` saat migration itu
berjalan), **bukan** trigger `AFTER INSERT ON stores` seperti seeding
Accounting/POS payment methods (`0045`). Store manapun yang lahir belakangan
diam-diam kehilangan default itu, sampai ketahuan lewat
`test/sale-posting-config.test.js` (assertion idempotency migration 0040) waktu
Hana coba tambah `IKAN01`. Ini utang yang sudah ada sebelum Ikan-galeh, cuma
belum pernah ketagih karena belum pernah ada gerai baru sejak `0040` applied.
Perlu trigger setara sebelum gerai baru manapun (termasuk `IKAN01`) aman dibuat.

Task papan (`maxi-agent-bus`, `project='ikan'`) yang menjalankan bagian ini
ditulis 2026-08-22, urutannya tercatat di task masing-masing.

## DOC-IMPACT

Perbarui tabel status setiap kali ada fase `ADR-034`/`ADR-036`/`ADR-037` yang mendarat,
dan setiap kali salah satu dari lima keputusan di atas dijawab Bos Cyo.
