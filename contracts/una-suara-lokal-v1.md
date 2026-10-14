# Una suara lokal V1

Keputusan Bos Cyo 2026-10-13: program suara lokal yang dapat dikembangkan; pengenalan suara pemilik adalah pilihan, bukan syarat live. Nama asisten mengikuti pengaturan tenant.

## Mesin dan data

`kerangka-suara.js` menangani TTS browser Indonesia. `kerangka-suara-pemilik.js` menangani capture, VAD, antrean Worker, enrollment dan verifikasi opsional. `kerangka-suara-model-worker.js` mengisolasi inferensi. `caca-pengaturan.js` mengirim teks hasil transkripsi ke jalur chat/Workspace yang sudah ada. Tidak ada endpoint audio atau kredensial provider baru.

Transkrip: Xenova/whisper-tiny, revision `886cdcc0ac3be42c545d24403ccb116ff9387d97`, q8 WASM, sekitar 41 MB bobot. Speaker: Xenova/wavlm-base-plus-sv, revision `839012c1abfd543d1f5178201a444706e85d3b07`, q8 WASM, 101683453 byte. Runtime Transformers.js 3.8.1 bundle browser. Runtime/WASM dan metadata menambah ukuran unduhan di luar bobot. CDN/Hugging Face dihubungi untuk mengunduh kode/model, bukan menerima rekaman. Browser mengelola cache unduhan; tidak dijanjikan offline penuh.

Dalam mode live lokal, PCM tidak dipersisten atau dikirim ke API. Tombol mikrofon dikte lama memakai layanan SpeechRecognition browser, yang pada sebagian browser memproses audio di server penyedia; tombol itu berbeda dari Mulai obrolan live lokal. Narasi memakai TTS browser/OS, yang dapat menyediakan suara lokal maupun online. Jangan menjanjikan seluruh audio offline. Referensi: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition dan https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService. Teks hasil transkripsi mengikuti kebijakan riwayat chat yang ada. Profil lokal menyimpan tiga embedding 512 dimensi, revision model dan tanggal, dengan namespace identitas server tenant+peran+akun. Menghapus profil mematikan pilihan pemilik; tidak menghapus cache model browser.

## Perilaku dan batas

Live dapat berjalan tanpa enrollment saat opsi pemilik OFF. Pengenalan pemilik ON mensyaratkan profil konsisten dan model speaker. Cosine threshold 0.86, rata-rata serta dua dari tiga contoh cocok; ini heuristik percobaan, bukan autentikasi biometrik atau jaminan penolakan seluruh penyamaran/rekaman. Tidak dipakai sebagai pengganti login/otorisasi/persetujuan transaksi.

VAD tetap mendengarkan saat TTS/tugas berjalan. Opsi umum menyela langsung; opsi pemilik menjeda calon ucapan, lalu menghentikan narasi setelah cocok. Inferensi pemilik menambah latensi. Senyap 0.7 detik mengakhiri segmen, panjang maksimum 12 detik. Antrean tugas UI maksimum tiga; kelebihan ditolak dengan status agar pengguna mengulang. Capture speaker memerlukan echoCancellation `all` yang dilaporkan browser, atau pengguna secara eksplisit memakai headset. Tidak menjanjikan dukungan semua browser/HP.

Interupsi hanya mengubah ucapan, bukan membatalkan pekerjaan/server write. Perintah masuk jalur tanya biasa; tombol persetujuan Workspace tetap manual. Scope/akun/generation diverifikasi setelah await; tutup, scope change, tab hidden/pagehide menghentikan capture dan hasil terlambat.

## Lisensi dan uji

WavLM oleh Microsoft dan bobot ONNX Xenova menggunakan [CC BY-SA 3.0](https://github.com/microsoft/UniSpeech/blob/main/LICENSE); model: https://huggingface.co/microsoft/wavlm-base-plus-sv dan https://huggingface.co/Xenova/wavlm-base-plus-sv. Batas lisensi bobot tetap berlaku bila dibundel/dimodifikasi/distribusikan. Whisper dan Transformers.js Apache-2.0. Atribusi WavLM ditampilkan pada UI.

Probe Node CPU Windows dengan empat fixture suara publik HF menghasilkan embedding finite512, cosine speaker sama0.9143/0.9609 dan lintas speaker0.6658–0.7943. Ini bukti kompatibilitas model, bukan akurasi biometrik populasi atau kecepatan HP. Probe browser Chrome asli juga menyelesaikan Whisper q8 dan WavLM WASM embedding512 finite dengan fixture publik. Pengujian mikrofon, gema dan latensi perangkat nyata belum dilakukan. Hasil keseluruhan suite dicatat di handoff setelah selesai.

Sebelum rilis klaim live: uji Edge laptop dan Chrome Oppo, izin mic ditolak/dicabut, speaker vs headset, interupsi saat TTS dan tugas aktif, dua pembicara, perubahan gerai/login, sembunyi/tutup tab, unduhan terputus, perangkat lambat dan ketikan/foto bersamaan. Jangan menyebut fitur sudah dapat dicoba di produksi sebelum merge+Workers SUCCESS dan pemeriksaan aset/migration.
