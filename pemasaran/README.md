# Pemasaran OwnerTenang — landing page & video

Dikerjakan: 2026-10-06 · Oleh: Hana · Dari brief `PROMPT-LANDING-PAGE-AHLI` (Bos Cyo, 2026-10-05).
Keputusan Bos Cyo: Una boleh tampil berlabel "Baru · sedang kami uji" (Una memang sudah aktif untuk
pemilik di semua tenant); video direkam dari data demo fiktif.

## Isi

| Berkas | Untuk |
|---|---|
| `public/produk/index.html` | Halaman A — pemilik 2–10 gerai F&B (`/produk/`, juga halaman utama domain jualan) |
| `public/produk/kemitraan/index.html` | Halaman B — usaha kemitraan/franchise (`/produk/kemitraan/`) |
| `pemasaran/video/01-absen-merah.mp4` | TikTok/Reels 9:16, 21 dtk |
| `pemasaran/video/02-hapus-struk.mp4` | TikTok/Reels 9:16, 25 dtk |
| `pemasaran/video/04-untung-semua-gerai.mp4` | TikTok/Reels 9:16, 21 dtk |

## Ringkasan desain (≤ 15 baris)

1. Satu elemen berani di halaman A: **"Coba jadi pemilik 30 detik"**. HP yang bisa disentuh berisi tiga
   kejadian (hapus struk, absen merah, laci kurang), dengan hitungan keputusan dan ajakan WhatsApp di akhir.
2. Halaman B: papan perbandingan gerai mitra yang bisa disentuh (hijau untung, merah rugi, penanda modal janggal).
3. Warna hanya untuk status, sama dengan aplikasinya. Huruf bawaan perangkat, tanpa font/skrip/gambar luar.
4. Dibuang dari halaman lama: label huruf kapital di atas setiap judul, tiga kartu seragam, dan animasi muncul per kartu.
5. Ditambah: kalkulator kebocoran (A), kalkulator biaya (B), simulasi Una (draft → "Ya, simpan"), linimasa
   yang terisi saat digulir, bagian harga, dan FAQ jujur (internet, QRIS, daftar mandiri, Una masih diuji).
6. Setiap interaksi berakhir di satu ajakan WhatsApp yang teksnya sudah terisi konteks (jumlah gerai, perkiraan bocor).
7. Mobile-first 360 px, tanpa geser samping, tombol ≥ 44 px, tetap terbaca tanpa JavaScript.
8. Video: rumus kejadian 3 dtk → layar aplikasi sungguhan → ajakan "Ketik DEMO di WhatsApp".

## Daftar klaim → pendukung (brief §1)

| Klaim di halaman/video | Pendukung |
|---|---|
| Absen foto langsung + lokasi; di luar lokasi tetap tercatat, kartu merah, jarak terlihat | 1A absen |
| Karyawan mengajukan alasan, pemilik menerima/menolak | 1A absen |
| Jadwal shift, deteksi telat, lupa absen pulang ditutup otomatis, gaji dari jam kerja | 1A absen |
| Hapus transaksi / koreksi jam / tutup laci orang lain harus disetujui pemilik/admin | 1A izin |
| Laporan izin: siapa, kapan, berapa, alasan | 1A izin |
| Laci: saldo awal lanjut otomatis, selisih langsung kelihatan | 1A kasir+laci |
| Setoran dengan foto bukti transfer, dicek admin | 1A kasir+laci |
| Bahan berkurang saat menu terjual, modal per porsi dari resep, harga beli tak wajar ditolak | 1A stok |
| Untung bersih harian per gerai; grafik hijau/merah; modal bahan antar gerai dengan penanda janggal | 1A untung |
| Banyak gerai satu akun; data tiap gerai/perusahaan/mitra dipisahkan | 1A multi-gerai |
| Gerai disiapkan bersama tim; belum bisa daftar sendiri | 1A + batas jujur |
| Una: daftar kesiapan, menu dari daftar/foto papan menu, ubah harga lewat chat, cari harga janggal, draft + "Ya" | 1B (selalu berlabel) |
| 14 gerai · 38 akun karyawan · 1.800+ penjualan · 540 barang | Bukti pemakaian (dicek ke produksi 2026-10-05) |
| Rp149.000 / Rp249.000 per gerai per bulan | Harga (§10) |
| Butuh internet; QRIS belum terhubung | Batas jujur |
| Kalkulator: "perkiraan dari angka Anda sendiri, bukan janji penghematan" | Bukan klaim produk — rumus ditulis di halaman |
| Mockup & video: Dimas, Rina, Andi, Sari, Kedai Senja, angka rupiah | Fiktif |

Tidak dijanjikan (diuji otomatis di `test/landing-page-claims.test.js`): game/poin, mode offline, QRIS
terhubung, aplikasi pelanggan, daftar gratis, royalti otomatis, istilah akuntansi di halaman, Una tanpa label.

## Merekam ulang video

Video direkam dari **aplikasi sungguhan di server lokal** dengan data fiktif "Kedai Senja" (tenant Lab,
4 gerai). Data gerai sungguhan dan database produksi tidak disentuh.

```sh
npx wrangler dev --local --port 8787            # terminal lain
node scripts/demo-kedai-senja-lokal.mjs          # isi ulang data demo (wajib sebelum tiap rekaman)
LAB_PEMILIK_PASSWORD=... node scripts/rekam-video-pemasaran.mjs /tmp/rekam [1|2|4]
ffmpeg -i /tmp/rekam/video/02-hapus-struk.webm -vf "scale=1080:1920:flags=lanczos,unsharp=5:5:0.6" \
  -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -movflags +faststart -an 02-hapus-struk.mp4
```

## Belum dikerjakan

- Video 3, 5–10 (tabel brief §6). Video 9 (Una) perlu Una yang terhubung ke layanan AI di server lokal.
- Video horizontal 16:9 ≤ 45 dtk untuk landing page.
- Akun demo di produksi untuk demo langsung ke calon pembeli (data fiktif yang sama, lewat jalur aplikasi).

<!-- DOC-IMPACT: 2026-10-06 dokumen baru; dua landing page interaktif, tiga video 9:16, daftar klaim, cara merekam ulang. -->
