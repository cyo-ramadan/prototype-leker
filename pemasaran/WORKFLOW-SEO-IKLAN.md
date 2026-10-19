# Workflow SEO & iklan landing page OwnerTenang

Dibuat: 2026-10-08 · Oleh: Hana · Permintaan Bos Cyo: "untuk kerjaan seo dan iklan landing pagenya
bikin dulu workflow nya".

Workflow ini mengikuti aturan di skill `strategi-penjualan-ownertenang` dan `HANDOFF-STRATEGI-PENJUALAN.md`:
- §8 menentukan apa yang boleh dijanjikan;
- §10 menentukan posisi, harga, dan urutan kanal.

Kalau ada yang bertentangan, dua sumber itu yang benar.

## Prinsip (berlaku untuk SEO dan iklan)

1. **Hanya janji berstatus `JUAL`.** `UJI` hanya boleh dengan label "sedang kami uji".
   `SEMBUNYI`/`INTERNAL` tidak disebut. Tes otomatis klaim wajib lulus sebelum terbit.
2. **Satu ajakan: "Minta demo lewat WhatsApp."** Setiap tombol WhatsApp membawa **kode sumber** di
   teks pesannya, misalnya `[G-absen-gps]` atau `[A-meta-video1]`. Dari kode itu ketahuan chat datang dari
   halaman, artikel, atau iklan mana, tanpa database.
3. **Mulai dari ketakutan pemilik, bukan dari fitur.** Ketakutannya: karyawan curang saat pemilik tidak
   ada, dan untung yang sebenarnya tidak jelas.
4. **Urutan kanal tidak dilompati.** Jual langsung → kemitraan → konten organik → **SEO + iklan Google
   Search** (setelah domain jalan) → **iklan Meta paling akhir**.
5. **Uang iklan tidak dinaikkan sebelum ada angka demo → bayar.**
6. **Tidak ada angka karangan.** Testimoni, angka bukti baru, dan target diisi `[ISI: …]` sampai Bos Cyo
   memberi angkanya.

## Siapa mengerjakan apa

| Peran | Tugas |
|---|---|
| **Bos Cyo** | Menyetujui setiap artikel dan iklan sebelum terbit, menentukan batas uang iklan, membalas chat WhatsApp dan memberi demo, mengisi buku tahap calon pembeli |
| **Hana** | Riset kata kunci, menulis brief, memeriksa janji, membaca angka, laporan mingguan |
| **Agen penulis** (Karen / Mesin) | Draft artikel dan halaman varian iklan dari brief Hana |
| **Agen teknis** (Karen) | Memisahkan situs jualan, memasang alat ukur, kerangka artikel, tes klaim |

---

## Tahap 0 — Gerbang sekali pasang (sebelum SEO dan iklan mulai)

| # | Pekerjaan | Selesai kalau |
|---|---|---|
| G1 | **Domain ownertenang.biz.id tersambung.** Status terakhir di §8: kode siap, domain belum terbukti terbuka | Halaman jualan terbuka di domain itu dari HP biasa |
| G2 | **Situs jualan dipisah dari aplikasi POS**: situs statis tanpa database di domain utama; aplikasi pindah ke `app.` | Menambah artikel tidak ikut merilis aplikasi kasir |
| G3 | **Alat ukur**: Google Search Console (daftar dengan akun Google Bos Cyo) + statistik pengunjung Cloudflare (gratis, tanpa cookie) | Dua-duanya menunjukkan kunjungan pertama |
| G4 | **Kode sumber di setiap tombol WhatsApp** (prinsip 2) | Chat uji dari 2 halaman berbeda membawa kode berbeda |
| G5 | **Buku tahap calon pembeli**: satu Google Sheet berkolom tanggal · nama · kode sumber · tahap (chat → demo → coba → bayar) · catatan | Bos Cyo bisa mengisi satu baris dari HP |
| G6 | **Tes klaim diperluas ke artikel**: kata terlarang yang sama dengan landing page | Artikel berisi kata terlarang ditolak otomatis |

G2–G4 dan G6 dikerjakan Karen sebagai task. G1, G3 (akun Google), dan G5 butuh Bos Cyo.

---

## Workflow A — SEO (rutin)

**Tujuan:** pemilik F&B yang mencari jalan keluar masalah gerai di Google menemukan OwnerTenang, lalu
chat WhatsApp.

### A1. Riset kata kunci (bulanan, Hana)

Kumpulkan pertanyaan yang benar-benar diketik pemilik. Sumbernya:
- saran ketik Google dan "Orang juga bertanya";
- halaman pesaing;
- setelah berjalan, Search Console (kata kunci yang sudah memunculkan situs kita).

