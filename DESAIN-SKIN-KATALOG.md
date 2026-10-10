# Katalog Skin MAXI — siapa, masalahnya apa, kenapa desainnya begini

Ditulis: 2026-10-02 · Oleh: Hana · Atas permintaan Bos Cyo: *"setiap skin dikasih detil2 catatan
yang masalah bu rina diatas tadi dsb nya ya"*.

Satu halaman untuk memilih skin per tenant (Owner Console → Tenant → Kebijakan → Tampilan). Tiap skin
punya **satu orang** yang dibayangkan memakainya, **masalah yang dia rasakan**, **janji** yang dijual,
dan **batasnya**. Kalau ragu memilih skin untuk calon pelanggan: cari orang yang paling mirip di bawah.

Aturan bersama: fitur baru cukup dibangun sekali di skin 0; A/B/C/D/E ikut otomatis (A/B/C hanya
lapisan warna/bentuk; D/E menambah layar Mode Warung di atasnya). Detail teknis: `HANDOFF-UIUX-SIAP-JUAL.md` §8.

| Skin | Untuk siapa | Mengubah | Janji satu kalimat |
|---|---|---|---|
| **0 · Sekarang** | Tenant yang sudah jalan (tim terbiasa) | — | "Tidak ada yang berubah tanpa diminta." |
| **A · Tenang** | Pemilik 3–10 gerai F&B yang jarang di lokasi | Tampilan | "Gerai jalan. Kas jujur. Anda tenang." |
| **B · Papan Siaga** | Manajer area yang memantau banyak gerai | Tampilan | "Sekali lirik, tahu gerai mana yang perlu Anda." |
| **C · Kabar Gerai** | Pemilik yang hidup di WhatsApp | Tampilan | "Gerai Anda mengabari seperti teman, bukan seperti laporan." |
| **D · Mode Warung** | Warung/UMKM kecil, dijaga bergantian (ada anak/karyawan) | Tampilan + cara pakai | "Untungnya kelihatan. Uangnya aman." |
| **E · Jaga Sendiri** | Warung tanpa karyawan — pemilik = kasir = admin | Tampilan + cara pakai + **aturan** | "Jualan seperti biasa. Malamnya tahu untung beneran — tanpa nyatet." |
| **G · Percetakan** | Percetakan yang order-nya masuk lewat WA, pemilik sering tidak di toko | Tampilan + cara pakai + **fitur baru** (chat WA → order otomatis → antrian per mesin → agen cetak; riwayat order anti-palsu) | "Order dari WA langsung jadi antrian mesin. Karyawan tidak bisa main order." |
| **F · Racik Parfum** | Toko parfum racikan — tiap botol takarannya beda per pelanggan | Tampilan + cara pakai + **aturan** (harga jual boleh diubah & tercatat; tanpa absen; pemilik bisa jual langsung) | "Racikan tiap pelanggan teringat, bahan dan modalnya terhitung pas." |

---

## 0 · Sekarang

**Siapa:** tenant yang sudah memakai MAXI hari ini (termasuk gerai Leker dan entity KPM). Kasir,
admin gerai, dan pemilik sudah hafal letak tombolnya.

| Yang terjadi | Yang dirasakan |
|---|---|
| Tampilan berubah tiba-tiba | Kasir bingung di jam ramai, salah tekan |
| Fitur baru terus ditambah sesi lain | Butuh fitur baru tetap muncul, tanpa ganti kebiasaan |

**Kenapa begini:** default semua tenant. Pilihan aman sampai salah satu skin terbukti di tenant Lab.
**Batas:** tidak memuat file skin apa pun; menu tetap deretan tab lama (bukan menu berkelompok).

## A · Tenang

**Siapa: Pak Hendra, 42 tahun, pemilik 5 kedai kopi** di dua kota. Jarang di lokasi; dulu pegawai
kantoran, terbiasa aplikasi bank dan e-commerce yang rapi.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Laporan masuk lewat chat, foto struk, Excel | "Saya harus menebak gerai mana yang beres" |
| Kas sore kurang Rp50 ribu, tidak ada yang tahu kenapa | Curiga ke semua orang, capek |
| Aplikasi kasir lama penuh istilah (HPP, permit, saldo kas) | Malas membuka |

