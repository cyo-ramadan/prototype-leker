# Rencana SEO & pabrik konten — OwnerTenang

Ditulis: 2026-10-05 · Oleh: Hana (sesi strategi penjualan) · Atas permintaan Bos Cyo
Status: **RANCANGAN** — menunggu keputusan Bos Cyo di §7 sebelum tugas dimasukkan ke papan.

## 0. Gambaran satu kalimat

Hana menulis tugas konten → agen penulis & desainer membuat bahan → **Bos Cyo memilih yang lolos di satu layar**
→ yang lolos otomatis masuk **antrean terbit** → agen penerbit memposting ke blog, Instagram, Facebook, dan
setiap posting bisa dilacak balik ke tugas asalnya.

```
 PAPAN 1: PRODUKSI          MEJA KURASI (Bos Cyo)        PAPAN 2: ANTREAN TERBIT
 tugas dari Hana   ──▶  draft artikel/gambar ──▶ Lolos ──▶  tugas terbit per saluran
 (artikel, gambar,       satu layar, pratinjau   Revisi ↩   (blog · Instagram · Facebook)
  carousel)              Lolos / Revisi / Tolak  Tolak ✕     agen penerbit → link bukti
        ▲                                                            │
        └──────────────── semua terhubung lewat nomor tugas ─────────┘
```

## 1. Kenapa SEO sekarang, dan batasnya