Kelompokkan per ketakutan:

| Kelompok | Contoh pencarian |
|---|---|
| Kas & kecurangan | cara mencegah kasir curang, selisih uang kasir, karyawan hapus transaksi |
| Absen & karyawan | absen karyawan foto lokasi, aplikasi absen gerai, hitung gaji dari jam kerja |
| Untung & stok | cara hitung HPP minuman, untung bersih per outlet, stok bahan baku cafe |
| Banyak gerai | kontrol banyak outlet, kelola cabang tanpa datang, sistem kemitraan minuman |

Pilih 4–8 kata kunci per bulan. Utamakan yang niatnya mencari solusi ("cara…", "aplikasi…").

### A2. Brief per halaman (Hana)

Satu brief berisi:
- satu kata kunci utama;
- pembaca (pemilik berapa gerai, jenis usaha);
- kejadian nyata pembuka (absen merah, struk dihapus, laci kurang);
- fitur `JUAL` yang relevan;
- 2 tautan internal ke landing page;
- kode sumber WhatsApp.

Jenis halaman:
- **Halaman masalah** (pilar, satu per kelompok): panjang, menjawab tuntas, jarang diubah.
- **Artikel tanya-jawab**: pendek, satu pertanyaan, menautkan ke halaman masalahnya.
- **Halaman per jenis usaha** (kopi, minuman, bakery): hanya untuk jenis usaha yang sudah dipakai dan
  berstatus `JUAL`.

### A3. Draft (agen penulis)

Ikuti "Cara menulis" di skill strategi penjualan:
- kalimat pendek, bahasa pemilik usaha;
- tanpa istilah akuntansi;
- angka hanya dari §10;
- yang belum pasti ditulis `[ISI: …]`.

### A4. Pemeriksaan (otomatis + Hana)

1. Tes klaim lulus (G6).
2. Judul ≤ 60 karakter memuat kata kunci; deskripsi ≤ 155 karakter.
3. Ada tautan ke landing page dan tombol WhatsApp berkode sumber.
4. Hana mencocokkan setiap janji ke status §8.

### A5. Persetujuan Bos Cyo

Hana kirim ringkasan satu layar: judul, kata kunci, 3 janji utama, tautan pratinjau. Bos Cyo cukup
menjawab **setuju** atau **ubah: …**. Belum disetujui = belum terbit.

### A6. Terbit (agen teknis)

Halaman masuk ke situs jualan. Lalu minta Google mengindeks lewat Search Console.

### A7. Ukur dan rawat (mingguan, Hana)

Per halaman, Hana membaca: tayangan, klik, posisi rata-rata, dan jumlah chat WhatsApp berkode halaman itu.
- **Halaman di posisi 8–20**: diperbarui dulu sebelum menulis halaman baru. Paling cepat naik.
- **Halaman 8 minggu tanpa tayangan**: kata kuncinya diganti.

**Ritme awal:** 1–2 halaman per minggu. Halaman masalah dulu, baru artikel tanya-jawab.

---

## Workflow B — Iklan + landing page

**Gerbang iklan.** Ketiganya wajib sebelum uang iklan pertama keluar:
- (a) Tahap 0 selesai;
- (b) sudah ada demo dari jual langsung atau kemitraan;
- (c) Bos Cyo menentukan **batas uang iklan per bulan** `[ISI: Rp…]`.

Urutan: **Google Search** dulu (orangnya sedang mencari solusi), **Meta** paling akhir.

### B1. Rancang kampanye (Hana)

Satu kampanye = satu ketakutan + satu segmen + satu halaman tujuan. Contoh:
- "Pemilik 3–10 gerai minuman takut kasir curang" → halaman utama, bagian "Coba jadi pemilik 30 detik".
- "Pemilik kemitraan ingin membandingkan gerai mitra" → halaman kemitraan.

### B2. Halaman tujuan (agen teknis)

Pakai landing page yang ada. Judul pembuka bisa disesuaikan per iklan lewat alamat tautan, jadi tidak
perlu halaman baru per iklan dan tidak perlu database. Tombol WhatsApp membawa kode sumber iklan itu.

### B3. Materi iklan (agen penulis)

- **Google Search**: 2–3 variasi judul dan deskripsi per kelompok kata kunci niat tinggi. Contoh: "aplikasi
  absen karyawan lokasi", "aplikasi kasir banyak outlet", "kontrol gerai tanpa datang".
- **Meta** (nanti): 3 video 9:16 yang sudah ada (absen merah, hapus struk, untung semua gerai), teks
  pendek, satu ajakan.

### B4. Pemeriksaan + persetujuan

Pemeriksaannya sama dengan A4. Bos Cyo menyetujui materi **dan** batas uang harian.