**Janji:** "Gerai jalan. Kas jujur. Anda tenang." **Desain:** hijau tenang seperti landing page, huruf
Plus Jakarta Sans, kartu rapi berjarak, menu berkelompok (Toko, Transaksi, Barang, Tim, Laporan,
Keuangan, Pelanggan) supaya tidak menakutkan di hari pertama.
**Cocok kalau:** calon pelanggan ingin terlihat profesional dan tenang. **Batas:** baru lapisan
tampilan; layar Ringkasan Pemilik khusus belum ada.

## B · Papan Siaga

**Siapa: Mbak Dewi, 35 tahun, manajer area 8 gerai minuman** milik bosnya. Membuka aplikasi 20× sehari
di sela rapat; yang dicari selalu "mana yang bermasalah sekarang".

| Yang terjadi | Yang dia rasakan |
|---|---|
| Satu gerai telat buka, baru tahu jam 11 | Dimarahi bos untuk hal yang bisa dicegah |
| Angka penting kecil, tertutup teks | Harus zoom, salah baca |
| Pengajuan izin menumpuk | Kasir menunggu, antrian pembeli memanjang |

**Janji:** "Sekali lirik, tahu gerai mana yang perlu Anda." **Desain:** bagian atas grafit, sudut
tegas, huruf Archivo rapat, angka besar, warna = status (hijau aman, kuning tunggu, merah masalah).
**Cocok kalau:** penggunanya pemantau, bukan penjaga kasir. **Batas:** tidak gelap penuh (kartu lama
berlatar putih akan jadi "pulau"); tabel status semua gerai belum dibangun.

## C · Kabar Gerai

**Siapa: Bu Lina, 50 tahun, pemilik 3 toko roti** keluarga. Semua urusan lewat WhatsApp; aplikasi
dengan tabel membuatnya cepat menyerah.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Karyawan lapor lewat chat, tercecer | "Kemarin sudah dikirim belum ya?" |
| Aplikasi baru = belajar lagi | Takut salah pencet, minta anaknya |
| Laporan berbentuk tabel | Tidak dibaca |

**Janji:** "Gerai Anda mengabari seperti teman, bukan seperti laporan." **Desain:** atas hijau toska ala
WhatsApp, kartu berbentuk gelembung chat, huruf Nunito yang bulat dan ramah.
**Cocok kalau:** pemiliknya nyaman di WhatsApp, kurang nyaman dengan tabel. **Batas:** umpan "Kabar"
bergaya chat belum dibangun; saat ini hanya bentuk dan warnanya.

## D · Mode Warung

**Siapa: Bu Sri, 46 tahun, warung kelontong di depan rumah.** ±300 jenis barang. Dijaga bergantian
dengan anaknya dan satu karyawan. Mata sudah butuh huruf besar. Detail: `DESAIN-SKIN-D-WARUNG.md`.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Warung ramai tiap hari | "Kok uangnya nggak pernah kelihatan ada?" |
| Uang dapur dan uang warung satu laci | Tidak pernah tahu untung beneran |
| Ditinggal ke pasar / sholat / jemput anak | Was-was laci diambil atau struk "hilang" |
| Harga grosir naik diam-diam | Jual tetap harga lama, rugi tanpa sadar |
| Aplikasi kasir yang pernah dicoba | Menu banyak, istilah asing, ditinggal setelah seminggu |

**Janji:** "Untungnya kelihatan. Uangnya aman." **Desain "Plang Seng":** papan nama seng berenamel biru (huruf krem, bingkai ganda, paku keling) di
atas layar dan pada angka uang terpenting, huruf Barlow seperti rambu, kuning untuk uang yang harus dilihat.
Layar Jual satu layar (cari, paling sering, Bayar, kembalian besar), Panel Pemilik "Hari ini". Absen + buka laci tetap (karena ada orang lain yang jaga).
**Admin dikerjakan pemilik sendiri (2026-10-03):** Workspace Gerai dibuka di halaman **Hari ini**
(untung, yang menunggu keputusan, laci), menu 6 tombol (Hari ini · Persetujuan · Penjualan · Barang ·
Tim · Lainnya), "Lainnya" berupa daftar berkelompok berketerangan, istilah teknis diganti bahasa
pemilik. Detail: `DESAIN-SKIN-D-WARUNG.md` §4c.
**Cocok kalau:** warung kecil yang **punya** penjaga selain pemilik.

## E · Jaga Sendiri

