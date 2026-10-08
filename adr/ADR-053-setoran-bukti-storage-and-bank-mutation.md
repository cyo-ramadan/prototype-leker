# ADR-053: Bukti transfer setoran -- storage foto, baca otomatis, dan pondasi cek mutasi bank

Status: Diterima (2026-10-08) · Pemilik: Hana · Terkait: ADR-044 (lapisan AI), ADR-045 (Rekening Bersama), ADR-030 (entity)

## Konteks

Bos Cyo, 2026-10-08: "pasang storage untuk simpan gambar ... foto detailnya bisa otomatis kebaca
khususnya untuk hari jam menit penyetornya ... kalo mau diisi manual cs ya gpp nanti di report ditulis
isi manual. dan kedepannya aku pingin ini nanti langsung auto cek valid (sekarang masih divalidasi
admin), bikin pondasinya saja ... usahakan yang paling murah."

Fakta saat keputusan dibuat (dicek langsung, bukan dugaan):
- Foto bukti setoran SUDAH tersimpan sebagai BLOB di D1 (56--380 KB per foto). Keluhan "foto tidak
  bisa dibuka" berasal dari cara membukanya: `window.open(blob:)` ke tab baru, yang gagal di banyak HP
  (aplikasi layar utama, browser bawaan WhatsApp). Diganti penampil di halaman yang sama
  (`public/foto-lihat.js`).
- R2 belum diaktifkan di akun Cloudflare (`r2_buckets_list` -> 403 "Please enable R2 through the
  Cloudflare Dashboard"). Mengaktifkannya harus lewat dashboard oleh pemilik akun.

## Keputusan

1. **Storage**: `src/setoran-bukti.js` menyimpan ke R2 (binding `BUKTI_FOTO`) bila terpasang, dan
   jatuh ke BLOB D1 bila belum ada atau R2 gagal. Membaca mencoba kunci R2 lalu BLOB D1, jadi foto
   lama tidak pernah hilang. Binding BELUM ditambahkan ke `wrangler.jsonc`: menambah binding ke bucket
   yang belum ada menggagalkan deploy. Setelah R2 aktif: buat bucket `leker-bukti-foto`, tambah
   `"r2_buckets": [{ "binding": "BUKTI_FOTO", "bucket_name": "leker-bukti-foto" }]`.
2. **Ukuran foto**: diperkecil di HP sebelum dikirim, sisi panjang maks 1920 px (layar HP biasa),
   JPEG, maks 800 KB.
3. **Baca otomatis**: Portal Staf mengirim foto ke `/api/cashier/employee-deposits/read-proof`; isi
   bukti (tanggal, jam:menit WIB, nominal, bank, referensi, penerima) dibaca lewat lapisan AI yang sama
   dengan Una (Gemini Flash-Lite, ADR-044). Hasil disimpan per sidik SHA-256 foto
   (`setoran_bukti_bacaan`). Saat setoran dikirim, SERVER menilai asal waktu transfer: `OTOMATIS` hanya
   bila foto yang dikirim sama persis dan waktunya sama dengan hasil bacaan; selain itu `MANUAL`.
   Klien tidak bisa mengaku "otomatis". Admin/Entity Admin melihat asal ini dan peringatan bila nominal
   di foto beda dengan nominal yang diketik.
4. **Pondasi cek otomatis**: tabel `bank_mutation_entries` (uang scaled INTEGER, pemilik `entity_id`,
   unik per `provider`+`provider_ref`) dan fungsi murni `cocokkanMutasi()` (nominal persis sama, waktu
   mutasi dalam ±60 menit dari waktu transfer, mutasi belum dipasangkan; >1 kandidat = `GANDA`, tetap
   Admin). Kolom `verification_status/provider/ref/verified_at` di pembayaran; ACC Admin sekarang
   mengisi `DICEK_ADMIN`/`ADMIN`. Belum ada penerima webhook: menunggu penyedia dipilih.
5. **ACC tetap manual** sampai Bos Cyo memutuskan sebaliknya. Pencocokan otomatis kelak boleh
   menandai `COCOK`, tapi mengubah ACC jadi otomatis adalah keputusan terpisah (aturan 2026-10-04
   "ga boleh auto acc harus klik dari admin").

## Jalur cek otomatis yang diusulkan (termurah dulu)

| Jalur | Biaya kira-kira | Catatan |
|---|---|---|
| Layanan cek mutasi (mis. Moota) | sekitar Rp45.000--100.000/bulan per rekening (cek harga terbaru sebelum bayar) | Membaca mutasi Rekening Bersama tiap ~15 menit, kirim webhook. Cocok dengan pondasi ini: webhook -> `bank_mutation_entries` -> `cocokkanMutasi()`. Butuh akses internet banking rekening. |
| QRIS/Virtual Account dinamis (payment gateway) | potongan per transaksi | Tidak perlu mencocokkan foto sama sekali: CS bayar ke kode unik, gateway mengirim konfirmasi. Mahal kalau setoran sering. |
| API resmi bank (mis. BCA API) | perlu rekening/kerja sama korporasi | Paling resmi, tapi pendaftaran dan syaratnya berat untuk sekarang. |

Rekomendasi: layanan cek mutasi untuk SATU rekening (Rekening Bersama), karena semua setoran CS sudah
diarahkan ke sana (ADR-045).

## Akibat

- Foto baru di R2 (setelah aktif) tidak membebani D1 (batas 10 GB).
- Baca otomatis memakai kuota AI yang sama dengan Una; gagal baca tidak menghalangi setoran (CS isi
  manual).
- `bank_mutation_entries` belum diisi apa pun sampai penyedia dipasang.

DOC-IMPACT: ADR baru; terkait `src/setoran-bukti.js`, `src/employee-deposit-settlement.js`,
`migrations/0142_setoran_bukti_transfer.sql`, `public/foto-lihat.js`, `public/staff.js`.
