# Skin D — "Mode Warung" untuk pedagang kelontong & UMKM kecil

Ditulis: 2026-10-03 · Oleh: Hana (sesi UI/UX) · Atas permintaan Bos Cyo:
*"bikin skin d, yang engga hanya mengubah ui tapi juga ux ... buat versi pedagang2 kelontong,
umkm kecil tertarik memakainya ... carikan pembeda yang unique selling proposition-nya gede banget."*

Skin A/B/C mengganti **tampilan**. Skin D mengganti **cara pakai**: layar baru, alur baru, kata baru.
Mesin di belakangnya tetap sama (penjualan, stok, modal per barang, izin, laci) — tidak ada data
yang ditulis lewat jalur lain, tidak ada aturan keuangan yang berubah.

---

## 1. Siapa pembelinya

**Bu Sri, 46 tahun, warung kelontong di depan rumah.** 300-an jenis barang: rokok, mi instan,
minyak, gas, sabun, jajan anak. Dijaga bergantian dengan anaknya dan satu karyawan. Belanja ke
grosir 2–3 kali seminggu. Mata sudah butuh huruf besar. HP Android Rp1,5 juta, kuota pas-pasan.

Yang dia rasakan, bukan yang dia katakan:

| Yang terjadi | Yang dia rasakan |
|---|---|
| Warung ramai tiap hari | "Kok uangnya nggak pernah kelihatan ada?" |
| Uang dapur dan uang warung satu laci | Tidak pernah tahu untung beneran |
| Ditinggal ke pasar / sholat / jemput anak | Was-was laci diambil atau struk "hilang" |
| Harga grosir naik diam-diam | Jual tetap harga lama, rugi tanpa sadar |
| Aplikasi kasir yang pernah dicoba | Menu banyak, istilah asing, ditinggal setelah seminggu |

## 2. Pembeda (USP) — satu kalimat

> **"Tiap malam Anda tahu untung beneran. Dan warung aman walau Anda tinggal."**

Kenapa ini pembeda besar, bukan sekadar fitur:

1. **Untung beneran, bukan omzet.** Hampir semua aplikasi kasir dan buku warung berhenti di
   *penjualan*. Sistem ini menghitung **modal tiap barang otomatis dari harga beli terakhir dan
   rata-ratanya** — jadi angka yang muncul malam hari adalah *penjualan dikurangi modal barang
   yang terjual dikurangi biaya*. Pedagang kecil hampir tidak pernah punya angka ini.
   *(Sudah ada di mesin: modal rata-rata bergerak + laporan untung bersih harian.)*
2. **Warung ditinggal tetap aman.** Hapus transaksi, tutup laci orang lain, koreksi jam kerja —
   semuanya harus minta izin pemilik dari HP. Uang laci dihitung sistem; selisih langsung
   kelihatan. Aplikasi buku warung gratisan tidak punya ini sama sekali.
   *(Sudah ada di mesin: izin/permit, laci, presensi.)*
3. **Dibuat untuk jempol dan mata 46 tahun.** Satu layar untuk jualan, satu angka untuk pemilik.
   Huruf besar, tombol besar, bahasa warung.

Kalimat iklannya: **"Untungnya kelihatan. Uangnya aman."**

## 3. Prinsip desain (cara Steve Jobs)

1. **Satu layar, satu tugas.** Penjaga warung: *jual*. Pemilik: *untung hari ini*. Selebihnya di
   "Lainnya", tidak ikut berteriak.
2. **Hapus dulu, baru tambah.** Setiap tombol harus menjawab "kalau ini hilang, Bu Sri rugi apa?"
3. **Bahasa warung.** Untung, modal, kembalian, utang, belanja. Tidak ada HPP, jurnal, entity,
   permit, drawer.
4. **Jempol dan mata.** Tombol minimal 56 px, angka uang minimal 28 px, kontras tinggi (dipakai di
   bawah matahari teras).
5. **Satu momen yang bikin senyum.** Setelah bayar: kembalian besar, centang hijau, getar pendek.
   Malam hari: satu angka untung yang besar.
6. **Jujur.** Yang belum jadi tidak ditampilkan. Minus tetap minus.

## 4. Layar yang dibangun di fase 1 (skin D)

### 4a. Kasir: "Jual" (`/s/<kode>/warung`)
- Kotak cari di atas, langsung siap diketik ("indo" → Indomie Goreng, Indomie Soto).
- Di bawahnya **"Paling sering"**: barang yang paling sering dijual dari HP itu, tombol besar.
- Ketuk barang = masuk keranjang. Ketuk lagi = tambah satu. Tahan/geser untuk kurangi.
- Bilah bawah selalu kelihatan: **"Bayar Rp23.500"**.
- Layar bayar: tombol cepat **Uang pas · 20rb · 50rb · 100rb** + ketik sendiri →
  **Kembalian Rp26.500** besar sekali. Lalu "Selesai" → centang hijau, keranjang kosong lagi.
- Cara bayar lain (transfer, dll.) muncul kalau gerai mengaktifkannya.
- Belum absen / laci belum dibuka → satu tombol besar **"Mulai jaga warung"** yang membawa ke
  langkah absen + buka laci yang sudah ada, lalu kembali.
- "Menu lengkap" tetap ada untuk hal yang jarang (belanja, biaya, tutup laci).

### 4b. Pemilik: "Hari ini" (panel Pemilik)
- Angka besar: **Untung bersih hari ini** (semua gerai), di bawahnya *kemarin* sebagai pembanding.
- Kartu **"Butuh keputusan Anda"**: izin yang menunggu, langsung ke tombol setujui/tolak.
- Daftar gerai: buka/tutup, untung hari ini per gerai.

## 5. Fase berikutnya (belum dibangun — jangan dijanjikan ke pembeli)

| Ide | Kenapa kuat untuk warung | Butuh |
|---|---|---|
| **Utang pelanggan (kasbon)** + pengingat WhatsApp | Masalah nomor satu warung | Modul piutang pelanggan baru |
| **Daftar belanja ke grosir** dari barang yang mau habis, kirim ke WhatsApp grosir | Belanja tidak lagi dari ingatan | Batas stok minimum per barang |
| **Peringatan "harga jual di bawah modal"** | Harga grosir naik diam-diam | Bandingkan harga jual vs modal terakhir |
| Scan barcode pakai kamera HP | Cepat untuk 300+ barang | Kolom barcode di master barang |
| Struk lewat WhatsApp | Pelanggan percaya, warung terlihat modern | Format struk + tautan |
| Tetap bisa jualan saat sinyal hilang | Keberatan klasik | Antrian lokal + sinkron (besar) |

## 6. Batas yang dijaga

- Skin D hanya untuk tenant yang memilih **D** di Owner Console → Kebijakan. Tenant lain tidak
  berubah.
- Semua penjualan tetap lewat jalur kasir yang sama (laci aktif, stok, modal, izin).
- Absen dan buka laci tetap memakai alur yang sudah ada (foto + lokasi), tidak dibuat ulang.

<!-- DOC-IMPACT: 2026-10-03 dokumen baru; menambah skin D (Mode Warung) di belakang pilihan tenant ui_skin = D. -->
