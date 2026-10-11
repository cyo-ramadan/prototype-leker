# Notifikasi user dan beranda management

Status: implementasi pada branch codex/management-notifications; belum diterbitkan.
Pemilik rancangan: Codex. Arahan Bos Cyo: 2026-10-11.

## Keputusan Bos Cyo

- Pengembangan suara Una di-hold; fitur suara tidak diubah dalam pekerjaan ini.
- Admin Entity mengatur alarm khusus dan penerimanya. User mengatur bunyi dan tampilan pribadi.
- Notifikasi harus mendukung push ke HP saat aplikasi ditutup, setelah user mengaktifkannya.
- Beranda sesudah login dipilih per user dari menu Entity yang sudah ada: Laporan, Setoran CS,
  Status Laci, Gerai, Pelanggan, Buku Entity, Rekening Bersama, Master Barang, Resep Produksi, Stok Gerai, Laporan Gerai, dan Karyawan. Preferensi disimpan per akun di server.

## Aturan alarm

Alarm adalah konfigurasi data, bukan jam atau daftar gerai yang ditanam di kode.
Aturan memuat nama, jenis kondisi, pilihan gerai, jam, hari aktif, penerima, pesan,
aktif/nonaktif, dan pengulangan. Awal katalog kondisi: gerai belum buka,
setoran menunggu ACC, pengajuan menunggu persetujuan, dan pengingat terjadwal.
Mesin memakai katalog kondisi yang aman; user tidak memasukkan SQL atau menjalankan kode.
Katalog dapat diperluas saat kebutuhan management bertambah.

Contoh: gerai tertentu belum pernah membuka laci pada tanggal bisnis berjalan,
setiap Senin-Sabtu pukul 09.30 WIB, kirim kepada penerima yang dipilih Admin Entity.
Sudah buka kemudian tutup tidak dihitung belum buka. Hari nonaktif/libur yang tidak
tercentang tidak memicu alarm. Belum ada aturan default yang otomatis dinyalakan.
Dedup menjaga satu kejadian tidak dikirim berkali-kali karena refresh atau cron diulang.

## Notifikasi pribadi dan batas akses

Inbox, status sudah dibaca, preferensi dan perangkat push dimiliki identitas akun
(role + ID), bukan token sesi atau sekadar browser. Server menentukan identitas.
Admin Entity hanya dapat memilih gerai/penerima dalam entity sendiri. Preferensi
beranda tidak memberikan izin baru. Role finance/HR terpisah belum diciptakan oleh fitur ini;
beranda mengikuti akun dan kewenangan yang sudah ada.

Notifikasi umum berasal dari kejadian aplikasi yang terdaftar: setoran menunggu
pemeriksaan, keputusan setoran/pengajuan, dan pengumuman yang berlaku bagi user.
Fitur ini tidak mencatat transaksi, membuat jurnal, mengubah saldo, atau menyetujui apa pun.
Kartu setoran tetap memakai jalur ACC yang sudah ada, dengan pemeriksaan bukti dan konfirmasi.
Pin memindahkan node panel menu asli ke beranda, bukan menggandakan tampilan atau perhitungan. Filter, grafik, tabel dan event handler tetap sama; posisi asli dipulihkan saat pindah tab, lepas pin atau logout. Pin Laporan menjalankan laporan yang sudah ada dengan tanggal hari ini pada awal pemakaian; user tetap dapat mengganti periode.

## Pengiriman

Inbox tetap tersimpan saat offline. Perubahan saat aplikasi terbuka dikirim lewat
WebSocket milik tiap user, tanpa polling. Tiket koneksi singkat sekali pakai diterbitkan
sesudah autentikasi; token login tidak diletakkan dalam URL.
Pemeriksaan aturan berjalan pada scheduler server, bukan tergantung layar Bos terbuka.
Web Push menggunakan izin browser, service worker dan subscription masing-masing perangkat.
Push lock screen hanya memberi pesan generik agar angka usaha tidak terbuka pada HP terkunci.
Bunyi aplikasi memerlukan interaksi user; bunyi push diatur browser/OS dan mode senyap HP.
Push bukan alarm sistem yang dijamin berbunyi tepat waktu: jaringan, perangkat dan OS menentukan
waktu tampil. Di iOS aplikasi web perlu ditambahkan ke Home Screen untuk Web Push.

