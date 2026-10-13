# Skin I - Pantai Klasik

Arahan Bos Cyo, 2026-10-13: "apa-apa sama semua dengan skin 0 plek ketiplek"; yang berubah hanya background dan desain tombol, kontainer, modal, dan komponen visual. Tema sama dengan H: pantai referensi Es Teh Poci, tanpa logo/teks merek.

## Kontrak

I menggunakan halaman, DOM, menu, teks, placeholder, tombol, ukuran, jarak, font, breakpoint, urutan, dan handler skin 0. Tidak ada pengelompokan menu tambahan, penyembunyian tombol klasik, portal Admin + Kantor H, resep inline H, pengecualian presensi, atau Auto Permit khusus H.

Font family, size, weight, line-height dan letter-spacing bawaan halaman dipertahankan. Warna/shape berubah tanpa mengubah dimensi border-box; bingkai modal cyan memakai inset shadow sehingga ukurannya tidak bertambah.

## Implementasi

- Pilihan tenant `I / Pantai Klasik` memakai registry kebijakan existing; default tenant tetap 0, tidak ada migration dan tidak ada perubahan pilihan tenant otomatis.
- `src/ui-profile.js` mengembalikan `skin: i`; `public/ui-skin.js` memuat `/skin-i.css` dan `data-skin=i`.
- `hasTheme()` internal mengatur aset; `MaxiSkin.isOn()` tetap false untuk I agar renderer, `pick()`, penggantian teks/placeholder, dan nav-groups mengikuti skin 0. `MaxiSkin.skin()` tetap mengembalikan i, bukan h.
- Selector global `data-skin-hide/only` dan nav-grouped-source mengecualikan I. Keluar dari H mengembalikan menu/teks/font dan membatalkan sesi Kantor melalui mekanisme existing.
- Generator memakai `PAINT_ONLY` untuk I. Jangan memakai `COMMON`: template itu juga mengubah padding, font, header responsif, serta dekorasi hero. Jangan menyalin CSS H yang berisi hide, order, grid, ukuran, atau selector fitur H.
- CSS I hanya berisi background, warna, border-color/radius, shadow, dan accent-color. Tidak ada display, visibility, position, grid/flex, order, margin/padding, width/height, font, responsive override, atau content replacement.

## Aset

Master pantai tetap `public/owner-beach-h-v1.png`; URL `/owner-beach-h-v1.png`. Tidak dibuat duplikat atau generasi baru. Laut `#006B99`, ombak `#00B5DB`, pasir `#FFD65A`, pasir muda `#FFF0B8`, buih `#E9F8FE`, hijau daun `#4F792A`. Bahaya tetap merah.

Library, manifest/checksum dan aturan repo/R2: [design-assets/README.md](design-assets/README.md). Preview I: [design-assets/previews/skin-i-v1](design-assets/previews/skin-i-v1). Semua preview adalah fixture lokal memakai HTML Admin asli, loader skin, nav-groups dan modal asli; API profil memakai respons simulasi. Tidak menjalankan transaksi pada tenant produksi.

## Verifikasi

- Pengukuran browser: 21 elemen terlihat pada Admin dibandingkan dengan 0; x/y, width/height, font family/size/line-height, dan display identik pada viewport HP 390x844 serta desktop 1280x800.
- Modal HP: x/y, width/height, font/size dan isi identik. Warna/garis tema berbeda sesuai tujuan.
- Tes VM menjalankan ui-skin dan nav-groups asli: H -> I -> 0 mengembalikan label/placeholder klasik, tidak memasang nav berkelompok, dan melepaskan font H.
- Tes CSS menolak override geometri/typography dan selector H. Tes profil/pilihan tenant mencakup I; tes pencabutan token Kantor memasukkan transisi ke I.
- `npm run check`: 321 file lulus. 20 tes skin terkait lulus. Suite penuh Windows menjalankan 1.875 tes: 1.874 lulus, satu penjaga peta Una gagal karena checkout CRLF vs keluaran generator LF (isi menu identik); setelah normalisasi lokal tanpa perubahan isi repo, seluruh 36 tes peta/skin terkait lulus. CI Linux memverifikasi suite penuh pada commit rilis.

DOC-IMPACT: ADDED 2026-10-13 - Skin I visual-only bertema pantai H dengan struktur dan perilaku skin 0; lokasi aset, batas CSS, dan bukti perbandingan browser.
