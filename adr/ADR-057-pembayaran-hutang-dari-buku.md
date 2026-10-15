# ADR-057: Pembayaran Hutang membaca hutang dari buku + master nama fleksibel

Status: Diterima (2026-10-14) · Pemilik: Eskor · Terkait: ADR-054 (buku Akuntansi sumber angka per
orang), migration 0138 (atas nama), tanpa migration baru

## Konteks

Akuntan mencatat hutang sewa lapak lewat jurnal manual: Debit 1401 Uang Muka/Deposit / Kredit 2101
Utang Usaha, atas nama bebas ("Spbu Beji", "Spbu Genengan", "Kaliurang"). Hutang itu tidak muncul di
layar Pembayaran Hutang dan tidak bisa dibayar di sana, karena `buildHutangPiutangSummary` hanya
membaca sub-buku Operasional (`operational_receivables_payables`) + Hutang Gaji. Nama sudah wajib
(PARTY_RULES); masalahnya layar Pembayaran Hutang tidak membaca buku.

> Bos Cyo: Pembayaran Hutang membaca dari buku per nama (seperti gaji); nama baru dikonfirmasi masuk
> master, nama mirip ditanya "Maksudnya X?" supaya satu orang tidak terpecah dua nama.

## Keputusan

1. Akun **BUKU:<kode>** di Pembayaran Hutang untuk 2101 & 2103 (hutang, bisa dibayar) dan 1201
   (piutang, tampil saja). Saldo per nama = baris jurnal POSTED bernama pada akun itu **di luar** jurnal
   cerminan fakta Operasional (LEKER_ADMIN/_VOID, LEKER_POS/_VOID, EMPLOYEE_DEPOSIT) − pelunasan BUKU
   yang belum dibatalkan. Hutang Bea Operasional/pembelian tetap dibaca dari sub-bukunya (sudah dijurnal
   bernama ke 2101) -> tidak terhitung dua kali.
2. Pelunasan = baris `admin_payments` ber-`hutang_account` `BUKU:<kode>` (kolom teks bebas, tanpa
   migration). Jembatan Akuntansi menjurnal Debit akun `<kode>` atas nama yang sama / Kredit cara bayar.
   Batal = pembalik yang mewarisi nama. Pelunasan yang jurnalnya tertahan Setting tetap mengurangi saldo
   di layar (tidak dibayar dua kali) dan tampil sebagai "belum masuk pembukuan".
3. Pengelompokan per nama = jenis + id pemasok, atau nama (huruf kecil) -- sama dengan sub-buku
   Operasional, jadi satu orang dengan hutang Bea dan hutang jurnal tampil di satu baris.
4. **Master nama fleksibel** (`src/nama-pihak.js`, `public/nama-pihak-ui.js`): daftar nama = Master
   Supplier + nama bebas yang pernah dipakai (buku & Operasional), tanpa tabel baru.
   - Server: nama yang sama setelah dinormalkan (huruf besar/kecil, spasi, tanda baca) otomatis memakai
     nama/pemasok yang sudah ada (jurnal manual, Jurnal Split, Bea Operasional).
   - UI (Buat Jurnal, Jurnal Split, Bea Operasional): nama mirip -> "Maksudnya 'X'?"; ya = pakai X dan
     tulisan aslinya masuk keterangan. Nama baru -> "Tambahkan sebagai pemasok/nama baru?"; untuk akun
     pemasok (2101) nama baru masuk Master Supplier.
5. Keterangan tetap terpisah dari atas nama.

## Akibat

- Hutang sewa lapak BEJI/GENENGAN/KALIURANG langsung tampil dan bisa dibayar dari Pembayaran Hutang.
- Kalau nanti jurnal pembelian kasir (LEKER_POS) mulai bernama, ia sudah dianggap cerminan sub-buku
  pembelian -- tidak dobel.
- Belum: versi lintas gerai di Entity Admin; piutang 1201 belum bisa "diterima" dari layar ini.
