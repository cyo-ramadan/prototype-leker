# Skin D — "Mode Warung" untuk pedagang kelontong & UMKM kecil

Ditulis: 2026-10-03 · Oleh: Hana (sesi UI/UX) · Atas permintaan Bos Cyo:
*"bikin skin d, yang engga hanya mengubah ui tapi juga ux ... buat versi pedagang2 kelontong,
umkm kecil tertarik memakainya ... carikan pembeda yang unique selling proposition-nya gede banget."*

Skin A/B/C mengganti **tampilan**. Skin D mengganti **cara pakai**: layar baru, alur baru, kata baru.
Mesin di belakangnya tetap sama (penjualan, stok, modal per barang, izin, laci) — tidak ada data
yang ditulis lewat jalur lain, tidak ada aturan keuangan yang berubah.

---

## 0. Revisi 2 (2026-10-02) — pemiliknya jaga sendiri

> **Bagian ini menggantikan §1–§4 di mana pun bertentangan.** Fakta baru dari Bos Cyo:
> *"di skin d ini user kita nanti ga ada karyawan, jadi yang jadi kasir dan adminnya nanti dia."*
> Plus dua masukan: riset dulu sebelum meniru Shopee, dan warna lembut/pastel supaya "kasir
> engga kaku".

### 0.1 Satu hari Bu Sri (sendirian)

| Jam | Yang terjadi | Yang aplikasi lakukan |
|---|---|---|
| 06.00 | Buka rolling door, hitung uang receh di kaleng | **"Buka warung"**: satu ketukan. Uang awal diisi otomatis dari sisa kemarin; tinggal "Betul" atau ubah. Tanpa absen, tanpa foto, tanpa lokasi. |
| 06.05–21.00 | Jualan sambil masak, ngurus anak, ditinggal sebentar | Layar **Jual** (sudah ada di fase 1). Tetap terbuka seharian. |
| 10.00 | Ke grosir | Tab **Belanja**: daftar barang yang mau habis, catat harga beli baru. Harga beli = modal, otomatis. |
| 14.00 | Jual rokok dengan harga lama, padahal grosir sudah naik | Kartu barang ditandai **"Di bawah modal"** saat dijual. |
| 21.00 | Tutup | **"Tutup warung"**: hitung uang di kaleng → aplikasi bilang pas/lebih/kurang, lalu **satu angka besar: untung hari ini**, plus 3 barang yang mau habis. |
| 21.05 | Ambil uang untuk dapur | Tombol **"Ambil untuk dapur"**: uang keluar dicatat, jadi untung tidak tercampur uang belanja rumah. |

### 0.2 Pembeda (USP) baru

USP lama "Uangnya aman walau ditinggal" **dibuang**. Tidak ada karyawan berarti tidak ada yang
perlu diawasi; menjualnya justru tidak jujur.

> **"Jualan seperti biasa. Malamnya tahu untung beneran — tanpa nyatet."**

1. **Untung beneran, bukan omzet** — modal per barang dihitung otomatis dari harga beli
   (mesinnya sudah ada). Pembeda terbesar, tetap dipertahankan.
2. **Uang warung terpisah dari uang dapur** — "Ambil untuk dapur" dicatat, jadi Bu Sri akhirnya
   tahu kenapa "uangnya nggak pernah kelihatan ada".
3. **Tahu kapan belanja dan barang mana yang merugi** — barang mau habis + dijual di bawah modal.

### 0.3 Yang dibuang (untuk tenant "jaga sendiri")

| Dibuang | Kenapa |
|---|---|
| Absen (foto + lokasi) sebelum buka laci | Absen ke diri sendiri. Ini langkah paling menyebalkan di pagi hari. |
| Izin/persetujuan (hapus transaksi, tutup laci) | Minta izin ke diri sendiri. Disetujui otomatis, tetap tercatat. |
| Dua akun (kasir + pemilik) | Satu orang, satu login, semua kelihatan. |
| Kata "laci", "presensi", "permit", "entity" | Diganti "Buka/Tutup warung", "uang di kaleng", "untung". |
| Banyak gerai di layar utama | Warung satu pintu. Daftar gerai hanya kalau gerainya lebih dari satu. |

