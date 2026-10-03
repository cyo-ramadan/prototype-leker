# ADR-051 — Untung Rugi gerai Akuntansi dibaca dari jurnal; beban admin yang tertinggal ikut dijurnal

Status: ACCEPTED (Bos Cyo, 2026-10-02: "keputusannya akuntansinya dikonekin ... yang bener
harusnya dikurangin dari beban2 akuntansi ... perhitungan rugi laba dsb mulai dari akuntansi.
kalo kamu punya usulan lebih baik kerjakan saja.")
Tanggal: 2026-10-02
Ditulis oleh: Hana
Menggantikan: ADR-046 poin "Tanpa backfill" dan "Laporan Net Profit ... tetap mesin sendiri".
Tidak mengubah: `POS_MODULE_INDEPENDENCE.md` (POS tanpa Akuntansi tetap bisa menghitung).

## Konteks

Laporan Untung Rugi (Admin Gerai + grafik Entity) dihitung dari fakta POS/Admin (penjualan, HPP,
Beban Kasir, Bea Gaji/Lapak/Lainnya, akrual gaji, selisih stok), tidak dari jurnal. Setelah
keputusan "Akuntansi tetap tersambung, tenant awam tidak perlu tahu akuntansinya", beban yang
hanya hidup di Akuntansi (jurnal manual, Jurnal Beban Rutin / Split ADR-049, jurnal Una) tidak
pernah mengurangi angka yang dilihat pemilik. Dua laporan, dua angka.

Bukti produksi 2026-10-02: 14 gerai aktif, semua edisi ACCOUNTING kecuali IKAN01 (LITE). Fakta
admin yang belum dijurnal: 1 Bea (NGIJO, Rp2.000). Transaksi kasir yang belum dijurnal: 3 gagal
setting Mandala/Beji/Genengan/Pendem (cara bayar Non Tunai belum dipetakan) dan 34+12+9
penjualan tanpa Jenis Barang (DERMO, TLEKUNG, G001).

## Keputusan

1. **Satu pintu angka: jurnal Akuntansi** untuk gerai edisi `ACCOUNTING`. `getNetProfitReport`
   membaca `accounting_journal_lines` pada periode, memetakan akun ke baris laporan:
   REVENUE/SALES → Omset; REVENUE/INVENTORY_ADJUSTMENT → Stok Lebih; REVENUE lain → Pendapatan
   Lain; EXPENSE/COGS → HPP; EXPENSE/INVENTORY_ADJUSTMENT → Stok Hilang; EXPENSE lain → Beban,
   **dirinci per nama akun** (bahasa pemilik: "Beban Gaji", "Beban Sewa Lapak", ...). Jurnal
   pembalik terjumlah apa adanya, jadi transaksi yang dibatalkan netral. Tidak di-cache (jurnal
   boleh masuk mundur).
2. **Gerai `LITE`/`FLEXIBLE` tetap memakai mesin fakta POS** (tanpa perubahan, tetap ter-cache).
   Mesin itu diekspor sebagai `getPosFactsNetProfitReport` untuk tesnya.
3. **Beban yang belum terhubung digabungkan**: fakta admin (Bea, gaji presensi, pelunasan hutang,
   uang muka) yang belum punya delivery `POSTED` ikut disinkronkan oleh tombol sinkron Akuntansi
   yang sama dengan transaksi kasir (`POST /api/admin/accounting/bridge/sync`). Idempotent lewat
   kunci `LEKER_ADMIN:<fakta>:<id>`; urut `created_at` supaya hutang lahir sebelum dilunasi.
   Ini membalik ADR-046 poin 4 (tanpa backfill) — untuk data yang memang tertinggal di gerai
   berAkuntansi, bukan menulis ulang jurnal yang sudah ada (invariant #2).
4. **Tidak membuat akun baru per nama beban.** Usulan awal "buat akun sesuai nama beban"
   ditolak: setiap fakta admin sudah punya akun standar (ADR-047: 6102 Beban Gaji, 6104 Beban
   Lainnya, 6106 Beban Sewa Lapak, dst.) dan Akuntansi sudah punya jalur membuat akun sendiri
   untuk beban khusus. Membuat akun otomatis tiap nama beban akan menggandakan akun dan merusak
   keseragaman antar gerai yang dibangun ADR-047.
5. **Tidak ada angka yang diam-diam kurang**: respons laporan membawa `unposted` per gerai
   (jumlah transaksi yang belum masuk pembukuan + penyebab terbanyaknya) dan UI menampilkannya
   sebagai peringatan bersama tombol sinkron.

## Konsekuensi

- Angka Untung Rugi gerai Akuntansi sama dengan Rugi Laba di Akuntansi untuk periode yang sama.
- Selama masih ada transaksi tertahan di Setting Akuntansi (mis. cara bayar Non Tunai belum
  dipetakan, barang tanpa Jenis Barang), laporan gerai itu **kurang** sampai dibereskan;
  peringatan di layar yang menjaganya jujur. Memperbaiki penyebabnya tetap pekerjaan terpisah.
- Jika HPP produk salah (lihat KNOWN_ISSUES "HPP tidak wajar"), laporan akan menampilkan
  kesalahan itu apa adanya — jurnal dan mesin POS memakai `line_cogs` yang sama.
- Beban Kasir/Bea tidak lagi tampil sebagai empat kolom tetap untuk gerai Akuntansi; digantikan
  daftar beban per akun.
- Bea/gaji yang dicatat sebelum 0123 sudah ikut jurnal kalau memang dikirim jembatan; yang
  tertinggal disinkronkan, jadi hutang lama yang dilunasi tidak lagi membuat saldo Utang minus.

## Tambahan 2026-10-02: sinkron otomatis

Bos Cyo: "sinkron itu jadikan auto sinkron aja". Langkah sinkron (fakta POS, fakta admin,
koreksi Hitung Ulang HPP) kini satu mesin, `src/accounting-auto-sync.js`, dipakai tombol manual
dan jalur otomatis. Jalur otomatis berjalan lazy -- tanpa cron dan tanpa polling (invariant #6):
saat panel Akuntansi dibuka dan saat Laporan Untung Rugi dibaca, hanya untuk gerai
`edition = 'ACCOUNTING'`, maksimal 25 fakta per jenis per gerai per permintaan. Fakta yang sudah
dicoba dalam 15 menit terakhir dan masih gagal (mis. `NEEDS_CONFIGURATION`) dilewati supaya
membuka laporan tidak mengulang kerja yang pasti gagal dan tidak menguras kuota D1. Kegagalan
sinkron tidak pernah menggagalkan laporan. Tombol sinkron manual tetap ada dan mencoba semuanya.

## Tambahan 2026-10-02: default Jenis Barang terkunci di awal

Bos Cyo: setiap barang baru langsung masuk Jenis Barang yang tertaut ke akun Persediaan dan HPP;
HPP sementara = Harga Beli yang diisi (0 bila kosong); mengubahnya urusan Setting Akuntansi nanti.
Yang sudah ada sebelumnya: barang tanpa pilihan jenis otomatis dapat Jenis Barang bawaan
(`defaultProductKindForItemType`) dan trigger migration membuatkan Item Category (akun 1301/5101/4101)
untuk Jenis Barang baru di gerai Akuntansi. Yang ditambahkan:
- `ensureItemCategoryForKind` (`src/product-kinds.js`): jaring pengaman saat Jenis Barang dibuat dan
  saat barang disimpan -- jenis yang dibuat sebelum trigger ada / sebelum gerai pindah ke Akuntansi
  dilengkapi akunnya. Gerai non-Akuntansi tidak disentuh.
- Barang baru: `average_cost` = Harga Beli yang diisi (pembelian pertama menggantikannya lewat
  Average Cost).
- Akar masalah `NEEDS_PRODUCT_KIND` di produksi: baris transaksi lama (60 penjualan, 10 pembelian)
  punya snapshot Jenis Barang kosong karena dibuat sebelum barangnya punya jenis. Saat sinkron,
  snapshot yang kosong diisi dari Jenis Barang barang itu sekarang (`healItemKindSnapshot` di
  `src/accounting-pos-bridge.js`) -- klasifikasi saja, nominal tidak disentuh, snapshot yang sudah
  terisi tidak diubah.

## Tambahan 2026-10-03: setoran kasir (Piutang Karyawan)

Bos Cyo: selama kasir belum menyetorkan uangnya, piutangnya harus terus bertambah. Jembatan sudah ada
(tutup laci dengan setoran -> piutang `EMPLOYEE_DEPOSIT` -> jurnal Debit 1202 Piutang Karyawan / Kredit 1101 Kas;
pelunasan disetujui -> Debit Kas / Kredit Piutang), tetapi di produksi tidak pernah menghasilkan piutang:
hanya 2 dari ~40 akun kasir tertaut ke karyawan, dan akun yang tidak tertaut dilewati diam-diam. Sekarang
akun kasir tanpa tautan tetap dicatat sebagai piutang atas nama akun kasir itu (`counterparty_id = cashier:<id>`).
Jurnal pengakuan/pelunasan yang gagal setelah faktanya tersimpan dicoba ulang oleh sinkron otomatis
(`postPendingEmployeeDepositJournals`), idempoten lewat idempotency key jembatan. Catatan: piutang hanya terbentuk
kalau kasir mengisi nominal Setoran saat tutup laci (di produksi 130 dari 131 laci tutup berisi setoran 0).

## DOC-IMPACT

Perbarui kalau: pemetaan subtype akun berubah, mesin POS dipensiunkan, cache dipasang untuk
sumber jurnal, atau jenis fakta admin baru ditambahkan ke backlog sinkron, atau pemicu/jeda sinkron otomatis berubah.
