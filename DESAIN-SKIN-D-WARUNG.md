# Skin D — "Mode Warung" untuk pedagang kelontong & UMKM kecil

Ditulis: 2026-10-03 · Oleh: Hana (sesi UI/UX) · Atas permintaan Bos Cyo:
*"bikin skin d, yang engga hanya mengubah ui tapi juga ux ... buat versi pedagang2 kelontong,
umkm kecil tertarik memakainya ... carikan pembeda yang unique selling proposition-nya gede banget."*

Skin A/B/C mengganti **tampilan**. Skin D mengganti **cara pakai**: layar baru, alur baru, kata baru.
Mesin di belakangnya tetap sama (penjualan, stok, modal per barang, izin, laci) — tidak ada data
yang ditulis lewat jalur lain, tidak ada aturan keuangan yang berubah.

---

> **2026-10-02:** rancangan "pemilik jaga sendiri, tanpa karyawan" yang sempat ditulis di sini
> dipindah jadi **skin E** (Bos Cyo: *"yang kusus ga ada karyawan dibuat skin e"*) —
> `DESAIN-SKIN-E-JAGA-SENDIRI.md`. Skin D tetap untuk warung yang dijaga bergantian
> (pemilik + anak/karyawan). Katalog semua skin: `DESAIN-SKIN-KATALOG.md`.

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

## 3b. Tampilan "Plang Seng" (2026-10-03)

Bos Cyo: *"benerin juga untuk skin d, kamu bikin uniq juga ya"* (setelah skin E dirombak dengan skill
`frontend-design`). D harus punya identitas sendiri, tidak boleh mirip E.

- **Motif: papan nama seng berenamel** — plang biru yang dipaku di depan warung dan toko kelontong:
  huruf krem, bingkai garis ganda, paku keling di empat sudut. E memakai tenda + toples + nota; D
  memakai plang.
- **Dipakai di tiga tempat saja** (satu elemen berani, sisanya tenang): papan nama di atas layar Jual
  dan bilah atas halaman admin, kotak **Total belanja** di layar Bayar, dan kotak **Untung bersih hari
  ini** (halaman Hari ini gerai & Panel Pemilik, angkanya kuning).
- **Huruf Barlow + Barlow Condensed** — keluarga huruf rambu & plat nomor; Condensed untuk nama
  warung, harga, dan angka uang.
- Kartu barang putih dengan bingkai tipis, harga biru berhuruf plang; barang di keranjang berlatar biru
  muda + lencana jumlah kuning. Kembalian tetap kuning (uang yang harus dilihat).
- Label tanpa huruf kapital; ikon minimarket di layar gerbang dihapus.

| Peran | Warna | Kontras |
|---|---|---|
| Plang (biru enamel) + huruf krem | `#1C3F94` + `#FFF5DC` | 8,8 |
| Angka di plang (kuning) | `#FFC72C` di biru | 6,2 (huruf besar) |
| Latar | `#EDF0F5` (abu kebiruan, bukan krem) | tinta `#14213D` 14,0 |
| Harga & tombol | biru `#1C3F94` di putih | 9,6 |
| Lencana / kembalian | tinta di kuning `#FFC72C` | 10,2 |
| Teks pendamping | `#3D4A63` | 7,8 |

Token: `public/warung.css` (`html[data-skin="d"]`) dan `scripts/generate-skin-css.py` (skin `d`).

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

### 4c. Pemilik yang mengurus admin sendiri: Workspace Gerai "Hari ini" (2026-10-03)

Bos Cyo: *"tenant punya karyawan cs, tapi admin masih dikerjakan oleh owner, buang2 yang bikin owner
tambah bingung ... bener2 ala2 steve jobs. koreksi ui dan ux nya."*

**Siapa:** Bu Sri (§1) punya kasir, tapi semua urusan admin (barang, harga, akun kasir, menyetujui
pengajuan, cek laci) dia kerjakan sendiri dari HP, di sela jaga warung.

**Yang dia lihat sebelumnya saat membuka Workspace Gerai** (dicek di layar 390 px):

