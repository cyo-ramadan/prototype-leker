# Gateway WA lokal — OwnerTenang

Pemilik implementasi: Codex. Status: prototipe lokal penerima pesan, belum produksi.
Keputusan Bos Cyo 22 Oktober 2026: memilih koneksi perangkat tertaut seperti Whapi dan menerima risiko tidak resmi.
Ini eksperimen terpisah dari jalur resmi percetakan di ADR-055. Tidak mengubah modul produksi, H1–H5, database D1, atau akun tenant yang ada.

## Yang tersedia

- Panel browser Bahasa Indonesia di laptop; satu nomor/tenant per proses.
- Scan QR perangkat tertaut lewat Baileys 7.0.0-rc14 (versi dipatok + package-lock).
- Sesi terenkripsi AES-256-GCM di SQLite, signal keys tersimpan transaksional.
- Pesan personal masuk dicatat sekali per kombinasi chat + ID pesan. Tenant dipilih oleh konfigurasi proses, bukan isi pesan.
- Lampiran dokumen/foto/audio/video diunduh streaming sampai 25 MiB, diberi SHA-256, dan hanya bisa diunduh setelah login. Nama kiriman tidak dipakai sebagai path disk.
- QR/status/kotak masuk diperbarui dengan SSE; tidak ada polling periodik pada panel.
- Unduh 100 pesan terbaru sebagai JSON; halaman lebih lama tersedia di panel/API melalui `before`.
- Sesi dapat digunakan lagi saat aplikasi dijalankan ulang. Koneksi terputus dicoba maksimal lima kali per sesi tombol Sambungkan, kemudian perlu tindakan operator. Logout/replaced/forbidden menghentikan percobaan otomatis.
- Hentikan koneksi mempertahankan sesi. Scan ulang sesi menghapus autentikasi lokal, bukan arsip; lepaskan perangkat lama dari HP bila masih terdaftar.

## Menjalankan di laptop Windows

Perlu Node.js 22 (>=22.13) atau 24 (diuji pada 24.21.0), internet, dan nomor WA yang pemiliknya mengizinkan ditautkan.

```powershell
cd C:\Users\Asus\wt-codex-wa-gateway\wa-gateway
npm ci --ignore-scripts
npm start
```

Atau setelah dependensi terpasang, klik dua kali `jalankan.cmd`.

1. Buka http://127.0.0.1:8788 (gunakan alamat ini, bukan localhost).
2. Buka `data/cetak01/admin.token` dengan Notepad dan salin kunci ke form login. Jangan kirim kunci atau QR ke chat.
3. Tekan **Sambungkan WhatsApp**, lalu pada HP buka WhatsApp → Perangkat tertaut → Tautkan perangkat dan scan QR panel.
4. Minta seseorang mengirim pesan uji dan PDF kecil ke nomor tersebut. Periksa kotak masuk dan unduhan, lalu kirim ulang event yang sama melalui tes otomatis untuk deduplikasi.
5. Untuk berhenti, Ctrl+C pada terminal. Tombol Hentikan koneksi memutus WA, tetapi panel tetap berjalan.

Tidak ada nomor yang ditautkan oleh Codex. Pengujian langsung memerlukan scan QR pemilik nomor; tes otomatis menggunakan socket tiruan, bukan akun WhatsApp.

Tenant lain dijalankan pada proses/port berbeda:

```powershell
$env:WA_TENANT = 'percetakan-b'
$env:WA_PORT = '8789'
npm start
```

`WA_TENANT` hanya huruf, angka, underscore, dan dash, maksimal 48 karakter. Data setiap tenant berada di `data/<tenant>/`. Satu folder tenant hanya boleh dibuka satu proses gateway. Ini pemisahan lokal, bukan login SaaS tenant bersama; administrator laptop dapat membaca semua folder.

Untuk mencoba memakai sesi tersimpan otomatis ketika program mulai, set `$env:WA_AUTOCONNECT='1'` sebelum `npm start`. Program tetap harus dijalankan lagi setelah Windows menyala; belum memasang layanan/autostart Windows.

## Batas yang perlu diketahui