- Pemilik usaha mencari solusi di Google saat masalahnya terasa ("karyawan curang di cafe", "cara hitung HPP
  minuman"). Artikel yang menjawab itu mendatangkan calon pembeli **gratis dan terus-menerus**, beda dengan iklan.
- SEO lambat: biasanya 2–4 bulan sebelum ada kunjungan berarti. Jadi SEO **melengkapi** jualan langsung
  (paket minggu 1), bukan menggantikannya.
- Google menghukum konten massal yang dibuat mesin tanpa nilai. Karena itu: **sedikit tapi bagus** (2 artikel per minggu),
  setiap artikel lewat Meja Kurasi Bos Cyo, berisi contoh dan angka nyata dari dunia gerai, bukan teks generik.

## 2. Fondasi teknis (sekali, dikerjakan agen developer)

Tanpa ini artikel sebagus apa pun tidak terbaca Google dengan benar.
1. `robots.txt` dan `sitemap.xml` untuk `ownertenang.biz.id`; halaman aplikasi (kasir, admin, login) **tidak diindeks**.
2. Alamat kanonik ke `ownertenang.biz.id` (alamat lama `…workers.dev` tidak boleh bersaing di Google).
3. Bagian **blog** di `ownertenang.biz.id/blog/`: satu templat artikel cepat, ramah HP, dengan data terstruktur (Article,
   FAQ), gambar dengan teks alternatif, tautan ke landing page yang sesuai, dan tombol WhatsApp yang menyebut asal artikel
   (supaya ketahuan artikel mana yang mendatangkan calon pembeli).
4. Halaman utama dan kemitraan diberi data terstruktur produk + FAQ.
5. Google Search Console terverifikasi (langkah klik Bos Cyo, lihat §7).

## 3. Peta topik (4 pilar, 12 artikel pertama)

Setiap pilar = 1 artikel panduan besar + beberapa artikel pendukung yang saling menaut, semuanya menaut ke landing page.
Volume pencarian **belum diukur** (alat riset kata kunci belum tersambung) — urutan di bawah dari logika masalah pembeli,
akan dikoreksi dengan data Search Console setelah 4–6 minggu.

| Pilar | Artikel panduan | Artikel pendukung | Landing tujuan |
|---|---|---|---|
| **Karyawan** | Cara mengawasi karyawan gerai tanpa harus datang setiap hari | Absen titip & cara mencegahnya · Aturan telat dan potongan yang adil · SOP buka-tutup shift | `/produk/` |
| **Kas & kasir** | Panduan lengkap selisih kas laci untuk pemilik kedai | SOP tutup kasir harian · Kenapa struk dihapus itu tanda bahaya · Setoran kasir ke rekening yang tertib | `/produk/` |
| **Untung & modal** | Cara menghitung modal per gelas/porsi (HPP) dari resep | Untung bersih vs omzet: kenapa gerai ramai bisa rugi · Salah catat harga beli bahan dan akibatnya | `/produk/` |
| **Banyak gerai & kemitraan** | Cara memantau gerai mitra di kota lain | Standar laporan untuk mitra franchise · Tanda gerai mitra bocor | `/produk/kemitraan/` |

Jadwal: 2 artikel per minggu selama 6 minggu (pilar dulu, pendukung menyusul). Setiap artikel diturunkan jadi
**1 gambar sampul + 1 carousel Instagram (5 slide) + 1 posting Facebook** — satu ide, tiga bentuk.

## 4. Aturan isi (berlaku untuk semua agen pembuat)

- Bahasa pemilik usaha, contoh dari gerai F&B (angka contoh harus masuk akal dan disebut sebagai contoh).
- Artikel menolong dulu; OwnerTenang disebut **paling banyak dua kali** dan selalu di akhir, dengan satu ajakan WhatsApp.
- Klaim produk hanya yang berstatus JUAL di §8 `HANDOFF-STRATEGI-PENJUALAN.md`; Una hanya dengan label "baru · sedang diuji".
  Larangan lengkap: skill `strategi-penjualan-ownertenang` dan `PROMPT-LANDING-PAGE-AHLI.md` §2.
- Gambar: ilustrasi atau tangkapan layar **akun demo**; tanpa wajah/nama orang sungguhan, tanpa logo merek lain,
  tanpa tangkapan layar palsu; setiap gambar punya teks alternatif.
- Tidak menyalin artikel orang lain; setiap draft menyebut sumber bila memakai data luar.
- Panjang artikel panduan 1.500–2.500 kata, pendukung 800–1.200 kata; judul ≤ 60 karakter, deskripsi ≤ 155 karakter.

## 5. Papan-papan yang dibuat

Semua di tempat yang sama dengan papan tugas agen yang sudah ada (database papan agen, bukan database toko —
aturan lama: urusan koordinasi agen tidak boleh masuk database pelanggan). Disekat sebagai proyek baru **`konten`**
supaya tidak tercampur dengan tugas kode Leker/Ikan.

### Papan 1 — Produksi (tugas dari Hana)
Memakai papan tugas yang ada, proyek `konten`. Jenis tugas: `ARTIKEL`, `GAMBAR`, `CAROUSEL`, `POSTING_FB`.
Setiap tugas berisi: topik, kata kunci utama, pembaca, garis besar, klaim yang boleh, tautan tujuan, saluran terbit.
Agen pembuat mengambil tugas → membuat bahan → **mengirim draft ke Meja Kurasi** (bukan menandai selesai sendiri).

### Meja Kurasi — satu layar untuk Bos Cyo
- Daftar semua draft yang menunggu, dikelompokkan per tugas: artikel tampil seperti nanti terbit, gambar & carousel
  tampil apa adanya, posting FB tampil seperti di Facebook.
- Tiga tombol: **Lolos**, **Revisi** (wajib catatan singkat → kembali ke agen pembuat), **Tolak** (wajib alasan singkat).
- Bisa dibuka dari HP; dilindungi login email Bos Cyo (bukan password yang dibagikan).
- Gambar disimpan di penyimpanan file Cloudflare (R2), bukan di database.

### Papan 2 — Antrean Terbit
- Saat Bos Cyo menekan **Lolos**, sistem **otomatis** membuat satu tugas terbit per saluran yang tercantum di tugas asal
  (mis. blog + Instagram + Facebook). Tidak ada penyalinan manual.
- Agen penerbit per saluran mengambil tugas terbit, memposting, lalu melapor dengan **link posting** sebagai bukti.
  Setiap tugas terbit membawa nomor tugas produksi asal → dari papan Hana bisa ditelusuri: tugas → draft → lolos →
  terbit di mana → link.
- Status: Menunggu → Diambil → Terbit (link) / Gagal (alasan).

### Peran agen
| Peran | Mengerjakan | Butuh akses |
|---|---|---|
| Hana | Menulis tugas produksi, membaca hasil, mengukur | Papan |
| Penulis | Artikel dan teks posting | Papan, Meja Kurasi (kirim draft) |
| Desainer | Gambar sampul, carousel | Papan, penyimpanan gambar |
| Penerbit Blog | Memasang artikel lolos ke `/blog/` lewat PR | GitHub |
| Penerbit Instagram | Memposting carousel/gambar lolos | Akun Instagram bisnis (sambungan resmi Meta) |
| Penerbit Facebook | Memposting ke Halaman Facebook | Halaman Facebook (sambungan resmi Meta) |

## 6. Tugas untuk membangun (urutan dan ketergantungan)

| # | Tugas | Untuk | Tergantung |
|---|---|---|---|
| S0 | Verifikasi Search Console; buat/siapkan Halaman Facebook + akun Instagram bisnis yang tersambung | Bos Cyo (langkah klik) | — |
| S1 | Fondasi SEO teknis (§2 butir 1–4) + templat blog | agen developer | — (boleh paralel) |
| S2 | Kontrak + struktur papan konten: proyek `konten`, tabel draft/kurasi/antrean terbit, aturan "Lolos → tugas terbit otomatis" | agen developer | — |
| S3 | Meja Kurasi (layar Bos Cyo) + penyimpanan gambar + login email | agen developer | S2 |
| S4 | Alat untuk agen: kirim draft, ambil tugas terbit, lapor link terbit | agen developer | S2 |
| S5 | 12 tugas artikel + turunannya (gambar, carousel, posting FB) | Hana menulis, agen pembuat mengerjakan | S2 (sementara S3 belum jadi, draft dikumpulkan di folder repo) |
| S6 | Laporan mingguan: artikel terbit, tayangan & klik dari Search Console, klik WhatsApp per artikel | Hana | S1, terbit pertama |

Perkiraan: S1–S4 sekitar 1–2 minggu kerja agen developer; artikel pertama bisa ditulis mulai minggu ini.

## 7. Keputusan yang dibutuhkan dari Bos Cyo

1. **Akun media sosial**: sudah ada Halaman Facebook + Instagram bisnis untuk OwnerTenang, atau dibuat baru? Agen hanya
   memposting lewat sambungan resmi Meta yang Bos Cyo setujui sendiri — tidak pernah lewat password atau kunci induk.
2. **Blog terbit otomatis?** Usul Hana: artikel yang sudah Lolos di Meja Kurasi langsung dipasang tanpa persetujuan kedua
   (Lolos = izin terbit). Kalau Bos Cyo ingin tetap menekan tombol gabung sendiri di GitHub, bilang.
3. **Nama/akun agen**: siapa yang jadi penulis, desainer, penerbit (agen keluarga mana, berapa jalur paralel).
4. **Frekuensi**: 2 artikel per minggu cukup, atau mau lebih? (Lebih banyak = lebih banyak waktu kurasi Bos Cyo.)

Setelah keputusan ini, Hana memasukkan tugas S0–S4 ke papan dengan format tugas yang berlaku, lalu menulis 12 tugas artikel.

<!-- DOC-IMPACT: 2026-10-05 dokumen baru (rancangan); belum mengubah perilaku sistem atau papan. -->
