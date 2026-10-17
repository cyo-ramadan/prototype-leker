# Penerus QRIS (aplikasi Android)

Bos Cyo, 2026-10-17. Meneruskan notifikasi uang masuk dari aplikasi merchant QRIS di **HP pemilik**
(Merchant BCA `com.bca.msb`, dll.) ke `POST /api/qris/masuk?token=qr_…` (src/qris-otomatis.js). Dengan
saklar `qris_kolam_bersama` (bawaan aktif) uangnya masuk ke Kolam QRIS dan CS gerai mengklaimnya.

Kenapa aplikasi sendiri, bukan MacroDroid: notifikasi Merchant BCA memakai tampilan khusus
(`RemoteViews`) dengan judul/teks standar kosong -- MacroDroid hanya membaca teks standar. Isi
notifikasinya (dibaca lewat ADB dari HP Bos): "Anda telah menerima pembayaran QRIS sebesar Rp 6.000
dari DANA." -- tanpa nama outlet dan tanpa RRN, makanya gerai ditentukan lewat klaim CS.

## Perilaku

- Hanya paket di isian "Aplikasi yang diteruskan" (bawaan `com.bca.msb`) yang dikirim; notifikasi
  lain tidak pernah keluar dari HP. Ringkasan grup notifikasi dilewati.
- Teks = judul + teks besar/teks + tulisan di tampilan khusus (digambar ulang lalu dikumpulkan).
- Kiriman JSON: `app`, `title`, `text`, `postedAt` (ms, jam notifikasi muncul), `id`
  (`sbn.key|postTime`, dipakai server sebagai pengenal unik -> tidak dobel).
- Antrean di SharedPreferences: gagal kirim (offline / 5xx) disimpan dan dicoba lagi tiap notifikasi
  baru, tiap 5 menit, dan saat aplikasi dibuka. 4xx dianggap keputusan server (dibuang + dicatat).
- Layar: status akses notifikasi & baterai, alamat (Tempel/Simpan), Kirim tes, catatan 15 terakhir.

## Merakit

`bash penerus-qris/build.sh` (Git Bash). Alat di `%LOCALAPPDATA%\penerus-toolchain`: JDK 17 (Temurin),
Android SDK `platforms;android-35` + `build-tools;35.0.0`. Tanpa Gradle: javac -> d8 -> aapt2 ->
zipalign -> apksigner. Hasil: `penerus-qris/build/PenerusQRIS.apk` (tidak di-commit).

**Kunci tanda tangan** ada di `%LOCALAPPDATA%\penerus-toolchain\kunci\` (bukan di repo). Pembaruan
aplikasi wajib ditandatangani kunci yang sama; kalau kunci hilang, aplikasi lama harus dicopot dulu.
Cadangkan folder itu.

## Memasang di HP

Lewat USB debugging: `adb install -r build/PenerusQRIS.apk`, lalu
`adb shell cmd notification allow_listener id.ownertenang.penerusqris/.PenerusService` dan
`adb shell dumpsys deviceidle whitelist +id.ownertenang.penerusqris`. Alamat penerima dibuat admin di
Entity Admin -> 📲 QRIS -> ⚙️ Setelan -> Buat HP penerima, ditempel di aplikasi.

DOC-IMPACT: penerus-qris/, src/qris-otomatis.js (postedAt), public/qris-otomatis.js (petunjuk Setelan).
