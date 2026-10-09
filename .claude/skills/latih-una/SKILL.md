---
name: latih-una
description: Cara membuat Una (asisten chat AI di panel Leker/OwnerTenang, Gemini 3.1 Flash-Lite) lebih pintar TANPA mengganti model — skenario uji live dari kejadian nyata, contoh percakapan, pembaca kalimat (isiDariPesan), kolom `kurang`/tugas tertunda/draft revisi, alat khusus yang dihitung kode, dan pagar angka. Pakai skill ini SETIAP KALI Bos Cyo mengirim tangkapan layar "Una salah/cupu/kehilangan konteks/nanya terus/ngarang", saat menambah atau membetulkan alat Una (src/caca-*.js), saat mau menyentuh prompt pilih-alat, atau saat ada yang mengusulkan ganti model / naikkan level mikir (jawabannya: dikunci oleh Bos Cyo — perbaiki kerangkanya).
---

# Melatih Una

Baca dulu `UNA-MESIN-DAN-LATIHAN.md` (fakta mesin, vonis, aturan emas, resep alat). Skill ini
urutan kerjanya saja.

## Keputusan yang sudah dikunci

- Model `gemini-3.1-flash-lite`, level mikir bawaan (terendah). **Jangan** menambah setelan level
  mikir dan jangan mengganti model untuk menutupi kegagalan (Bos Cyo 2026-10-09: "yang kita update
  adalah mesinnya bukan modelnya").
- Semua tulis = draft + "Ya" yang diperiksa ulang server. Una tidak menyentuh kas/laci.

## Urutan kerja untuk satu keluhan

1. **Reproduksi live dulu.** Tulis skenario `una-latih/skenario/NN-nama.json` dari kalimat asli Bos,
   lalu jalankan `node scripts/uji-una.mjs una-latih/skenario/NN-nama.json`. Skenario harus GAGAL
   sebelum diperbaiki. Akun dari env `LEKER_HANA_ADMIN_USER/PASS`; gerai uji TESTINGUNA; draft tidak
   pernah disetujui.
2. **Cari akar di kerangka, bukan di model.** Pertanyaan pemandunya:
   - Keadaan apa yang tidak dicatat? (tugas tertunda, draft terbuka, catatan kerja)
   - Isian apa yang jelas tertulis tapi tidak tersalin? → `isiDariPesan`
   - Kolom apa yang ditanyakan tanpa `kurang`?
   - Hitungan/saringan apa yang diserahkan ke model? → alat khusus yang dihitung kode
   - Angka/kesimpulan apa yang dikarang? → pagar kode
3. **Perbaiki dengan tuas termurah yang cukup**, urut: contoh (`src/caca-contoh.js`) → kode
   (`isiDariPesan`, `kurang`, `alihkan`, alat khusus) → pagar. Prompt pilih-alat (±22 ribu huruf)
   adalah pilihan terakhir; lebih baik memindahkan aturan ke kode daripada menambah aturan.
4. **Test unit dengan model palsu** yang meniru kegagalan model persis (mis. model memilih alat
   salah / kolom kosong). Taruh di `test/caca-*.test.js`.
5. `npm run check` + `npm test`. File baru masuk `check`. `public/caca-chat.js` diubah → bump `?v=`.
6. Merge ke `main`, tunggu `Workers Builds: prototype-leker-v2` SUCCESS, lalu **jalankan ulang
   skenario live** (yang baru + semua yang lama, untuk regresi). Perubahan penting: `UNA_ULANG=3`.
7. Catat skor di `UNA-MESIN-DAN-LATIHAN.md` §10, catatan fitur di `HANDOFF-CACA.md`, dan baris §8
   `HANDOFF-STRATEGI-PENJUALAN.md` kalau terlihat pengguna.

## Jebakan yang pernah terjadi

- Isian yang ditambahkan kode DI DALAM `siapkan` tidak ikut `tangkapan` → draft gagal saat "Ya".
  Tambahkan lewat `isiDariPesan` (dipanggil agen sebelum `siapkan`).
- Jawaban pendek ("5000") tidak boleh menimpa isian lama; koreksi draft ("harusnya 100") justru
  harus menimpa. Bedanya ada di `tertunda.revisi`.
- Kesimpulan dari bacaan gagal ("semua aman") = karangan. Lihat `GAGAL_BACA`.
- Uji live hanya bermakna untuk kode yang sudah live di `main`.
