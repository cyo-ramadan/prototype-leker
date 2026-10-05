# Prompt untuk agen ahli landing page — OwnerTenang

Ditulis: 2026-10-05 · Oleh: Hana (sesi strategi penjualan) · Untuk: Bos Cyo
Cara pakai: tempel **seluruh isi di bawah garis** ke agen ahli, lampirkan file `index.html` landing page saat ini
(sebagai acuan gaya, bukan untuk disalin mentah). Hasilnya minta dalam bentuk file HTML; serahkan ke Hana untuk
dipasang (tes kata terlarang, nomor WhatsApp, merek).

---

Kamu desainer + copywriter landing page untuk produk SaaS lokal Indonesia. Tugasmu: membuat **2 landing page**
yang meyakinkan pemilik usaha F&B untuk meminta demo lewat WhatsApp. Satu-satunya tujuan halaman = satu klik:
**"Minta demo lewat WhatsApp"**. Bukan pendaftaran, bukan pembayaran.

## 1. Produk (fakta yang boleh kamu pakai — tidak boleh menambah)
Nama: **OwnerTenang**. Sistem kontrol gerai berbasis web (jalan di HP/laptop, tanpa instal, tanpa beli mesin kasir) untuk
pemilik usaha F&B yang tidak bisa selalu hadir. Janji utama: **"Gerai jalan. Kas jujur. Anda tenang."**

Fitur yang SUDAH jalan dan boleh dijanjikan:
- Kasir + laci kas (buka/tutup, saldo awal lanjut otomatis, selisih langsung kelihatan, setoran dengan foto bukti transfer yang harus di-ACC admin).
- **Absen karyawan foto langsung + lokasi.** Di luar lokasi atau tanpa GPS: absen tetap tercatat tapi kartunya **merah**; pemilik melihat jaraknya; karyawan bisa mengajukan perbaikan dengan alasan, pemilik yang menerima/menolak. Jadwal shift, deteksi telat, lupa absen pulang ditutup otomatis, gaji dihitung dari jam kerja.
- **Izin yang hanya bisa pemilik/admin setujui:** hapus transaksi, koreksi jam absen, tutup laci orang lain. Laporan Izin: siapa, kapan, berapa, alasannya.
- Stok bahan berkurang otomatis saat menu terjual; modal per porsi (HPP) dihitung dari resep; harga beli di luar rentang wajar ditolak (mencegah salah ketik).
- **Untung bersih harian per gerai**, grafik perbandingan antar gerai (hijau untung / merah rugi), HPP bahan per gerai dengan penanda janggal.
- Banyak gerai dalam satu akun pemilik; data tiap gerai dan tiap perusahaan dipisahkan (cocok untuk usaha kemitraan: tiap mitra terpisah).
- Didampingi tim sampai gerai jalan (gerai disiapkan bersama tim; belum bisa daftar sendiri).

Bukti pemakaian (sudah tayang di halaman saat ini): 14 gerai memakai · 38 akun karyawan · 1.800+ penjualan tercatat · 540 barang & bahan.
Harga (sudah tayang): **Rp149.000 per gerai per bulan** (Paket Kontrol Gerai); **Rp249.000** bila ingin pembukuan otomatis lengkap.

## 2. DILARANG (alasan: fitur belum teruji atau disembunyikan; janji yang gagal merusak kepercayaan)
Jangan menyebut, menyiratkan, atau menggambar: asisten AI/chatbot/"Una"/"Caca"; game, roda putar, poin, loyalty; mode offline;
QRIS/e-wallet terhubung langsung; jurnal/neraca/buku besar/akuntan; aplikasi pelanggan; daftar sendiri/free trial otomatis;
kata "prototype", "beta", "segera hadir", "coming soon". Jangan mengarang testimoni, nama klien nyata, logo klien, rating, jumlah
pengguna lain, atau klaim hukum/keamanan (mis. "100% aman", "bersertifikat"). Jangan tampilkan wajah/nama karyawan nyata.
Data di mockup = fiktif dan harus terlihat wajar.
Jujur soal batas (boleh di FAQ): butuh internet; belum ada QRIS terhubung; gerai disiapkan bersama tim.

## 3. Nada dan pembaca
Pembaca: pemilik usaha 30–55 tahun, nyaman WhatsApp dan marketplace, **tidak paham akuntansi/IT**, curiga pada janji muluk. Bahasa
Indonesia sehari-hari yang sopan ("Anda"), kalimat pendek, satu ide per kalimat. Mulai dari **kejadian yang dikenal pemilik** (absen titip,
struk dihapus, laci kurang, "untungnya berapa?"), baru nama fitur. Hindari istilah teknis (API, cloud, dashboard, ERP, SaaS). Karyawan
dibingkai sebagai pihak yang **terlindungi** oleh bukti kerja, bukan diawasi.