### 0.4 Bentuk aplikasinya: satu login, tiga tombol bawah

**Jual · Belanja · Untung** — bilah navigasi di bawah jempol (pola yang sudah dikenal dari
aplikasi belanja/bank; Jakob's Law: orang betah dengan pola yang sudah biasa mereka pakai).

- **Jual** — layar fase 1 (cari, paling sering, bayar, kembalian).
- **Belanja** — barang mau habis, catat belanja grosir. (Fase 2; sampai jadi, tombol ini tidak
  ditampilkan — prinsip "jujur".)
- **Untung** — angka hari ini, kemarin, 7 hari; barang paling laku; barang di bawah modal.
- Di atas: **"Buka warung"/"Tutup warung"** sebagai satu tombol status, bukan menu.

### 0.5 Riset: ikut gaya Shopee atau tidak?

Yang **diambil** dari Shopee: **pita warna di atas dengan kotak cari di dalamnya**, kartu barang
bergrid, bilah bawah. Ini pola yang sudah ada di jempol puluhan juta orang Indonesia — tidak
perlu diajari.

Yang **tidak diambil**: latar oranye jenuh penuh dengan teks putih/merah di atasnya.
- Putih di atas oranye Shopee kontrasnya **3,66 : 1**; merah di atas oranye **1,57 : 1**. Batas
  minimum baca (WCAG AA) 4,5 : 1. Shopee aman karena teksnya pendek dan penggunanya scroll
  sebentar; kasir dipandangi 15 jam sehari.
- Latar warna jenuh di area luas bikin mata cepat lelah (UX Movement); Bu Sri sudah butuh huruf
  besar dan sering dipakai di teras yang silau.

### 0.6 Palet: pastel untuk permukaan, angka tetap tegas

Kesimpulan riset: pastel cocok untuk **latar dan kartu** (terasa ramah, tidak kaku), tapi **teks
dan angka harus gelap** — minimal 4,5 : 1, targetnya **7 : 1** untuk mata 40+ dan layar di bawah
matahari. Semua angka di bawah sudah dihitung.

| Peran | Warna | Kontras dengan teks/latarnya |
|---|---|---|
| Latar halaman | krem `#FFF8EF` | teks `#1F2328` = 14,99 |
| Pita atas + kotak cari | persik `#FFD8C2` | teks = 11,93 |
| Kartu barang (bergilir per kategori) | mint `#D9F2E6` · persik `#FFE5D4` · lavender `#E8E3FA` · langit `#D9ECFA` · mentega `#FFF1BF` | teks = 12,6–14,0 |
| Tombol utama (Bayar, Buka warung) | hijau tua `#0A5A48`, teks putih | 8,17 |
| Angka untung | `#075A30` di krem | 7,93 |
| Angka minus | `#9B1B12` di krem | 7,79 |
| Teks pendamping | `#57534E` di krem | 7,24 |

Aturan: tidak ada teks di atas warna jenuh selain tombol utama; tidak ada teks putih di atas
pastel; angka uang selalu warna gelap. Biru `#1446c8` fase 1 diganti palet ini.

### 0.7 Yang perlu diputuskan Bos Cyo sebelum dibangun

Perlu satu kebijakan tenant baru, misal **"Dijaga pemilik sendiri"** (default mati; hanya
berlaku kalau dinyalakan, tidak menyentuh tenant lain):

1. Lewati absen sebelum buka warung (sekarang server mewajibkannya).
2. Izin disetujui otomatis (mesinnya sudah ada; tetap tercatat siapa/kapan).
3. Satu login pemilik bisa langsung jualan dan lihat untung.

Tidak ada aturan uang yang berubah: penjualan, modal, dan jurnal tetap lewat jalur yang sama.

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

<!-- DOC-IMPACT: 2026-10-02 revisi 2: pengguna skin D pemilik tunggal; USP, yang dibuang, Jual·Belanja·Untung, palet pastel + kontras; menunggu keputusan kebijakan "dijaga pemilik sendiri". -->
<!-- DOC-IMPACT: 2026-10-03 dokumen baru; menambah skin D (Mode Warung) di belakang pilihan tenant ui_skin = D. -->