Service worker tidak menyimpan cache halaman/data bisnis. Logout/account switch mencabut
subscription perangkat yang terikat akun lama. Endpoint push divalidasi ke provider yang
terdaftar dan tidak boleh menjadi jalan akses URL sembarang.

## Bukti pengujian lokal (2026-10-11)

Build dry-run Wrangler 4.149.0 lulus: binding Durable Object, D1, R2 dan assets terbundel.
Pemeriksaan sintaks 308 perintah lulus. Regresi integrasi terakhir 73/73 lulus. Full suite Windows awal 1772/1788; sebagian gagal karena baseline CRLF/path dan ekspektasi asset lama. Ekspektasi terkait perubahan telah diperbaiki; CI Linux commit 01a2039 lulus 1800/1800 dan syntax check. Pembaruan peta kode main d0366fc membawa hash artefak yang tidak selaras; artefak dibangun ulang dari blob Git LF dan tes peta 40/40 lulus, tanpa perubahan graphify dalam fitur ini. Tes inti SQLite, pengiriman terenkripsi, isolasi entity,
tiket realtime, UI, serta route Worker dijalankan terpisah dan lulus.
Browser Chrome lokal: login fixture, pin profit/setoran, reload mempertahankan pin, form alarm,
scheduler ke inbox penerima, serta tampilan 390px diperiksa. WebSocket lokal menghasilkan 101.
Fixture hanya ada di database lokal. Migrasi lama 0056 terhenti di emulator Wrangler karena
batas compound SELECT; sisa fixture lokal diterapkan dengan Node SQLite, tanpa menyentuh produksi.

Inbox dan outbox push dibuat dalam satu batch atomik. Provider push dipanggil oleh cron setelah
aturan dievaluasi; membaca inbox dan menyimpan fakta bisnis tidak menunggu jaringan provider.
Antrean diproses maksimal 20 notifikasi per putaran, retry bertahap sampai enam percobaan.
Dengan demikian pengiriman dapat menunggu putaran menit berikutnya; waktu tampil di HP juga
bergantung jaringan, browser dan OS. Alarm bukan alarm kritis yang menjamin bunyi tepat detik.

## Konfigurasi push sebelum penggunaan

Konfigurasi produksi 2026-10-11: tiga secret VAPID ditambahkan melalui Cloudflare API dan nama-namanya diverifikasi ulang; secret lama tetap ada. Nilai private key tidak dicetak atau disimpan di repo. Worker memerlukan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY dan VAPID_SUBJECT. Kunci dibuat sekali;
jangan rotasi saat sudah ada subscription. scripts/setup-notification-push.mjs menyediakan
mode --json untuk pipe langsung ke secret bulk, tidak untuk dicetak ke log/chat.
Aktivasi di perangkat tetap dilakukan user melalui tombol Notifikasi. Izin tidak diminta saat login.

## Verifikasi yang wajib

- Dua entity dan dua user tidak bisa membaca/mengubah inbox atau aturan satu sama lain.
- Jam sebelum/sesudah cutoff, hari aktif, sudah buka lalu tutup, nonaktif, dedup dan repeat.
- Preferensi bertahan sesudah login ulang dan berbeda antar akun.
- Setoran masuk memicu inbox/push; pemeriksaan dan ACC tetap jalur existing.
- Subscription salah, provider palsu, tiket kedaluwarsa/replay dan logout ditolak dengan benar.
- Push HP sungguhan harus diuji pada perangkat yang mengaktifkan izin; tes unit tidak membuktikannya.
- npm run check (Windows dijalankan per perintah bila panjang command melebihi batas), npm test.

<!-- DOC-IMPACT: 2026-10-11 rancangan dan keputusan notifikasi management, push HP,
alarm konfigurabel, beranda pribadi; status belum live. -->