## 4. Halaman yang dibuat

### Halaman A — Utama (`/produk/`): pemilik 2–10 gerai F&B yang dijaga karyawan
Segmen: kedai kopi, warung makan, bakery, minuman & booth, jajanan. Halaman saat ini sudah ada (lampiran). Tugasmu **meningkatkan**, bukan
mengulang: hero lebih tajam, bukti kepercayaan lebih awal, urutan bagian yang membuat pemilik berhenti menggulir di bagian "ini aku banget".
Pertahankan: janji utama, mockup HP "Gerai Anda hari ini", bagian "Sehari bersama kami", FAQ jujur, bagian privasi, harga, angka bukti.

### Halaman B — Kemitraan (`/produk/kemitraan/`): pemilik usaha kemitraan / franchise yang ingin memantau gerai mitra
Pembaca: pemilik brand/pusat dengan 5–50 gerai mitra. Masalahnya beda: mitra jauh, laporan tidak seragam, sulit tahu gerai mana yang
bocor, sulit menegakkan standar. Pesan: **satu layar untuk semua gerai mitra, data tiap mitra terpisah, standar yang sama.**
Tonjolkan hanya yang JUAL: perbandingan gerai (untung/rugi), HPP antar gerai dengan penanda janggal, izin & absen seragam, laci/setoran terlacak,
data tiap mitra/perusahaan terpisah. Ajakan: "Bicarakan pilot di 1–3 gerai mitra" (satu gerai/mitra dulu). **Jangan** menjanjikan royalti otomatis,
penagihan mitra, atau integrasi pembayaran.

*(Segmen warung kecil / warung tanpa karyawan: JANGAN dibuat sekarang — fiturnya masih diuji.)*

## 5. Struktur tiap halaman
Hero (janji + satu CTA + mockup HP) → masalah yang dikenal → cara kerja (3 hal) → "sehari bersama kami" (linimasa) → bukti (angka) →
untuk siapa/belum cocok untuk siapa (jujur) → cara mulai (4 langkah) → harga → FAQ → privasi → CTA penutup. CTA sticky di HP.
Setiap bagian harus lolos pertanyaan: "kalau dihapus, apakah pemilik masih yakin?" — kalau ya, hapus.

## 6. Syarat teknis (wajib; agar bisa langsung dipasang)
- **Satu file HTML mandiri**: CSS dan JS inline, tanpa font/skrip/gambar eksternal, tanpa framework. Font sistem. Gambar = HTML/CSS/SVG inline (mockup HP digambar, bukan foto stok).
- Mobile-first mulai 360 px; gutter 16 px; **tanpa scroll horizontal**; target sentuh ≥ 44 px; kontras teks memenuhi WCAG AA; mendukung `prefers-reduced-motion`; semantik heading benar (satu h1).
- `<title>` dan meta description khas halaman; Open Graph dasar; `lang="id"`.
- Semua tombol WhatsApp memakai atribut `data-wa` dan **blok konfigurasi persis ini** di akhir `<body>` (jangan ubah bentuknya):
  ```html
  <script>
    const LANDING = {
      BRAND: 'OwnerTenang',
      WA_NUMBER: '6285860070439',
      WA_TEXT: 'Halo, saya ingin demo aplikasi kontrol gerai. Saya punya ... gerai.'
    };
    document.querySelectorAll('[data-brand]').forEach(el => { el.textContent = LANDING.BRAND; });
    if (LANDING.WA_NUMBER) {
      const href = 'https://wa.me/' + LANDING.WA_NUMBER + '?text=' + encodeURIComponent(LANDING.WA_TEXT);
      document.querySelectorAll('[data-wa]').forEach(el => { el.href = href; el.target = '_blank'; el.rel = 'noopener'; });
    }
  </script>
  ```
  Halaman B boleh mengganti `WA_TEXT` menjadi: `Halo, saya pemilik usaha kemitraan dan ingin membahas pilot pemantauan gerai mitra. Jumlah gerai mitra saya ...`
- Tidak ada formulir, tidak ada cookie, tidak ada pelacak/analitik, tidak ada pop-up.
- Ukuran total < 150 KB per halaman.

## 7. Serahkan
Dua file (`produk-utama.html`, `produk-kemitraan.html`) + ringkasan 10 baris: keputusan desain utama, apa yang kamu ubah dari halaman lama, dan
**daftar setiap klaim di halaman beserta fitur di bagian 1 yang mendukungnya** (supaya bisa diperiksa satu per satu). Bila ada klaim yang tidak
punya dukungan di bagian 1, hapus — jangan dipertahankan.
