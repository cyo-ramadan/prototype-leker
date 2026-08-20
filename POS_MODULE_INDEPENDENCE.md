# Visi Bos Cyo — POS berdiri sendiri, modul lain nempel opsional

Ditulis oleh: Hana, atas permintaan Bos Cyo 2026-08-20 — jadi bahan pembahasan yang
dibawa masuk ke sesi mana pun, bukan cuma tercatat di satu percakapan.

Ini bukan ADR. Ini catatan arah — kenapa arahnya begini, sejauh mana sudah kejawab, dan
apa yang masih PR. ADR yang jadi rujukan teknisnya `ADR-033`, `ADR-034`, `ADR-036`.

## Keinginannya, dalam satu kalimat

**Setting Akuntansi, Akuntansi, dan Gudang harus bisa dicabut satu-satu — POS-nya sendiri
tetap jalan tanpa satu pun dari ketiganya.**

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
  └── Business Settings (opsional) — Cara Bayar, Jenis Barang, Master Biaya
        └── Accounting (opsional, butuh Business Settings) — jurnal, laporan keuangan
  └── Warehouse (opsional, TIDAK butuh Accounting maupun sebaliknya) — stok, average cost
```

Poin yang gampang salah paham: **Accounting dan Warehouse itu sumbu yang berbeda, bukan
satu tangga.** Gerai boleh punya Accounting nyala tapi Warehouse mati (dicatat sebagai
beban langsung, tetap ada laporan keuangan rapi) — pola yang sama kayak F&B kecil yang
gak ribet stok tapi tetap mau tahu untung-rugi. Jangan dipaksa jadi satu ladder linear;
sudah dicoba dan hasilnya kombinasi yang gak masuk akal (lihat `ADR-036` §5).

## Status tiap bagian, per 2026-08-20

| Bagian | ADR | Status |
|---|---|---|
| Setting Transaksi (cara Setting Akuntansi bikin & pasang aturan posting) | `ADR-033` | **Sudah jadi, sudah jalan.** Dua tombol (Bikin Grup, Pasang Grup) sudah bisa dipakai admin hari ini. |
| Business Settings jadi lapisan generic, Accounting jadi extension opsional | `ADR-034` | **Baru rancangan.** Belum ada satu baris kode pun yang jalan dari 4 fase yang direncanakan. |
| Warehouse jadi modul opsional | `ADR-036` | **Baru audit + konsep.** Ditemukan Warehouse lebih susah dicabut daripada Accounting — jelasnya di bawah. |

Peta lengkap semua titik di kode yang nyambung ke Warehouse — file per file, mana yang
riskan mana yang aman — ada di `WAREHOUSE_POS_LINKAGE_MAP.md`. Dibaca kalau sudah mau
mulai implementasi, bukan buat diskusi arah.

## Temuan penting yang sudah ketemu — biar gak ditanya ulang tiap sesi

**Accounting gampang dicabut. Warehouse tidak sama gampangnya — dan itu ketahuan lewat
audit kode, bukan tebakan.**

- Accounting hari ini sudah dipanggil dari **satu titik**, sesudah transaksi POS selesai
  disimpan, dan gagal-nya Accounting **tidak** membatalkan transaksi POS. Jadi bikin
  Accounting opsional tinggal kasih syarat di satu titik itu — modul Accounting sendiri
  sama sekali tidak perlu diubah.
- Warehouse **tidak** punya titik sebersih itu. Perhitungan average cost hidup **di
  dalam** proses pencatatan Pembelian itu sendiri — bukan panggilan ke modul terpisah
  yang bisa digantung/dilewati begitu saja. Bikin Warehouse benar-benar opsional berarti
  mengubah bagian dalam pencatatan Pembelian, bukan cuma nambah gerbang di satu tempat.

**Setting Transaksi sudah bisa jadi separuh jawaban buat gerai tanpa-Warehouse — tapi
cuma separuh.** Separuh yang sudah kejawab: gerai tanpa-Warehouse bisa catat pembelian
bahan langsung sebagai beban (bukan persediaan), dan penjualan cukup catat Pendapatan vs
Kas tanpa baris HPP — ini sudah bisa dikonfigurasi hari ini, gak perlu nunggu apa-apa.
Separuh yang belum kejawab: apakah Pembelian tetap diam-diam nulis data stok yang gak
kepakai. Itu bukan urusan Setting Akuntansi, itu urusan modul Warehouse/Pembelian sendiri.

## Yang masih nunggu keputusan Bos Cyo

Detail lengkapnya di `ADR-036` §7 — tapi tiga ini yang paling nentuin arah:

1. **Default gerai baru** — Warehouse nyala atau mati secara default? Nyala = aman,
   sama kayak sekarang. Mati = lebih cocok sama pasar kaki lima yang lebih besar, tapi
   ubah kebiasaan default.
2. **Upgrade data lama** — kalau gerai mulai tanpa Warehouse terus nanti diaktifkan,
   data lama (yang tercatat sebagai beban) gak bisa otomatis jadi data stok. Mulai
   bersih dari titik upgrade, atau migrasi manual pakai perkiraan?
3. **Prioritas kerja** — `ADR-034` dan `ADR-036` **boleh dikerjakan paralel** (sudah
   dicek, dua-duanya gak saling butuh), bukan harus antre satu-satu.

## Kalau mau lanjut bahas ini di sesi lain

Baca urutan ini duluan: dokumen ini → `ADR-034` (Business Settings/Accounting) →
`ADR-036` (Warehouse). `ADR-033` (Setting Transaksi) sudah selesai, dibaca kalau butuh
detail teknis cara kerjanya, bukan buat keputusan arah.

## DOC-IMPACT

Perbarui tabel status setiap kali ada fase `ADR-034`/`ADR-036` yang mendarat, dan setiap
kali salah satu dari tiga keputusan di atas dijawab Bos Cyo.