### B5. Uji kecil (7–14 hari)

- Uang harian kecil `[ISI: Rp…/hari]`.
- 2–3 variasi berjalan bersamaan.
- Tidak diubah-ubah di 3 hari pertama.

### B6. Baca angka dan putuskan (Hana → Bos Cyo)

| Angka | Arti |
|---|---|
| Biaya per klik | Iklannya menarik atau tidak |
| Biaya per chat WhatsApp | Halaman tujuannya meyakinkan atau tidak |
| Biaya per demo | Calonnya serius atau tidak |
| Biaya per pembayar | Satu-satunya angka untuk menaikkan uang iklan |

Aturan:
- Variasi yang menghabiskan `[ISI: Rp…]` tanpa satu chat pun **dimatikan**.
- Uang iklan **baru boleh naik** setelah ada pembayar dari iklan, dan biaya per pembayar masih di bawah
  `[ISI: batas, mis. 2–3 bulan harga langganan]`.
- Variasi pemenang menjadi bahan halaman SEO berikutnya. Kata yang laku di iklan biasanya laku juga di
  pencarian biasa.

---

## Pemeriksaan 2026-10-09 — apakah sudah sesuai strategi, dan apa yang kurang

Dicek terhadap `HANDOFF-STRATEGI-PENJUALAN.md` §8/§10 dan target Bos Cyo: **dapat checkout minggu ini**.
Program yang dijual tetap POS ini dengan semua USP, termasuk Una.

**Yang sudah sesuai:** hanya janji `JUAL`; satu ajakan WhatsApp; urutan kanal tidak dilompati; uang iklan baru
naik setelah ada pembayar; tidak ada angka karangan; persetujuan Bos Cyo sebelum terbit.

**Yang kurang (dan statusnya):**

| # | Kekurangan | Status 2026-10-09 |
|---|---|---|
| 1 | **Una tidak ada di workflow**, padahal Bos Cyo menetapkan Una USP kedua | Ditambah di bagian "Una di SEO dan iklan" di bawah |
| 2 | **Kode sumber di tombol WhatsApp (G4)** belum ada, jadi chat tidak bisa dilacak | **Selesai untuk kedua landing page**: pesan berakhir `[web-utama]` / `[web-kemitraan]`, atau `[nama-kampanye]` bila tautan memakai `?s=nama-kampanye` |
| 3 | **Dasar teknis SEO belum ada**: tidak ada `robots.txt`, `sitemap.xml`, alamat kanonik, penanda "jangan diindeks" untuk aplikasi | Tugas di papan agen: `karen-PEMASARAN-SEO-DASAR` |
| 4 | **Tidak ada jalur bayar sama sekali** — tidak ada alur dari "mau" ke "uang masuk" | Ditulis di `CHECKOUT-MANUAL.md` |
| 5 | **Akun pemilik pelanggan (Entity Admin) hanya bisa dibuat lewat migration**, dan **belum ada fitur ganti password sendiri** | Tugas di papan agen: `karen-PEMASARAN-ENTITY-ADMIN-BUAT-AKUN` (**penghalang terbesar checkout**), lalu `karen-PEMASARAN-ENTITY-ADMIN-GANTI-PASSWORD` (berurutan) |
| 6 | G1 domain: Bos Cyo sudah mengonfirmasi halaman terbuka (2026-10-05). G2: alamat aplikasi `app.` belum dikonfirmasi terpasang | Menunggu Bos Cyo (2 menit di Cloudflare) |
| 7 | Antrean artikel TemanNikah (proyek `nikah`) sudah OPEN sejak 12–13 September tanpa ada yang mengklaim | Pelajaran: jangan menumpuk antrean konten sebelum ada yang menjalankan |

**Hal yang harus jujur dikatakan:** SEO dan iklan **tidak akan menghasilkan checkout minggu ini**. SEO butuh 2–4
bulan, iklan baru boleh setelah ada demo yang berubah jadi bayar. Checkout minggu ini datang dari **jual langsung**
(`PAKET-JUALAN-MINGGU-1.md`) yang dilengkapi `CHECKOUT-MANUAL.md`. SEO dan iklan dimulai sekarang supaya hasilnya
ada bulan depan, tanpa mengganggu target minggu ini.

**Persetujuan konten:** pakai cara sederhana di A5 (ringkasan satu layar, Bos Cyo menjawab *setuju* atau
*ubah: …*) untuk 4 minggu pertama. Layar kurasi tersendiri (`PLAN-SEO-KONTEN.md` Meja Kurasi) ditunda sampai ada
lebih dari 2 artikel per minggu atau agen penerbit Instagram/Facebook benar-benar berjalan — sebelum itu, membangun
layar baru memperlambat target utama.

