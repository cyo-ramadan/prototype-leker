# Library aset desain

Pintu masuk agent: baca file ini sebelum membuat ulang atau mencari gambar konsep Skin H/I. Daftar file, dimensi, ukuran, dan SHA-256 ada di [manifest.json](manifest.json).

## Lokasi yang menjadi sumber utama

| Aset | Lokasi repo | Pemakaian |
|---|---|---|
| Pantai tanpa logo/merek, versi 1 | [public/owner-beach-h-v1.png](../public/owner-beach-h-v1.png) | Background Skin H dan I; URL aplikasi `/owner-beach-h-v1.png` |
| Konsep awal: Fokus, Tenang, Langsung | [concepts/2026-10-11/v1](concepts/2026-10-11/v1) | Tiga gambar ilustrasi owner + resep langsung pada barang |
| Alternatif susunan owner dan kasir: A, B, C | [concepts/2026-10-11/v2](concepts/2026-10-11/v2) | Empat gambar; A-papan-tugas-owner-kasir-final.png adalah revisi A, A tanpa final adalah versi sebelumnya |
| Preview Admin HP, modal HP, dan desktop Skin I | [previews/skin-i-v1](previews/skin-i-v1) | Screenshot fixture lokal memakai template Admin asli; tidak memakai data tenant produksi |
| Prompt gambar konsep | `PROMPTS.md` di masing-masing folder v1/v2 | Sumber arahan untuk membuat varian; angka di mockup adalah ilustrasi |
| Warna dan bentuk komponen H | [scripts/generate-skin-css.py](../scripts/generate-skin-css.py), definisi `SKINS['h']` | Sumber utama token dan CSS; hasilnya [public/skin-h.css](../public/skin-h.css) |
| Tata letak portal Admin + Kantor | [public/owner-entity-portal.css](../public/owner-entity-portal.css) | Komponen portal khusus H |
| Desain dan aturan Skin H | [DESAIN-SKIN-H-OWNER-ADMIN.md](../DESAIN-SKIN-H-OWNER-ADMIN.md) | Konteks penggunaan dan batas isolasi skin |

Gambar konsep dibuat dengan ImageGen pada 2026-10-11 dan disalin utuh dari folder lokal `C:/Users/Asus/output/owner-tenang-ui-20261011` dan `...-v2`. Folder lokal itu bukan lagi satu-satunya arsip. Prompt asli ikut disimpan; catatan status implementasi lama tidak dijadikan sumber status fitur sekarang.

Background pantai dibuat ulang mengikuti referensi pantai kuning/turquoise yang diberikan Bos Cyo, tanpa logo Teh Poci atau teks merek. File PNG yang dipakai aplikasi adalah master yang saat ini tersedia; file proyek berlapis/prompt lengkap generasi background belum ditemukan. Jangan mengklaim memiliki SVG, PSD, atau source berlapisnya.

## Repo dan R2

Semua gambar dalam manifest tersimpan dan diberi versi di Git. Saat ini **belum ada salinan library ini di R2**. `public/` dipublikasikan oleh Workers Assets; `design-assets/` adalah arsip desain di repo dan tidak dimasukkan ke bundle aset publik. Jangan memindahkan mockup ke `public/` hanya untuk mengarsipkannya.

Untuk aset tema yang kecil dan berubah bersama kode, repo menjadi sumber utama supaya versi desain dan kode tetap cocok. R2 cocok untuk unggahan tenant, file besar/dinamis, atau salinan distribusi library bila nanti diperlukan. Jika membuat mirror R2, tambahkan bucket, object key, URL akses, checksum, dan status akses di manifest; jangan menyimpan credential. R2 tidak menggantikan catatan sumber di repo.

## Tema pantai H

Arah mengikuti referensi pantai Es Teh Poci dari Bos Cyo: kuning cerah dominan, laut turquoise, buih putih, aksen hijau daun; tanpa logo atau teks merek. Bilah atas kuning dengan garis turquoise, bukan dominan biru gelap.

| Peran | Nilai |
|---|---|
| Laut / tindakan utama | `#006B99` |
| Ombak / aksen dan bingkai modal | `#00B5DB` |
| Buih / panel ringan | `#E9F8FE` |
| Pasir / aksen dan tombol pendamping | `#FFD65A` / `#FFF0B8` |
| Daun / tanda merek aplikasi | `#4F792A` |
| Teks | `#153E54` |
| Font | Nunito Sans 400, 500, 600, 700, 800; fallback Segoe UI/system-ui |

Background ditempatkan di `center bottom` supaya ombak turquoise tidak terpotong di layar lebar. Biru laut dengan teks putih dipakai untuk tindakan utama; cyan hanya aksen agar teks tetap terbaca. Font dimuat melalui loader `public/ui-skin.js`; fallback tetap tersedia bila Google Fonts tidak terjangkau. Target sentuh minimal 44 px. Modal memakai latar buih, bingkai cyan, pemisah pasir, dan backdrop biru gelap. Warna bahaya tetap merah.

## Cara agent memakai ulang

1. Ambil file dari manifest, jangan bergantung pada tautan unduh sementara di chat atau folder output laptop.
2. Bedakan `concept-only` dengan `runtime-background`. Mockup bukan bukti fitur sudah diterapkan; lihat dokumen desain dan kode yang aktif.
3. Untuk varian baru, simpan prompt/provenance, nama berversi, dimensi, dan checksum. Jangan menimpa master lama diam-diam.
4. Ubah token/CSS H di generator lalu jalankan `python scripts/generate-skin-css.py public h`. Jangan menyunting hasil generated saja.
5. Ketika skin lain memakai gambar pantai yang sama, pakai URL aset yang sama tetapi token dan aturan skin tersebut harus tetap terpisah. Semua selector H wajib berawal `html[data-skin="h"]`; pemakaian aset tidak mengaktifkan aturan Kantor, Auto Permit, atau resep H.
6. Setelah mengubah CSS/font, bump `SKIN_ASSET_VERSION` dan seluruh referensi `ui-skin.js?v=`; versi CSS portal ada di `entity-admin.html`.

Skin I memakai aset pantai dan palet H yang sama, dengan font, ukuran, layout, menu, dan aturan skin 0. Sumbernya `SKINS['i']` di generator menggunakan template `PAINT_ONLY`, tidak memakai `COMMON` atau menyalin CSS perilaku H. Rincian: [DESAIN-SKIN-I-PANTAI-KLASIK.md](../DESAIN-SKIN-I-PANTAI-KLASIK.md). Screenshot bukan gambar runtime; simpan di arsip, jangan pindahkan ke public.

DOC-IMPACT: CHANGED 2026-10-13 - preview I dan panduan tema visual tanpa perubahan layout; ADDED 2026-10-13 - katalog delapan aset, arsip tujuh mockup beserta prompt, lokasi runtime pantai, status repo/R2, dan aturan reuse terisolasi.

DOC-IMPACT: CHANGED 2026-10-13 - Portal Staf H memakai master pantai existing; panel/menu, dialog koreksi, serta modal kamera dicakup generator H, tanpa aset duplikat.
