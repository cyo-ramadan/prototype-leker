# ADR-056: Sinkronisasi Akuntansi untuk riwayat uang per orang

Status: Diterima (2026-10-13) · Pemilik: Eskor · Terkait: ADR-054 (buku Akuntansi sumber angka per
orang), migration 0153

## Konteks

Akuntan Bos Cyo menemukan riwayat Setoran dan Hutang Gaji di panel Entity, Portal Staf, buku besar,
dan Akuntansi tidak sama untuk sebagian karyawan. Penyebabnya data lama dari masa aturan pencatatan
belum ketat:

- akun kasir dulu tidak wajib ditautkan ke nama karyawan, jadi jurnalnya ada di Akuntansi tapi tidak
  "ke-claim" di Portal;
- sebagian gerai dulu belum tersambung ke Akuntansi, jadi faktanya tercatat di Portal tapi tidak di buku;
- gaji presensi yang ditutup tidak lewat presensi pulang tidak pernah masuk `payroll_ledger_entries`.

Membetulkannya dengan jurnal manual tidak menyelesaikan masalah: jurnal manual atas nama orang itu
ikut tampil di Portal sebagai "Penyesuaian dari Akuntansi", sehingga selisihnya tetap ada.

> Bos Cyo: "tombol sinkronisasi di panel entity admin. ketika tombol di klik yang berubah hanya di
> portal staff di entity dsb. semuanya menambahkan 1 baris transaksi dengan nama sinkronisasi
> akuntansi ... baris penyesuaian tadi tidak masuk di akuntansi."

## Keputusan

1. **Buku Akuntansi tetap satu angka acuan (ADR-054) dan tidak disentuh.**
2. Per karyawan, per gerai berAkuntansi, per jenis (Setoran = 1202, Gaji = 2102), dalam sisi normal akun:
   `selisih = jurnal otomatis fakta (mirror) − fakta operasional − sinkronisasi aktif`.
   Jurnal penyesuaian tampil di kedua sisi, jadi tidak ikut dihitung.
3. Tombol **Sinkronisasi Akuntansi** (Entity Admin → Karyawan) menampilkan pratinjau semua selisih
   dengan centang (bawaannya semua). Satu kali simpan menambah satu baris `people_balance_syncs` per
   item sebesar selisihnya. Baris itu tampil di Portal Staf dan panel Entity sebagai
   "Sinkronisasi Akuntansi".
4. `people_balance_syncs` berada di luar semua jembatan Akuntansi, jadi tidak pernah dijurnal.
   Tes menjaga agar tidak ada modul `src/accounting-*` yang membacanya.
5. Server selalu menghitung ulang selisih saat menyimpan. Item yang sudah sama dilewati, jadi klik
   berkali-kali tidak dobel. Item yang angkanya berubah sejak pratinjau ditolak (`BERUBAH`).
6. Baris bisa dibatalkan (wajib alasan, `voided_at`). Tidak ada penghapusan.
7. Gerai tanpa Akuntansi tidak ikut, karena tidak punya buku.

## Akibat

- Selisih dari data lama hilang tanpa mengubah laporan Akuntansi.
- Sinkronisasi hanya menyamakan angka, bukan mencari sebabnya. Selisih karena uang memang kurang ikut
  tertutup bila dicentang, jadi pratinjau wajib dicek akuntan dulu.
- Jurnal pada 1202/2102 tanpa nama orang tetap tidak tercatat atas nama siapa pun, sehingga tidak
  ikut disinkronkan.
- Supaya selisih tidak lahir lagi, masih perlu aturan ketat: akun CS wajib tertaut ke nama karyawan
  sebelum presensi atau buka laci, dan jurnal 1202/2102 wajib bernama. Itu belum dikerjakan di ADR ini.

DOC-IMPACT: `migrations/0153_sinkronisasi_akuntansi.sql`, `src/sinkron-akuntansi.js`,
`src/sinkron-akuntansi-baris.js`, `src/employee-ledger-view.js`, `src/employee-deposit-settlement.js`,
`src/staff-portal.js`, `public/entity-sinkron-akuntansi.js`, `public/entity-admin.js`, `public/staff.js`,
`test/sinkron-akuntansi.test.js`.
