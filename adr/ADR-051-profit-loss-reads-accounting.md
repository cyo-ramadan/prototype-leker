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

## DOC-IMPACT

Perbarui kalau: pemetaan subtype akun berubah, mesin POS dipensiunkan, cache dipasang untuk
sumber jurnal, atau jenis fakta admin baru ditambahkan ke backlog sinkron, atau pemicu/jeda sinkron otomatis berubah.
