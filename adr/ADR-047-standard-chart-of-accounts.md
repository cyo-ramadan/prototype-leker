# ADR-047 — Akun standar yang sama di semua gerai (custom ditunda)

Status: ACCEPTED (Bos Cyo, 2026-09-27)

## Context

Sampai 2026-09-27 admin tiap gerai bisa membuat akun sendiri (kode `ACC-xxxxxx` dari
`createAccountingAccount`). Hasilnya daftar akun berbeda-beda: Beji punya "Hutang Gaji Elma",
Genengan punya "Hutang Gaji Uswatun"; 8 gerai KPM punya "Piutang Poci Malang", "Hutang Sewa
Lapak", dst. Kode yang sama berarti akun berbeda di tiap gerai (Beji `ACC-000006` = Hutang Gaji
Elma, Genengan `ACC-000006` = Hutang Gaji Uswatun). Jurnal otomatis (ADR-046) tidak bisa berlaku
seragam di atas daftar yang berbeda-beda.

Bos Cyo, 2026-09-27: "aku pingin akun2 nya sinkron dulu, engga custome per tenant dan gerai dulu.
agar pelanggan tenant baru juga lebih gampang menyesuaikan ... akun2 yang saat ini ga konek
otomatis dengan sistem ... mending dihapus aja ... untuk custom nya itu step setelah program dasar
ini selesai." Saldo lama: "Pindah saldo lalu tutup". Akun baru: "Kunci dulu". DERMO: "gerai ini
emang custome sih, karna ada 2 owner yang kerjasama. kusus gerai itu biarkan bisa custom dulu."

## Decision

1. **Saklar `stores.custom_accounts_allowed`** (migration 0124). Default 0 = akun standar saja,
   termasuk gerai baru. DERMO = 1.
2. **Gerai standar dikunci**: `createAccountingAccount` dan `updateAccountingAccount` menolak
   dengan `STANDARD_ACCOUNTS_LOCKED`; trigger `trg_chart_of_accounts_standard_lock` menolak INSERT
   akun `ACC-%` sebagai penjaga terakhir. UI Data Akun menyembunyikan form tambah/ubah.
3. **Peta nama → akun standar** di tabel `accounting_standard_account_aliases` (pola nama + tipe
   akun; tipe sumber dan tujuan wajib sama):

   | Akun buatan gerai | Akun standar |
   |---|---|
   | Piutang Poci Malang | 1103 Rekening Bersama |
   | Beban Dibayar Dimuka / Uang Muka | 1401 Uang Muka / Deposit |
   | Hutang Gaji <nama> | 2102 Utang Gaji |
   | Hutang Sewa Lapak, Hutang kepada Suplier Poci | 2101 Utang Usaha |
   | Hutang Hari Leker | 2103 Utang Lain-lain |
   | Beban Sewa Lapak | 6106 Beban Sewa Lapak |

   Cara bayar "Piutang Poci Malang" (dulu ke 1201) juga diarahkan ke 1103 — uang lewat rekening
   pusat adalah Rekening Bersama.
4. **Migration 0124 hanya konfigurasi**: membuat 1401/6106 yang belum ada, mengarahkan aturan
   jurnal/cara bayar/kategori/pilihan ke akun standar, menghapus akun custom yang tidak pernah
   dipakai, menutup akun custom bersaldo nol yang punya riwayat jurnal. Tidak menulis jurnal.
5. **Saldo dipindah lewat jurnal resmi**: tombol "Samakan ke Akun Standar" (tab Akuntansi → Data
   Akun; `POST /api/admin/accounting/standardize-accounts`, `src/accounting-standardize.js`)
   memposting satu jurnal `ACCOUNT_STANDARDIZE` lewat `postAccountingJournal` (balance exact),
   lalu menutup akun lamanya. Idempotency key = hash isi pemindahan; klik ulang tanpa saldo tersisa
   tidak membuat jurnal. Akun tanpa pasangan di peta tidak disentuh dan dilaporkan.

## Consequences

- Per 2026-09-27 yang perlu diklik: Beji (Piutang Poci Malang Rp566.000 kredit + 3 Hutang Gaji
  per orang), Genengan (Piutang Poci Malang + 2 Hutang Gaji), Pendem (Piutang Poci Malang),
  Sugiono (Piutang Poci Malang). Saldo kredit di akun ASSET (Piutang Poci Malang) ikut pindah apa
  adanya ke Rekening Bersama — invariant #8, bukan bug.
- Rincian gaji per orang tidak lagi di akun; ada di Laporan Hutang Piutang (ADR-046).
- Pelunasan Bea Lapak memakai akun Utang di aturan saat ini (`buildBayarHutang`), jadi setelah
  0124 hutang lapak lama di "Hutang Sewa Lapak" tetap nyambung karena saldonya ikut dipindah ke 2101.
- DERMO tetap bebas; tombolnya menolak dengan `CUSTOM_ACCOUNTS_ALLOWED`.
- Membuka custom lagi = tahap berikutnya (keputusan Bos Cyo), bukan sekadar menyalakan saklar:
  jurnal otomatis tetap hanya mengenal akun standar.

## Related

`ADR-046`, `ADR-045` (Rekening Bersama), `ADR-030` (store bukan tenant).

## DOC-IMPACT

Perbarui kalau: akun standar bertambah/berubah, peta nama bertambah, gerai lain diizinkan custom,
atau tahap custom per tenant dimulai.
