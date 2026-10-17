# ADR-058: Dana Apresiasi Backup & Denda Ketidakhadiran CS

Status: diterima (Bos Cyo, 2026-10-15). Migration 0162. Kode: `src/dana-apresiasi.js`,
`src/dana-apresiasi-api.js`, `public/entity-dana-apresiasi.js`, `public/pengganti-presensi.js`.

## Konteks

CS normal dibayar Rp5.600/jam. Saat CS asli berhalangan, backup dibayar Rp8.000/jam -- selisih
Rp2.400 ("dana apresiasi") seharusnya dibayar CS asli yang berhalangan, bukan perusahaan. Kalau tidak
ada backup, gerai tetap rugi (sewa lapak jalan, bahan basi), jadi CS asli tetap membayar apresiasi
ditambah denda.

## Keputusan

1. Mekanisme unik usaha -> opsi. Saklar di Entity Admin -> Pengaturan: bawaan entity + override per
   gerai, **default ON**. OFF = perilaku sebelum fitur ini. Menyalakan dari OFF hanya berlaku mulai
   hari dinyalakan (`enabled_since`); paling awal `APRESIASI_BERLAKU_MULAI`.
2. Status akun kasir CS asli / freelance (`cashier_cs_status`; tanpa baris: akun backup entity =
   freelance, lainnya CS asli). Hanya CS asli yang dinilai, per shift jadwalnya.
3. Penilaian lazy (tanpa cron) satu jam setelah jam pulang shift, saat riwayat/rekap/portal dibaca:
   menit shift yang tidak dijaga CS asli (tidak masuk, telat, pulang awal) dipecah jadi
   - dijaga sesi akun lain yang menggantikan -> `POTONG_BACKUP` (CS asli) + `FEE_BACKUP` (backup);
   - kosong -> `POTONG_KOSONG`;
   - denda shift kosong penuh / sebagian -> `DENDA`.
   Nominal: menit x tarif/60, scaled integer. Hutang gaji boleh minus (invariant #8).
4. "Menggantikan siapa": otomatis dari jadwal (sesi akun lain yang menutup jam bolong CS asli; CS asli
   lain di dalam shift-nya sendiri tidak dihitung). Akun freelance mengonfirmasi saat presensi masuk
   (`apresiasi_pengganti`), Entity Admin bisa mengoreksi -> shift dinilai ulang: baris revisi lama
   dibatalkan dan jurnalnya dibalik di tanggal shift, baris baru diposting.
5. Alasan syar'i: tidak ada pengajuan izin dari CS. Entity Admin menekan **Penyesuaian** pada baris
   potongan/denda; bawaannya membalik penuh (seperti soft delete), nominal & keterangan bisa diubah.
6. Akuntansi lewat akun penampung, bukan pendapatan+beban bruto. Satu jurnal per baris (fakta
   `APRESIASI`, sumber LEKER_ADMIN = cerminan operasional), atas nama pemilik baris di Utang Gaji:
   - POTONG_BACKUP: Debit Utang Gaji / Kredit 2105 Dana Apresiasi Backup (dibuat otomatis);
   - FEE_BACKUP: Debit 2105 / Kredit Utang Gaji;
   - POTONG_KOSONG, DENDA: Debit Utang Gaji / Kredit 4202 Pendapatan Lainnya;
   - PENYESUAIAN: kebalikan; bagian jam backup ditanggung Beban Gaji (backup tetap dibayar).
   Beban Gaji di laba rugi tetap hanya tarif dasar.
7. Riwayat gaji (Portal Staf, Entity Admin, Pembayaran Hutang Gaji) membaca `apresiasi_entries` sebagai
   fakta operasional, dengan satu referensi `APR-xxxxxx` yang sama di sisi CS asli dan backup.
8. Rekap harian/bulanan di Entity Admin: apresiasi masuk vs keluar (selisih harus 0, merah bila
   tidak), jam kosong, denda, penyesuaian.

9. Revisi jam presensi oleh CS (2026-10-17, `src/attendance-revision-permit.js`): CS mengajukan revisi
   jam masuk/pulang sesi mana pun (juga yang sudah selesai & dijurnal) atau sesi baru bila lupa
   presensi, tanpa batas waktu. Owner/Entity Admin: ACC, edit lalu ACC, atau tolak (Izin CS). ACC = jam
   diganti (asli disimpan di `original_created_at`/`original_check_out_at`), baris gaji sesi itu
   dibatalkan + jurnal GAJI_PRESENSI dibalik di tanggal sesi, gaji revisi dicatat
   (`source_id = <attendance>#rev-<permit>`) dan dijurnal, dana apresiasi shift itu dinilai ulang.
   Menggantikan permit koreksi jam masuk 0129 untuk pengajuan baru (yang lama tetap tampil statusnya).

## Konsekuensi

- Freelance dibayar tarif di akunnya + fee apresiasi saat menggantikan. Supaya totalnya Rp8.000,
  tarif dasar freelance diisi Rp5.600 -- pengaturan menampilkan peringatan untuk tarif freelance yang
  masih Rp8.000 (tidak diubah otomatis).
- Jadwal CS asli harus benar (hari libur ditandai Libur). Jadwal yang tidak dijalani (akun lama, gerai
  belum buka) akan menghasilkan denda -> ubah status/jadwal atau matikan saklar gerainya.
- Gerai tanpa Akuntansi (edition LITE) tetap punya baris riwayat, tanpa jurnal; laporan untung rugi
  LITE tidak menampilkan denda sebagai pendapatan.
- Belum: jam operasional hanya dipakai untuk peringatan, tidak untuk menilai.

<!-- DOC-IMPACT: 2026-10-15 ADR baru dana apresiasi & denda CS. -->