| Yang tampil | Kenapa membingungkan |
|---|---|
| 5 tombol di bilah atas: ← Owner, Customer, Kasir Login, Lihat Kasir (Read-only), Logout Admin | Tiga di antaranya untuk orang lain (pelanggan, kasir, pemilik platform) |
| Judul "Workspace Gerai" + "Master dan transaksi di halaman ini mengikuti scope gerai aktif." | Bahasa sistem, bukan bahasa warung |
| "20 barang aktif · 6 kategori · 0 customer" | Angka yang tidak membantu memutuskan apa pun |
| Halaman pertama = formulir **Identitas gerai** + kartu "Scope gerai" | Pemilik membuka aplikasi bukan untuk mengganti nama toko |
| 29 menu dalam 7 grup | Takut salah pencet; yang penting tenggelam |
| "Auto Permit", "Approval Queue", "ACC + POSTING", "posting snapshot secara atomic", "ID drawer_…", "OPEN" | Istilah akuntan/programmer |

**Yang dibangun (hanya skin D):**
1. **Halaman depan "Hari ini"** (`public/warung-admin.js`): sapaan + nama toko → **untung bersih hari
   ini** (dengan penjualan & kemarin) → **Butuh keputusan Anda** (pengajuan kasir, permintaan hapus
   transaksi, permintaan tutup laci — masing-masing tombol *Putuskan*) → **Laci kasir** (siapa jaga,
   sejak jam berapa, uang yang seharusnya ada) → tiga jalan pintas (Tambah barang, Cek stok, Untung rugi).
   Hanya baca, endpoint yang sama dengan tab aslinya, tanpa polling.
2. **Menu 6 tombol** (`public/nav-groups.js`, `SKIN_GROUPS.d`): Hari ini · Persetujuan · Penjualan
   (Riwayat, Laci Kasir, Untung Rugi, Biaya Toko) · Barang (Daftar, Stok, Kategori, Supplier) · Tim
   (Karyawan, Akun Kasir, Absen) · **Lainnya**.
3. **Lainnya = daftar berkelompok** seperti menu Pengaturan HP, tiap baris dengan keterangan satu
   kalimat: Toko & pelanggan · Tim · Uang & pembukuan · *Lanjutan — jarang dipakai*. Tab baru dari sesi
   lain otomatis masuk "Fitur lain".
4. **Dibuang dari pandangan** (CSS skin D): link Owner/Customer/Kasir Login, judul + kalimat scope,
   hitungan barang/kategori, kartu "Scope gerai". Tersisa: *Lihat layar kasir* dan *Keluar*.
5. **Bahasa pemilik**: Approval Queue → Pengajuan kasir; ACC + POSTING → Setujui; Reject → Tolak;
   Auto Permit → Setujui otomatis (dipindah ke paling bawah); Permit Hapus Transaksi → Permintaan hapus
   transaksi; laci "OPEN/CLOSED" → Buka/Tutup, "ID drawer_…" disembunyikan, "Modal" → Uang awal; kartu
   permintaan tutup laci hanya muncul kalau ada yang menunggu. Panel Pemilik: "Buka Workspace" → Buka
   toko, Logout → Keluar. Penggantian hanya pada teks yang tampil, tidak pada data yang dikirim.

**Tidak berubah:** semua tab, tombol, dan aturan tetap ada dan bekerja sama (menu hanya menekan tab
asli). Tenant 0/A/B/C/E tidak tersentuh.

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

<!-- DOC-IMPACT: 2026-10-03 §3b: tampilan "Plang Seng" (papan seng enamel biru, Barlow, kuning untuk uang). -->
<!-- DOC-IMPACT: 2026-10-03 §4c: Workspace Gerai skin D untuk pemilik yang mengurus admin sendiri (Hari ini, menu 6 tombol, Lainnya berkelompok, bahasa pemilik). -->
<!-- DOC-IMPACT: 2026-10-02 revisi 2 (pemilik tunggal) dipindah ke skin E: DESAIN-SKIN-E-JAGA-SENDIRI.md. -->
<!-- DOC-IMPACT: 2026-10-03 dokumen baru; menambah skin D (Mode Warung) di belakang pilihan tenant ui_skin = D. -->