- Koneksi ini **tidak resmi dan tidak memiliki jaminan bebas ban atau persentase risiko yang terbukti**. Mode menerima saja menghindari fitur blast, tetapi tidak menghapus risiko dari penggunaan klien tidak resmi. Tidak ada rotasi nomor/proxy atau trik menyamarkan perilaku.
- Tidak ada API kirim, balasan AI, broadcast, scraping grup/kontak, baca status, impor sejarah penuh, atau pencetakan otomatis. Baileys tetap melakukan lalu lintas protokol yang diperlukan untuk perangkat tertaut.
- Pesan grup, pesan sendiri, status, pesan sekali lihat dan pesan sementara yang dibungkus ephemeral diabaikan. Dukungan jenis pesan tidak mencakup seluruh fitur WA.
- Jangan menganggap riwayat lengkap ketika laptop mati. Sinkronisasi ulang tergantung WhatsApp; pesan atau file bisa tidak tersedia lagi. Program tidak menjanjikan kelengkapan arsip, bukti hukum, atau arsip anti-ubah oleh administrator laptop.
- File >25 MiB ditandai TOO_LARGE; file gagal diunduh ditandai FAILED dan bisa dicoba ulang saat tersambung. Tidak ada antivirus bawaan; jangan membuka lampiran asing tanpa pemeriksaan.
- Pengiriman keluar, webhook cloud, pencatatan langsung ke antrean cetak/Fina, onboarding pelanggan SaaS, pemasangan otomatis Windows, dan paket installer/Android APK belum dibuat. Integrasi itu menyentuh modul lain dan harus dikerjakan terpisah dengan pemeriksaan tenant serta konfirmasi order.
- Baileys versi terpasang masih release candidate. Perubahan protokol WhatsApp dapat memerlukan pemeliharaan; membuat sendiri bukan bebas biaya perawatan.

## Penyimpanan dan keamanan

Server terikat **127.0.0.1 saja**, menolak Host lain, tanpa CORS, dengan kunci acak 256-bit dan cookie HttpOnly/SameSite=Strict. Mutasi hanya diterima dari origin panel sendiri. Jangan buka port lewat tunnel atau reverse proxy. Tidak ada secret di Git. Launcher membatasi akses fs/proses dan tidak meneruskan secret environment lain. Ini pagar tambahan, bukan sandbox anti-malware; lihat SECURITY-REVIEW.md. Jalankan dengan npm start atau jalankan.cmd agar pembatasan aktif.

Database menyimpan teks/identitas pesan tanpa enkripsi menyeluruh; sesi dan payload mentah dienkripsi, tetapi kunci dekripsinya berada di disk yang sama. Ini tidak melindungi dari orang yang menguasai akun Windows/laptop. Gunakan akun Windows pribadi, akses folder terbatas, dan enkripsi disk. `mode 0600/0700` tidak menggantikan ACL Windows. Hindari folder berbagi dan sinkronisasi publik.

Cadangkan seluruh `data/<tenant>` **setelah gateway dihentikan**, termasuk database, lampiran dan `session.key`; jangan menyalakan dua salinan sesi sekaligus. `admin.token` adalah akses penuh panel. Untuk menggantinya, hentikan program, hapus berkas admin.token lokal saja, lalu jalankan program kembali. Program akan membuat kunci baru. Login browser kedaluwarsa ketika proses dimulai ulang.

Folder data diabaikan Git. Tidak ada jadwal penghapusan otomatis: operator bertanggung jawab atas persetujuan pencatatan, retensi dan ruang disk. Jangan menaruh data pelanggan di commit atau laporan tes.

## Pengujian dan serah terima

```powershell
npm run check
npm test
```

Jalankan di folder gateway untuk tes khusus; dari root repo juga jalankan `npm run check` dan `node --test`, bandingkan kegagalan lama dengan baseline main. `npm audit --omit=dev` memeriksa dependensi; hasil nol bukan jaminan keamanan menyeluruh.

Tes mencakup isolasi, duplikat, penyimpanan sesi, penolakan akses, CSRF/Host, reconnect, ukuran unduhan, dan mode tanpa kirim. Belum membuktikan koneksi akun nyata, masa hidup sesi WhatsApp, penerimaan saat laptop mati, atau kemungkinan ban.

Sumber implementasi: API dan tipe dari paket Baileys yang terpasang, [repositori Baileys](https://github.com/WhiskeySockets/Baileys). Tidak memakai layanan Whapi.id dan tidak membayar langganan vendor. Tidak ada push/deploy.

## DOC-IMPACT

Jika gateway dihubungkan ke aplikasi utama, perbarui ADR-055, kontrak provider/channel dan peta tenant oleh pemilik modul terkait. Jangan menyisipkan provider tidak resmi ke tabel/route produksi tanpa perubahan kontrak yang eksplisit.
