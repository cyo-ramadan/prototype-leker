# ADR-054: Buku Akuntansi sebagai sumber angka uang per orang

Status: Diterima (2026-10-08) · Pemilik: Hana · Terkait: ADR-051 (Untung Rugi dari jurnal), ADR-047
(akun standar), migration 0138 (label "atas nama"), `POS_MODULE_INDEPENDENCE.md` (koreksi visi 2026-10-04)

## Konteks

Bos Cyo, 2026-10-08, setelah bertanya di mana akuntan memasukkan penyesuaian Riwayat Gaji dan
Riwayat Setoran (jawabannya: jurnal manual Hutang Gaji tidak pernah muncul di Riwayat Gaji):

> "kenapa engga acuan datanya itu dari akuntansi aja ... program menghitung lalu keluar angka
> outputnya, nah outputnya harus/wajib/fardhu ain masuk ke akuntansi. nah data akuntansi itulah yang
> ditampilkan di semua data tentang keuangan ... setiap bikin tenant atau gerai baru wajib banget
> untuk konekin jurnal wajibnya ... ketika dia minta fitur baru nah kita wajib memikirkan akun dan
> mekanisme jurnal apa yang nanti jalan di fitur itu waktu pengerjaan kodingnya."
>
> "riwayat gaji dan setoran itu akan tertulis ditrigger dari akuntansi ya, ketika akun tersebut
> dipanggil"

Fakta saat keputusan dibuat (D1 produksi, 2026-10-08):

- 12 gerai berjurnal, ±5.000 jurnal / ±15.000 baris dalam 55 hari (±270 baris/hari). Membaca saldo
  satu orang hanya membaca baris orang itu (indeks per akun dan per karyawan), jadi tidak berat.
- 16 fakta tertahan `NEEDS_CONFIGURATION`, semuanya lama (terakhir 2026-09-24 BEJI); nol sejak akun
  standar dipasang. Gerai LITE tinggal IKAN01.
- Jurnal otomatis pada akun bernama TIDAK membawa nama: 39 baris setoran (1202), 15 gaji presensi dan
  2 Bea Gaji (2102), 3 hutang Bea (2101/2103). Hanya jurnal manual akuntan yang bernama (0138).
- Saldo setoran per gerai di buku = saldo setoran di Operasional untuk ketujuh gerai yang punya
  setoran (dicek per gerai), jadi pindah sumber tidak mengubah angka yang dilihat hari ini.

## Keputusan

1. **Setiap output program yang menyangkut uang wajib masuk Akuntansi** -- tidak berubah dari
   invariant #4: Operasional mengirim fakta, Accounting yang memposting.
2. **Baris jurnal pada akun bernama selalu membawa "atas nama siapa"**, termasuk jurnal otomatis.
   `postAccountingJournal` menerima `lineParties` (sejajar dengan baris) dan menulis label ke
   `accounting_party_entries` dalam batch yang sama. Jurnal pembalik mewarisi label baris aslinya
   otomatis. Yang sudah memberi nama: setoran CS (pengakuan & pelunasan), gaji presensi (karyawan,
   atau `cashier:<id>` untuk akun belum ditautkan), Bea Gaji, Bea Lapak/Lainnya (pihak yang
   dihutangi), pelunasan hutang (pihak yang dibayar; Piutang CS bila dibayar dari setoran).
   Migration 0143 menempelkan label yang sama ke jurnal otomatis lama -- hanya menambah label, jurnal
   tidak diubah.
3. **Angka uang per orang yang ditampilkan = saldo menurut buku** (`src/riwayat-dari-buku.js`,
   `saldoMenurutBuku`). Rincian tetap dari fakta operasional (jam kerja, foto, status ACC); jurnal di
   luar fakta operasional (jurnal akuntan, Una, dst.) tampil sebagai "Penyesuaian dari Akuntansi".
   Diterapkan pada: Riwayat Gaji (Admin Gerai, Entity Admin, Portal Staf), sisa Hutang Gaji di Hutang
   Piutang, Riwayat/saldo Setoran (Admin Gerai, Entity Admin, Portal Staf).
4. **Tidak ada angka yang diam-diam salah**: fakta operasional di gerai berAkuntansi yang jurnalnya
   belum ada tampil sebagai "belum masuk pembukuan", tidak dijumlahkan ke saldo. Gerai tanpa Akuntansi
   (LITE) tetap memakai fakta operasional.
5. **Buku disambungkan dulu sebelum dibaca**: saat riwayat dibuka, fakta gaji/setoran/pelunasan
   yang belum terjurnal di gerai orang itu disambungkan (`syncPeopleFacts`, lazy tanpa polling,
   cooldown 15 menit untuk yang macet), termasuk membalik jurnal milik fakta yang sudah dibatalkan
   tetapi pembaliknya belum ada (`pendingAdminReversals`).
6. **Gerai baru lahir lengkap**: pembuatan gerai memanggil `pasangJurnalWajib`
   (`src/gerai-jurnal-wajib.js`) -- akun 1202 dan aturan jurnal Beban Kasir. Migration 0144
   memasang ulang trigger 1202 yang terbukti hilang di produksi dan melengkapi gerai lama yang kurang
   (LAB01, PARFUM01: 1202; KANTOR, LAB01, PARFUM01: aturan Beban Kasir). Hanya mengisi yang kosong.
7. **Penjaga otomatis**: `test/buku-atas-nama-otomatis.test.js` gagal bila ada modul baru yang
   memposting jurnal tanpa memberi nama pihak dan tanpa alasan tertulis. Daftar pengecualian hanya
   boleh menyusut. Pembuat fitur baru wajib menulis akun, jurnal, dan "atas nama siapa" di task-nya.

## Yang belum (tahap berikutnya)

- Jurnal kasir ke Piutang Pelanggan 1201 / Utang Usaha 2101 (`accounting-pos-bridge.js`) belum
  bernama -- tercatat sebagai celah di penjaga.
- Jurnal Beban Rutin/Split (ADR-049) pada akun bernama belum bernama.
- Daftar pemegang setoran di Bayar Hutang (`listSetoranHolders`) dan baris Piutang Setoran di Laporan
  Hutang Piutang masih dari fakta operasional (angkanya sama dengan buku hari ini).
- 16 transaksi kasir lama tertahan Setting Akuntansi (2026-08-13 s.d. 2026-09-24: 9 penjualan G001
  barang tanpa Jenis Barang, 6 penjualan Non Tunai PENDEM/BEJI yang cara bayarnya belum ditautkan ke
  akun, 1 pembelian PENDEM dengan alokasi ganda) -- keputusan akuntansi, menunggu Bos Cyo/akuntan.

## Konsekuensi

- Koreksi akuntan cukup di satu tempat (jurnal), semua riwayat ikut.
- Fitur baru yang menyentuh uang otomatis tampil di riwayat orangnya selama jurnalnya bernama.
- Jurnal yang tertahan Setting Akuntansi membuat saldo orang itu kurang sampai disambungkan; tanda
  "belum masuk pembukuan" yang menjaganya jujur.

DOC-IMPACT: ADR baru; terkait `src/accounting-ledger.js`, `src/accounting-party-ledger.js`,
`src/riwayat-dari-buku.js`, `src/accounting-admin-bridge.js`, `src/accounting-employee-deposit-bridge.js`,
`migrations/0143_label_nama_jurnal_otomatis.sql`, `migrations/0144_gerai_jurnal_wajib.sql`,
`src/gerai-jurnal-wajib.js`, `src/accounting-auto-sync.js`, `test/buku-atas-nama-otomatis.test.js`,
`test/gerai-jurnal-wajib.test.js`.
