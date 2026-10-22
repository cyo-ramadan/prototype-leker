# Pemeriksaan dependensi gateway — 22 Oktober 2026

Pemeriksa: Codex. Lingkup: paket yang dipasang di worktree lokal; belum menghubungkan akun WhatsApp.

## Bukti yang diperiksa

- Baileys dari registry npm `@whiskeysockets/baileys@7.0.0-rc14`, metadata menunjuk repositori `WhiskeySockets/Baileys`, lisensi MIT. Ini dependensi open source, bukan kode koneksi buatan Codex.
- `package-lock.json` mematok versi dan SHA-512. Skrip `node support/audit-dependencies.mjs` memeriksa seluruh 125 entri (termasuk paket opsional platform lain): semuanya memakai URL `https://registry.npmjs.org/` dan integrity SHA-512. Tidak ada dependensi URL Git acak.
- `npm audit signatures`: 99 paket terpasang memiliki registry signature yang terverifikasi; 15 paket memiliki attestations terverifikasi. Angka paket terpasang berbeda dari lockfile karena dependensi opsional antar-platform. Tanda tangan mengonfirmasi metadata penerbitan, bukan membuktikan kode bebas backdoor.
- `npm audit --omit=dev`: hasil awal nol kerentanan yang dikenal; ulangi sebelum penggunaan/upgrade.
- Skrip instalasi dinonaktifkan saat install dan secara default lewat `.npmrc` (`ignore-scripts=true`). Lockfile menandai skrip instalasi Baileys dan protobufjs. Skrip preinstall Baileys yang diperiksa hanya mengecek versi Node; tetap tidak dijalankan otomatis.
- Pencarian statis pada kode Baileys menemukan penggunaan `child_process.exec` untuk thumbnail video lewat ffmpeg. Itu fitur yang sah pada library, tetapi gateway tidak memanggilnya. Launcher juga tidak memberi izin proses anak atau native addon pada proses gateway.
- Konstanta jaringan yang ditelaah mencakup WhatsApp dan helper pemeriksaan versi di GitHub. Gateway tidak memanggil helper pembaruan versi atau preview tautan. Pemeriksaan ini bukan audit setiap baris seluruh dependensi atau observasi trafik akun nyata.

## Pembatasan tambahan

`npm start` / `jalankan.cmd` memakai `launch.mjs`: environment anak hanya mewarisi variabel sistem yang diperlukan dan konfigurasi WA. Token provider AI/GitHub serta NODE_OPTIONS tidak diteruskan. Proses anak memakai Node Permission Model: akses fs hanya folder gateway, tulis hanya `data`, proses anak/worker/native addon tidak diizinkan.

Tes membuktikan pembacaan file repo di luar folder gateway dan pemanggilan proses anak ditolak, sementara modul Baileys asli bisa dimuat. **Node Permission Model bukan sandbox anti-malware dan bukan jaminan terhadap kode yang sengaja jahat.** Khususnya ia bukan isolasi OS dan tidak menutup semua cara akses sumber daya; data sesi di dalam folder gateway tetap dapat dibaca proses. Lihat [batas resmi Node](https://nodejs.org/api/permissions.html).

Karena itu, untuk isolasi lebih kuat, jalankan di VM/laptop/akun OS khusus tanpa token produksi atau dokumen pribadi. Belum ada VM/akun OS baru yang dipasang oleh Codex. Jangan menjalankan dengan Administrator.

Unduhan lampiran dibatasi host HTTPS WhatsApp, ukuran, dan timeout dispatcher. File disajikan sebagai unduhan, tidak dijalankan. Panel hanya loopback dengan autentikasi dan origin check. Batas ini mengurangi permukaan serangan; tidak menghilangkan risiko rantai pasok atau ban WA.

## Batas kesimpulan

Tidak ditemukan indikator mencurigakan dalam pemeriksaan terarah di atas. Ini **bukan sertifikasi bebas malware**, audit menyeluruh, pentest, atau bukti risiko ban kecil. Akun WhatsApp belum ditautkan, jadi perilaku jaringan saat koneksi nyata belum diverifikasi.

Upgrade hanya secara sengaja: tinjau perubahan, pasang dengan skrip mati, ulangi audit/signature/tes, lalu uji nomor khusus. Jangan mengganti lockfile atau mengaktifkan pembaruan otomatis tanpa pemeriksaan ulang.

## DOC-IMPACT

Perbarui laporan setiap versi dependensi atau pembatasan launcher berubah. Jangan melaporkan pemeriksaan lama sebagai bukti versi baru.
