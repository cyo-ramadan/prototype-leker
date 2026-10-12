---
name: segarkan-kamus-una
description: Menyegarkan pengetahuan Una (kamus istilah/cara pakai src/caca-jelaskan.js, penjelasan menu src/caca-peta.js, peta menu per skin generated/peta-una-data.js) supaya selalu sesuai kode dan skin yang sedang berlaku — pola "seperti graphify": bagian mekanis dibangkitkan program, bagian makna ditinjau agen dari kode sumbernya. Pakai SETIAP KALI tes penjaga kamus/peta Una merah, sesudah mengubah algoritma yang dijelaskan Una (HPP, laci, setoran, izin, gaji, jurnal, stok), sesudah menambah/mengubah menu atau skin (public/nav-groups.js, public/ui-skin.js, skin baru), atau saat Bos Cyo bilang "Una jelasinnya salah/udah ga sesuai/beda di skin X".
---

# Menyegarkan kamus Una

Latar: Bos Cyo 2026-10-12 — *"jangan sampe ketika ada perubahan algoritma sistem karna update
ataupun kusus di skin tertentu bikin kamusnya ga relevan … dibuat dinamis seperti graphify."*
Rancangan dan status: `HANDOFF-CACA.md` bagian "T-KAMUS".

## Dua lapis (jangan dicampur)

| Lapis | Isi | Siapa yang memperbarui |
|---|---|---|
| **Mekanis** | Menu apa saja, labelnya, grupnya, per skin (`SKIN_GROUPS`/`SKIN_LABELS`/`SKIN_HINTS`); hash berkas `sumber` tiap entri kamus | **Program**, tanpa AI: `node scripts/build-peta-una.mjs`. Sama seperti `graphify update .` (AST) |
| **Makna** | Kalimat penjelasan: "HPP dihitung rata-rata bergerak", "setoran CS di-ACC di …" | **Agen yang menjalankan skill ini**, dengan membaca kode sumbernya. Kalimatnya tidak dikarang oleh model Una saat menjawab pengguna |

Alasan makna tidak di-AI-kan otomatis di produksi: penjelasan yang dikarang mesin terdengar
meyakinkan tapi bisa salah, dan pemilik toko tidak bisa mengeceknya (`src/caca-jelaskan.js`
baris 4-8). Jadi "otomatis" di sini berarti: **program mendeteksi sendiri apa yang basi dan
memaksa peninjauan**. Penulisan ulangnya dikerjakan agen sekali, diuji, lalu masuk ke kode.

## Hemat kuota: segarkan di sesi yang sama

Paling murah: **agen yang mengubah algoritma langsung menyegarkan kamus di PR yang sama**. Kodenya
masih ada di konteksnya, jadi tidak perlu membaca ulang. Tes penjaga merah di PR itu juga, bukan
belakangan. Kalau dikerjakan terpisah, baca **diff** berkas sumber sejak hash lama, bukan seluruh
berkas, dan hanya untuk entri yang merah.

## Urutan kerja

1. **Deteksi.** Jalankan `node scripts/build-peta-una.mjs --cek`, lalu
   `node --test test/caca-peta.test.js test/caca-aksi-barang.test.js`. Catat yang merah:
   - peta basi → langkah 2;
   - menu/skin tanpa `PENJELASAN` → langkah 3;
   - entri `KAMUS` yang `sumber`-nya berubah (hash beda) → langkah 4.
   Kalau tooling T-KAMUS (kolom `skin`, `sumber`, `diperiksa`, `--tinjau`) belum ada, kerjakan
   T-KAMUS dulu sesuai handoff. Jangan menambal kamus dengan tangan tanpa penjaga.
2. **Segarkan mekanis.** `node scripts/build-peta-una.mjs`. Jangan sunting `generated/` dengan tangan.
3. **Ajarkan menu baru.** Untuk tiap `skin:tab` atau `halaman:tab` baru, buka layar aslinya
   (HTML + JS di `public/`) dan tulis `PENJELASAN` (`bisa`, `kata`, opsional `una`) dari yang
   SUNGGUH ada di layar: nama tombol persis, bukan tebakan.
4. **Tinjau entri yang basi.** Untuk tiap entri:
   - Baca diff berkas sumbernya sejak hash lama (`git log -p -- <sumber>`), atau baca berkasnya
     langsung. Graphify boleh dipakai untuk menemukan berkas terkait
     (`graphify query "<istilah>"`, lihat skill graphify), tetapi kalimat akhirnya harus dicek ke kode.
   - Ubah `isi`/`kunci`/`tawaran` hanya bila perilakunya memang berubah. Kalau tidak berubah,
     cukup segarkan hash.
   - Perilaku yang beda per skin → pecah jadi varian ber-`skin`, jangan pakai satu kalimat yang
     "kira-kira cocok semua".
   - `node scripts/build-peta-una.mjs --tinjau <id>` untuk mencatat hash baru. **Jangan jalankan
     `--tinjau` untuk semua entri sekaligus tanpa membacanya**, karena itu sama saja mematikan
     penjaga.
5. **Uji kalimat orang.** Tiap entri yang diubah dicek dengan 2-3 cara bertanya yang berbeda
   (kata dasar + `SINONIM` di `src/caca-kata.js`), di skin default dan skin yang terdampak.
   Kalau ada akses live: skenario `una-latih/skenario/` + `node scripts/uji-una.mjs` (lihat skill
   `latih-una`). Draft tidak pernah disetujui.
6. **Tes penuh yang relevan hijau**, lalu commit hanya berkas yang disentuh, per path (jangan
   `git add -A`, karena working copy dibagi dengan agen lain). Tulis satu baris di `HANDOFF-CACA.md`:
   entri apa yang ditinjau dan kenapa.

## Pagar

- FAKTA dari kamus/peta (kode), BAHASA dari model (`src/caca-poles.js`). Model Una tidak boleh
  menulis kamus.
- Normalkan CRLF → LF sebelum hash (`core.autocrlf=true` di laptop Bos).
- Model/level mikir Una tetap dikunci termurah (skill `latih-una`).