**Siapa: Bu Rina, 38 tahun, warung kelontong + jajanan di gang perumahan, jaga sendirian** dari subuh
sampai jam 9 malam sambil masak dan ngurus anak. Tidak punya karyawan. Detail:
`DESAIN-SKIN-E-JAGA-SENDIRI.md`.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Uang dapur dan uang warung satu kaleng | "Ramai terus, kok uangnya nggak pernah ada?" |
| Aplikasi kasir lain menyuruh absen, buka shift, isi karyawan | "Ini buat toko besar, bukan saya" |
| Harga grosir naik diam-diam | Dijual harga lama — rugi tanpa sadar |
| Malam capek | Buku catatan berhenti di halaman 4 |

**Janji:** "Jualan seperti biasa. Malamnya tahu untung beneran — tanpa nyatet." **Desain "Tenda Warung":** tenda bergaris hijau-putih di atas papan nama, kartu barang seperti label
toples (tutup pastel sesuai kategori), untung ditampilkan sebagai nota, huruf Baloo 2, latar sage pucat;
teks/angka gelap berkontras ≥ 7:1. Buka/Tutup warung satu ketukan, tab **Jual · Untung**. **Aturan berubah:** tanpa absen, pengajuan
otomatis disetujui (tetap tercatat), login kasir bisa melihat untung.
**Jangan dipilih** untuk tenant yang punya karyawan — pengawasan absen & izin jadi mati.

## F · Racik Parfum

**Orangnya:** pemilik toko parfum racikan dengan satu-dua karyawan. Kulakan bibit, alkohol, fixative,
botol; setiap botol diracik di depan pembeli. "Bubble Gum" Kiki tidak sama dengan "Bubble Gum" pembeli lain.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Takaran diubah sesuai selera pembeli | Stok bibit di catatan tidak pernah cocok |
| Pembeli lama datang lagi "seperti kemarin" | Takarannya lupa, pembeli kecewa |
| Harga ditawar / bibit premium ditambah | Harga di kasir tidak bisa diubah, akhirnya dicatat manual |
| Lagi meracik, pembeli lain datang | Racikan setengah jadi hilang dari layar |

**Janji:** "Racikan tiap pelanggan teringat, bahan dan modalnya terhitung pas." **Desain "Meja Atelier":**
kertas gading, tinta plum, aksen kuningan, nama aroma huruf Fraunces miring; botol kaca yang terisi lapisan
warna tiap bahan saat takaran diubah. Alur **Pesanan → Racik → Bayar → Nota**; draft & racikan terakhir per
pelanggan di HP/tablet itu. **Aturan berubah:** kasir boleh mengubah harga jual, tercatat di penjualan.
Detail: `DESAIN-SKIN-F-RACIK-PARFUM.md`.

## G · Percetakan

**Siapa: Pak Darto, 45 tahun, pemilik percetakan digital** dengan 3 mesin (outdoor, A3+, printer
dokumen) dan 3 karyawan. Order masuk lewat WA toko; pemilik sering keluar kota.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Order WA dicatat karyawan di buku / tidak dicatat | Curiga ada order "di bawah meja", tidak bisa membuktikan |
| Karyawan bolak-balik membaca chat untuk tahu ukuran & file | Antrian kacau, file tertukar, salah cetak |
| Harga diturunkan setelah pelanggan bayar penuh | Selisih kas, tidak ada jejak |

**Janji:** "Order dari WA langsung jadi antrian mesin. Karyawan tidak bisa main order." **Desain:**
tinta biru tua + aksen cyan (CMYK), IBM Plex Sans. Kasir diarahkan ke **Layar Cetak** (`/s/<kode>/cetak`):
Chat masuk, Draft, Antrian per mesin, Order, Pengaturan; Workspace Gerai dapat tombol "Layar Cetak".
**Saklar fitur:** seluruh modul percetakan hanya hidup untuk tenant yang memilih G (`isPercetakanChoice`).
**Batas:** pembayaran order belum tersambung ke kasir; akurasi baca chat belum diuji dengan chat asli.
Detail: `adr/ADR-055-tenant-percetakan-order-wa.md`, `HANDOFF-PERCETAKAN.md`.

<!-- DOC-IMPACT: 2026-10-10 skin G (Percetakan). 2026-10-02 dokumen baru; katalog skin 0/A/B/C/D/E dengan persona, masalah, janji, batas. 2026-10-06 skin F (Racik Parfum). -->