**Papan tugas:** tugas teknis masuk ke papan agen di proyek `leker` (repo yang sama dengan halaman jualan), wilayah
`pemasaran`. Tidak membuat proyek baru dulu.

**Risiko yang harus Bos Cyo tahu sebelum menjual ke orang luar (belum ada tugasnya, menunggu keputusan):**

- **Password disimpan dengan hash sederhana (SHA-256 tanpa garam).** Cukup untuk akun internal, lemah untuk akun
  pelanggan luar. Perbaikannya (hash berlapis garam yang otomatis menaikkan akun lama saat login) menyentuh jalur
  login semua peran, jadi dikerjakan sebagai tugas terpisah dan hati-hati, bukan minggu ini.
- **Rantai `SAAS-MODUL-01` sampai `07` (pasang tenant baru tanpa SQL tangan)** masih terbuka sejak 23 Agustus dan belum
  diklaim. Itu fondasi jangka panjang untuk 10+ pelanggan. Untuk 1–3 pelanggan pertama, tombol Buat Akun Entity Admin
  (tugas di atas) sudah cukup; rantai itu perlu dijadwalkan sebelum pelanggan ke-4.

### Una di SEO dan iklan

Una adalah USP kedua, bukan judul. Aturannya mengikuti `HANDOFF-STRATEGI-PENJUALAN.md` §10:

1. Selalu berlabel **"Baru · sedang kami uji bersama pemilik pertama"** dan selalu tampil dengan langkah draft →
   pemilik menekan "Ya".
2. **SEO:** satu halaman tanya-jawab tentang pekerjaan yang paling menyakitkan pemilik baru (mis. "cara memasukkan
   puluhan menu sekaligus") yang menyebut Una sebagai cara membantu, bukan sebagai judul halaman.
3. **Iklan Google Search:** Una tidak masuk judul atau kata kunci. Orang belum mencari "Una"; mereka mencari
   masalahnya.
4. **Iklan Meta nanti:** satu video "isi menu dari foto papan menu" (nomor 9 di naskah) sebagai video pendukung,
   bukan video utama.
5. Syarat Una naik jadi USP penuh ada di §10; sampai syarat itu terpenuhi, klaim di atas tidak berubah.

### Rencana minggu ini (target: satu checkout)

| Hari | Bos Cyo | Hana | Karen |
|---|---|---|---|
| Jumat–Sabtu | Isi keputusan di `CHECKOUT-MANUAL.md` (rekening, jaminan, diskon). Kirim 10 pesan pertama. Pasang `app.` di Cloudflare | Siapkan buku tahap; rapikan templat; pantau chat dengan kode sumber | Mulai tugas Entity Admin dan dasar SEO |
| Minggu–Senin | Demo 15 menit untuk yang membalas | Menyiapkan penawaran per calon dari jawaban "masalah nomor 2" | Entity Admin selesai/di-rilis |
| Selasa–Rabu | Kirim penawaran + tagihan; tindak lanjut hari ke-3 | Menyiapkan daftar kebutuhan gerai | Siapkan akun pelanggan pertama |
| Kamis | Cek mutasi rekening → **checkout** | Laporan angka minggu ini | Serah terima gerai |

## Laporan mingguan (Hana → Bos Cyo, satu layar)

1. Kunjungan situs jualan minggu ini, dan dari mana (Google biasa / iklan / langsung).
2. Chat WhatsApp per kode sumber.
3. Tahap calon pembeli dari buku tahap: chat → demo → coba → bayar.
4. Halaman/iklan terbaik dan terburuk, plus satu keputusan yang diusulkan.
5. Yang menunggu Bos Cyo (persetujuan, angka, balasan WhatsApp).

Angkanya dibaca dari Search Console, statistik Cloudflare, dan buku tahap, bukan dari ingatan.

## Yang menunggu Bos Cyo

- [ ] Domain ownertenang.biz.id: sudah dipasang di Cloudflare? (Hana belum bisa memeriksa dari sesi cloud.)
- [ ] Akun Google untuk Search Console (dan nanti Google Ads).
- [ ] Batas uang iklan per bulan, dan uang harian untuk uji kecil.
- [ ] Siapa yang membalas chat WhatsApp demo dan mengisi buku tahap.
- [ ] Setuju situs jualan dipisah dari aplikasi POS (G2)?

DOC-IMPACT: dokumen baru (workflow kerja, tidak mengubah perilaku sistem). Terkait
`HANDOFF-STRATEGI-PENJUALAN.md` §8/§10, skill `strategi-penjualan-ownertenang`, `pemasaran/README.md`,
`test/landing-page-claims.test.js`.
