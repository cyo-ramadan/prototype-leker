# Handoff — Sesi Strategi Penjualan & Marketing webapp MAXI

Untuk: **sesi baru yang mulai dari nol** (Hana versi strategi). Instance tidak berbagi
memory, jadi semua yang perlu diketahui ada di sini.

Ditulis: 2026-10-01 · Oleh: Hana (sesi pengembangan) · Atas permintaan Bos Cyo
Dibaca dari: kode di `main`, database produksi (angka di bagian 2), dan dokumen repo.

> **Cara memperbarui dokumen ini.** Sesi pengembangan menambah fitur terus. Tiap fitur
> baru yang masuk, tambahkan satu baris di bagian 8 (Catatan perubahan) dan, kalau
> mengubah kelebihan/kelemahan, ubah bagian 4–5. Jangan menulis ulang sejarah — tambah
> di bawah, beri tanggal.

---

## 0. Tugas sesi ini (dari Bos Cyo)

Fokus **satu hal**: bagaimana webapp ini **terjual**.

- penentuan segment dan siapa yang dibidik duluan,
- posisi dan pesan jual (kenapa orang harus pilih ini),
- penyesuaian UI/UX supaya enak dijual dan enak dicoba,
- strategi cari trafik berbayar dan organik,
- sampai goal akhir: **penjualan** (calon pembeli → coba → bayar → bertahan).

Sesi ini **bukan** untuk ngoding atau memutuskan arsitektur. Kalau analisis strategi
menghasilkan kebutuhan fitur/UI, tulis sebagai permintaan untuk Bos Cyo, lalu dia bawa ke
sesi pengembangan.

Bos Cyo bukan orang koding: jelaskan logikanya, jangan nama file atau istilah teknis
kecuali dia tanya lebih dalam.

---

## 1. Produk dalam satu paragraf

MAXI adalah **POS + manajemen gerai + pembukuan otomatis** berbasis web (jalan di HP dan
laptop, tanpa instal), awalnya dibuat untuk jaringan gerai minuman **Leker**. Satu pemilik
bisa memantau banyak gerai dari satu tempat: kasir mencatat penjualan, stok dan harga pokok
(HPP) terhitung sendiri dari resep, dan semua transaksi otomatis menjadi **jurnal
akuntansi** — sehingga pemilik tidak bergantung penuh pada akuntan. Bagian yang
paling khas: **kontrol atas karyawan** (presensi foto + GPS, izin/permit yang harus di-ACC
pemilik, raport karyawan, gaji otomatis dari presensi). Arah jangka panjang: satu platform
dengan modul yang dipasang per pelanggan (bisnis F&B, olshop, dst), plus asisten AI yang
bisa diajak ngobrol dan mencatatkan transaksi.

Tujuan awal Bos Cyo membuat ini: **menghemat biaya operasional sendiri** (pembukuan,
pengawasan gerai), baru kemudian dijual ke pemilik usaha lain.

---

## 2. Bukti pemakaian nyata (dibaca dari database produksi, 2026-10-01)

| Hal | Angka |
|---|---|
| Gerai aktif | 14 |
| Akun karyawan/kasir aktif | 37 |
| "Tenant" (perusahaan pemilik) | 3 — jaringan Leker MAXI, PT Harilibur (Leker Mall Dinoyo), dan Galeh (olshop) |
| Total penjualan tercatat | 1.220, sejak 11 Agustus 2026 |
| Penjualan sejak 15 September | 1.186 (±97% dari total — pemakaian baru benar-benar jalan dua minggu terakhir) |
| Gerai yang menjual dalam 2 minggu terakhir | 8 dari 14 |
| Total pesanan lewat halaman pelanggan | 1.259, tetapi hanya **10** yang dibuat pelanggan yang login |
| Akun pelanggan terdaftar | 11 |
| Barang di master | 540 · Pembelian bahan tercatat: 176 |

Catatan jujur untuk dibaca dengan hati-hati:
- Sebagian data kemungkinan **uji coba** (tidak semua transaksi dipisah dari data tes).
- **Hana tidak tahu**: apakah ada pelanggan **berbayar dari luar** lingkaran Bos Cyo, harga
  yang diinginkan, biaya per gerai, atau target angka penjualan. Tanyakan ke Bos Cyo — jangan
  mengarang.
- Semua tenant yang ada sekarang masih dalam lingkaran Bos Cyo (jaringannya sendiri,
  mitra, dan satu usaha olshop). Artinya **produk terbukti jalan di operasi nyata, tetapi
  belum teruji dijual ke orang asing**.

---

## 3. Fitur — apa yang bisa dilakukan sekarang

Ditulis dari sudut pandang manfaat. Status: ✅ jalan di produksi · 🟡 ada tapi belum penuh ·
⬜ baru rencana.

### A. Kasir & operasional harian (POS)
- ✅ Pilih menu, draft pesanan, antrean pesanan dari pelanggan, jual langsung.
- ✅ **Laci kas**: buka/tutup laci, saldo awal otomatis melanjutkan saldo akhir sebelumnya, satu laci aktif per gerai. Kasir lain yang lupa tutup laci bisa diminta ditutup lewat permit.
- ✅ Beli bahan, pengeluaran operasional, pendapatan lain, arus kas, arus barang, aset.
- ✅ **Cara bayar dinamis**: tunai, transfer, dll. diatur per gerai (hanya tunai yang menggerakkan uang fisik laci). Pembayaran **dari Deposit/uang muka** ke supplier.
- ✅ **Hutang & piutang** beserta laporan beban.
- ✅ **Produksi**: manual atau "dadakan" (bahan terpakai saat dijual, tanpa produksi terpisah).
- ✅ **Dua resep untuk satu menu** (mis. larutan jasmine manis vs tawar): kasir bisa ganti resep aktif saat jualan; pilihan terakhir jadi pilihan berikutnya. *(Tahap berikutnya — resep diatur di level perusahaan agar tidak diisi per gerai — sedang dikerjakan.)*
- ✅ **Stok & HPP otomatis** (rata-rata bergerak), penyesuaian stok teraudit, stok negatif dibiarkan terlihat apa adanya.
- ✅ **Hapus/void transaksi lewat permit** (kasir minta, admin ACC; ada mode Auto Permit yang bisa dinyalakan pemilik).

### B. Kontrol karyawan — ini diferensiasi utama
- ✅ **Presensi** dengan foto langsung (live photo) + jam + GPS; masuk/pulang.
- ✅ **Radius GPS** (baru 1 Okt): presensi dinilai terhadap titik acuan gerai; di luar radius atau tanpa GPS **tetap bisa absen tapi kartunya merah**; karyawan hanya diberi tahu "melebihi N meter", bukan batasnya; bisa mengajukan perbaikan dengan alasan, pemilik ACC atau tolak.
- ✅ **Jadwal shift 7 hari**, deteksi telat, tutup presensi otomatis kalau lupa pulang, gaji otomatis nol kalau absen di luar jadwal (bisa dimatikan).
- ✅ **Gaji dari presensi**: per jam atau per sesi, riwayat gaji per orang, otomatis jadi beban gaji di pembukuan.
- ✅ **Koreksi jam presensi** lewat permit (mis. web error), hanya selagi sesi berjalan.
- ✅ **Raport karyawan**: fakta (penjualan, void, presensi, telat, tidak tutup presensi, GPS merah). 🟡 **Skor/grade belum ada** — bobot KPI belum ditetapkan, sengaja tidak dikarang.
- ✅ **Laporan Permit** (semua jenis permit, filter per kategori/karyawan) dan **Laporan Presensi** (rangkuman per karyawan untuk penilaian KPI manual).
- ✅ Master Karyawan terpisah dari akun login, akun cadangan lintas gerai, aturan satu orang tidak boleh login di dua akun sekaligus.
- ✅ Portal Staf: manual book, pengumuman, daily task, riwayat gaji.
- ✅ Halaman **diagnostik perangkat** (untuk karyawan yang tidak bisa login karena browser memblokir cookie/penyimpanan).

### C. Pemilik & admin — melihat semua gerai
- ✅ Hirarki Owner → Perusahaan (Entity) → Gerai; ganti gerai cepat; detail laci dengan tombol salin.
- ✅ Laporan **untung rugi** (net profit) harian, stok + HPP, riwayat transaksi dengan filter.
- ✅ Master barang, kategori, supplier, pelanggan, kasir, karyawan.

### D. Pembukuan otomatis (Akuntansi)
- ✅ Setiap penjualan/pembelian/biaya **otomatis menjadi jurnal**; bagan akun standar seragam di semua gerai.
- ✅ Buku besar, rugi laba, neraca; jurnal manual yang wajib seimbang; **jurnal terposting tidak bisa diedit** (koreksi lewat pembalik) — rapi untuk audit.
- ✅ Jurnal beban rutin dan pembagian beban per periode.
- ✅ Uang disimpan sebagai bilangan bulat berskala (tidak pernah desimal mengambang) → tidak ada selisih pembulatan.
- ✅ Tiga "edisi" per gerai: LITE (POS saja), FLEXIBLE, ACCOUNTING (penuh).

### E. Sisi pelanggan akhir
- ✅ Halaman pesan sendiri per gerai (jalan tanpa login, bisa checkout sebagai tamu), status pesanan, pesan ulang.
- ✅ Daftar jadi pelanggan (disetujui admin, ada sambungan WhatsApp), saldo poin, umpan balik pribadi ke pemilik.
- ✅ Voucher dan roda putar berhadiah (Roda Puter).
- ✅ **Berbagi pelanggan antar gerai** (satu identitas pelanggan di beberapa gerai, hanya kalau pemilik mengizinkan).
- 🟡 **Poin**: saldo tampil, tetapi rumus dapat/tukar poin belum diaktifkan.
- 🟡 Modul Game generasi baru baru fondasi.

### F. Asisten AI (Caca/Una)
- 🟡 Panel chat ala WhatsApp di dalam aplikasi: baca foto lembar rekap, bantu membuat barang/resep/jurnal, mencatat transaksi admin lewat jalur resmi. Dirancang sebagai "pembukuan tanpa akuntan": pemilik cukup bilang "Pak Eddy transfer tambah modal, catat ya".
- ⬜ Saluran **WhatsApp sungguhan** belum ada (sekarang hanya panel di web).
- Catatan: akurasi membaca foto rekap sungguhan belum diukur serius.

### G. Platform
- ✅ Beberapa perusahaan dalam satu sistem dengan data terpisah; modul dipasang-lepas per perusahaan (Game, Warehouse, Akuntansi).
- ⬜ **Anjungan tap kartu** (absen tap kartu dengan suara): baru desain, belum ada perangkat.

---

## 4. Kelebihan (yang bisa dijual)

1. **Sudah dipakai harian di 14 gerai/37 kasir** — bukan prototipe di atas kertas; masalah lapangan sungguhan (login HP murah, kasir lupa tutup laci, dll.) sudah ditemui dan diperbaiki.
2. **Pembukuan ikut otomatis**: penjualan → jurnal → laporan. POS biasa berhenti di struk; ini lanjut sampai neraca. Pesan jual kuat untuk pemilik yang pusing dengan akuntan/Excel.
3. **Kontrol karyawan yang jarang ada di POS murah**: foto+GPS presensi, permit yang harus di-ACC pemilik (hapus transaksi, uang kas, tutup laci, koreksi presensi), raport. Ini jawaban atas ketakutan nomor satu pemilik gerai: *"karyawan curang saat saya tidak ada."*
4. **Multi-gerai dari satu layar** dengan data tiap gerai terpisah rapi — cocok untuk pemilik yang sudah punya 3+ gerai/franchise.
5. **HPP dan stok dari resep** — penting untuk F&B (minuman/makanan) yang margin-nya ditentukan bahan; dua resep per menu menjawab kebiasaan lapangan.
6. **Tanpa instal, jalan di HP**; biaya infrastruktur sangat rendah (Cloudflare) sehingga margin harga bisa agresif.
7. **Integritas data diprioritaskan** (uang tanpa desimal mengambang, jurnal tak bisa diubah, ±1.200 tes otomatis) — nilai untuk pembeli yang pernah dirugikan data "hilang/selisih".
8. **Arah asisten AI** untuk pasar yang gaptek dan akrab dengan WhatsApp — pembeda besar kalau jadi.
9. **Desain "memanjakan pemilik"**: laporan sudah disusun supaya pemilik cepat menilai (permit, presensi, GPS, raport).

## 5. Kelemahan & risiko (jujur)

**Pasar & bukti**
1. **Belum terbukti dijual ke orang asing.** Semua pengguna dalam lingkaran Bos Cyo. Belum ada harga, paket, uji bayar, atau testimoni dari luar.
2. **Tidak ada sistem langganan/penagihan** (paket, invoice, trial, upgrade) di aplikasi; pendaftaran perusahaan dan gerai baru masih dikerjakan tim (lewat prosedur onboarding), **bukan daftar sendiri**. Ini penghalang langsung bagi iklan berbayar — calon pembeli tidak bisa "coba sekarang".
3. **Tidak ada halaman pemasaran/landing**: alamat utama langsung melempar ke halaman kiosk pelanggan dengan judul "MAXI Prototype Leker". Nama produk dan merek untuk pasar belum final.
4. **Hampir semua fitur dibangun dari kebutuhan Leker (minuman)** — pasar lain (retail, jasa, olshop) belum teruji walau arsitekturnya modular.

**Produk**
5. **Sisi pelanggan akhir lemah**: 1.259 pesanan tapi hanya 10 dari pelanggan login, 11 akun pelanggan, poin belum aktif. Jangan jual "aplikasi pelanggan" sebagai keunggulan utama dulu.
6. **Tidak ada pembayaran online** (QRIS/e-wallet terintegrasi). "Cara bayar" hanya pencatatan metode; uang tidak diproses sistem.
7. **Tidak ada mode offline** dan bukan aplikasi native/PWA: kalau internet gerai mati, kasir berhenti. Ini keberatan klasik pembeli POS di F&B kecil.
8. **Banyak fitur, banyak layar admin**: kuat untuk pemilik serius, tetapi **kurva belajar** untuk pemilik kecil yang gaptek. Belum ada riset UX atau onboarding terpandu; tampilan admin tumbuh per permintaan fitur.
9. **Skor KPI karyawan belum ada** (hanya fakta) — padahal ini bahan jual "memanjakan owner"; butuh keputusan bobot dari Bos Cyo.
10. **Beberapa aturan akuntansi/stok masih terbuka** (kebijakan stok negatif, pecahan satuan, jenis retur, aturan stock opname) — risiko kalau dijual ke bisnis yang butuh stok sangat ketat.
11. **Asisten AI belum sampai WhatsApp** dan akurasinya belum diukur; jangan dijanjikan sebagai fitur jadi.
12. **Tampilan beberapa fitur terbaru belum diuji di perangkat nyata** (pengujian otomatis kuat, tetapi pengamatan layar HP sungguhan terbatas). Satu kasus nyata: satu karyawan tidak bisa login karena browser memblokir penyimpanan — kasus seperti ini akan lebih sering muncul di pengguna asing dengan HP beragam.

**Teknis yang berdampak ke bisnis**
13. **Satu database bersama dengan jatah baca harian** (paket gratis Cloudflare, 5 juta baris/hari). Aman untuk puluhan gerai karena desain sudah hemat, tetapi **pertumbuhan cepat butuh naik paket** dan perhitungan biaya per pelanggan. Isolasi data antar perusahaan bergantung pada aturan aplikasi, bukan database terpisah — bisa jadi pertanyaan pembeli besar.
14. **Ketergantungan pada satu pemilik pengetahuan** (Bos Cyo + agen AI). Dokumentasi sangat lengkap, tetapi belum ada tim dukungan pelanggan atau SLA.

---

## 6. Bahan mentah untuk strategi (hipotesis, bukan fakta — uji di sesi ini)

- **Pembeli paling cocok (hipotesis)**: pemilik **2–10 gerai F&B/retail** yang tidak bisa selalu hadir dan khawatir karyawan/pembukuan. Pemilik 1 gerai yang tidak punya karyawan kurang butuh fitur kontrol; jaringan besar butuh jaminan yang belum ada.
- **Pesan jual yang paling sejalan dengan kekuatan produk**: bukan "POS lengkap" (banyak pesaing murah), melainkan **"gerai jalan, pembukuan jalan, karyawan terpantau — tanpa Anda hadir"**.
- **Bukti sosial yang bisa dibuat sendiri**: 14 gerai Leker yang memakainya sehari-hari — kumpulkan cerita/angka (waktu tutup buku, selisih kas, kasus permit yang menyelamatkan) sebagai studi kasus.
- **Hal yang wajib ada sebelum iklan berbayar**: halaman landing, nama/merek final, paket + harga, jalur coba (demo atau akun uji), cara pendaftaran/pembayaran. Tanpa ini trafik berbayar akan terbuang.
- **Pertanyaan untuk Bos Cyo** (jawabannya mengubah seluruh strategi): berapa harga/gerai/bulan yang dibayangkan? Mau jual sebagai langganan atau sekali beli? Mau layani sendiri (onboarding manual) atau self-service? Siapa kompetitor yang pernah dilihat pelanggan Leker? Berapa gerai/bulan yang sanggup dilayani tim sekarang? Berapa budget iklan?

---

## 7. Skill yang cocok untuk sesi ini

Dicek 2026-10-01 di akun Bos Cyo: **belum ada skill khusus marketing/SEO/iklan** yang aktif
maupun yang bisa disarankan dari katalog. Yang sudah aktif dan berguna:

| Skill | Dipakai untuk |
|---|---|
| `deep-research` | riset pasar, kompetitor POS/akuntansi UMKM, harga pasar, tren — menghasilkan laporan bersumber |
| `chrome-browser` | membuka situs kompetitor, melihat halaman harga & landing mereka, perpustakaan iklan, hasil pencarian — di Chrome Bos Cyo sendiri |
| `xlsx` | model harga, hitungan corong (trafik → coba → bayar), anggaran iklan, proyeksi per gerai |
| `pptx` | materi presentasi/pitch ke calon pelanggan atau mitra |
| `skill-creator` | **membuat skill sendiri** "strategi-penjualan-MAXI" berisi konteks produk (dokumen ini), gaya bahasa merek, persona pembeli, dan SOP menulis iklan/landing — supaya sesi mana pun langsung nyambung |

Saran urutan: mulai dengan `deep-research` (kompetitor + harga), lalu `xlsx` (model
harga & corong), baru jadikan hasilnya skill sendiri lewat `skill-creator`.

---

## 8. Catatan perubahan fitur (tambahkan di bawah, terbaru di akhir)

**Ini satu-satunya tempat sesi strategi membaca perkembangan produk.** Sesi strategi tidak
membaca kode atau dokumen lain untuk tahu apa yang berubah — jadi kalau tidak ditulis di sini,
dianggap belum ada.

Aturan untuk **semua sesi** (pengembangan, Caca/Una, UI/UX, agen implementer):
- Tambah **satu baris per perubahan yang sudah live di `main`** (bukan yang baru di branch).
- Kolom **Status jual** pakai salah satu: `JUAL` (boleh didemokan/dijanjikan), `SEMBUNYI`
  (jadi tapi disembunyikan untuk tenant baru), `UJI` (live tapi belum layak dijanjikan),
  `INTERNAL` (tidak terlihat pembeli).
- Tulis dengan bahasa pemilik usaha, satu kalimat. Tanpa nama file.
- Kalau perubahan mengubah kelebihan/kelemahan, ubah juga §4–5 (atau tulis "§5 perlu
  ditinjau" di kolom Dampak supaya sesi strategi tahu).
- Jangan menghapus baris lama.

| Tanggal | Sesi | Perubahan | Status jual | Dampak ke penjualan |
|---|---|---|---|---|
| 2026-10-01 | pengembangan | Radius GPS presensi + permit perbaikan + Laporan Presensi + Laporan Permit + koreksi jam presensi + dua resep per menu | JUAL | Memperkuat pesan "karyawan terpantau"; bahan KPI manual makin lengkap |
| 2026-10-01 | pengembangan | Halaman diagnostik perangkat | INTERNAL | Mengurangi beban dukungan "tidak bisa login" |
| 2026-10-01 | strategi | Landing page penjualan di `/produk/` (hanya fitur Paket Kontrol; tombol "Minta demo lewat WhatsApp") | INTERNAL | Belum dibagikan: nomor WhatsApp, nama merek, dan izin memakai angka Leker masih menunggu Bos Cyo |
| 2026-10-01 | pengembangan | Resep produksi diisi sekali di tingkat perusahaan lalu diterapkan ke banyak gerai sekaligus (termasuk menu dengan dua resep) | UJI | Mengurangi kerja pasang resep per gerai bagi pemilik banyak gerai; belum dicoba di gerai nyata |
| 2026-10-01 | pengembangan | Grafik perbandingan gerai di laporan perusahaan: untung/rugi (hijau/merah), omset, untung kotor, beban, HPP, margin, urut dari terbesar | JUAL | Pemilik langsung melihat gerai mana yang untung dan mana yang rugi dalam satu layar; §5 perlu ditinjau: beban yang hanya dibuat di Akuntansi belum ikut angka laporan ini |
| 2026-10-02 | pengembangan | Laporan Untung Rugi gerai yang memakai Akuntansi kini dibaca dari pembukuan (beban yang dicatat di Akuntansi ikut mengurang), beban dirinci per nama akun, ada peringatan bila ada transaksi belum masuk pembukuan; grafik perbandingan gerai batangnya satu arah, untung/rugi dibedakan warna | JUAL | Satu angka untung-rugi yang sama di laporan pemilik dan di pembukuan; §5 perlu ditinjau: HPP DERMO dan GENENGAN masih tidak wajar (data biaya bahan), jangan didemokan dengan dua gerai itu |
| 2026-10-02 | pengembangan | Hitung Ulang HPP: pemilik membetulkan harga bahan yang salah tercatat (pratinjau dulu, lalu terapkan); hanya HPP yang berubah, laporan dan pembukuan ikut terkoreksi | JUAL | Menjawab keberatan "angka HPP berantakan karena salah input" tanpa minta bantuan akuntan |
| 2026-10-02 | pengembangan | Stok Gerai di Admin Entity: tombol pilih gerai, daftar bahan dengan satuan di samping nama (satu gerai sekali lihat); tabel semua gerai (satu kolom per gerai) lewat Export Excel atau PDF |
| 2026-10-02 | pengembangan | Sinkron Akuntansi otomatis: transaksi yang belum masuk pembukuan dimasukkan sendiri saat laporan untung rugi atau panel Akuntansi dibuka; tidak perlu tekan tombol sinkron |
| 2026-10-02 | pengembangan | Barang baru otomatis masuk Jenis Barang yang tertaut akun Persediaan/HPP dengan HPP awal = Harga Beli (0 bila kosong); transaksi lama yang jenis barangnya kosong ikut terpulihkan dan masuk pembukuan |
| 2026-10-02 | pengembangan | Hitung Ulang HPP kini juga bisa membetulkan harga rata-rata bahan baku (mis. Air Mineral, Gula) yang salah catat pembelian, tanpa menunggu ada penjualan terdampak |
| 2026-10-02 | pengembangan | Laporan Gerai di Admin Entity: klik satu gerai, tampil per tanggal Omset, HPP, SO+, SO−, Gross Profit, Beban Lapak, Gaji, Beban Lainnya, Net Profit |
| 2026-10-03 | pengembangan | Setoran kasir saat tutup laci kini selalu menjadi Piutang Karyawan di pembukuan, termasuk untuk akun kasir yang belum ditautkan ke karyawan; jurnal yang gagal dicoba ulang otomatis |
| 2026-10-03 | pengembangan | Tutup laci: kasir mengisi "Titip laci" (uang yang ditinggal untuk shift berikutnya), setoran dihitung otomatis dari selisihnya |
| 2026-10-03 | pengembangan | Status Laci di Admin Entity: gerai mana yang lacinya sedang OPEN/CLOSE, sejak jam berapa, dan kasir yang membukanya |
| 2026-10-03 | pengembangan | Daftar Gerai di Admin Entity kini menampilkan OPEN/CLOSE laci (jam dan kasir pembuka) di setiap kartu gerai, menggantikan label "Aktif" |
| 2026-10-02 | UI/UX | Semua tenant: tulisan "Prototype"/"Leker" dan catatan developer hilang dari layar; merek satu tempat ("MAXI" sementara); fitur setengah jadi ("segera hadir") disembunyikan; halaman pelanggan bahasa F&B umum | JUAL | Kesan pertama tidak lagi "prototipe"; siap didemokan ke pemilik F&B mana pun |
| 2026-10-02 | UI/UX | Pilihan tampilan per tenant 0/A/B/C (Tenang, Papan Siaga, Kabar Gerai) di Owner Console; semua tenant lama tetap 0, tenant Lab Tampilan (gerai LAB01) dipakai uji | UJI | Bahan memilih tampilan jualan; belum ada Ringkasan Pemilik |
| 2026-10-02 | UI/UX | Kartu daftar ringkas (nama utuh, keterangan satu baris, status berwarna) di semua tenant; tab "Laporan" kosong dicabut | JUAL | Layar admin tidak lagi terlihat rusak di HP |
| 2026-10-02 | UI/UX | Skin A/B/C: tombol admin dikelompokkan (Workspace Gerai 24 → 7, Panel Pemilik 10 → 6) dengan sub-menu | UJI | Calon pembeli tidak kaget melihat tombol terlalu banyak |
| 2026-10-02 | UI/UX | Landing page `/produk/` dirombak: satu janji, satu gambar HP, "Sehari bersama kami", F&B umum | INTERNAL | Masih menunggu nomor WhatsApp, nama merek, dan izin angka bukti |
| 2026-10-02 | Una (susulan) | Asisten chat Una di Panel Pemilik dan Workspace Gerai (ala WhatsApp, percakapan tidak hilang saat pindah halaman, ingat 5 obrolan terakhir): baca foto lembar rekap; buat barang, resep, jurnal; catat Bea Gaji/Lapak/Lainnya, bayar hutang, uang muka lewat bank/Rekening Bersama (tidak menyentuh kas laci); atur cara bayar dan pindah saldo akun; jawab pertanyaan apa pun dari data semua layar, termasuk lintas gerai — semua yang menyimpan lewat kartu "dicek dulu" + tombol Ya | UJI | Pembeda "pembukuan cukup lewat chat"; akurasi baca foto dan jawaban belum diukur dengan pemakai luar — jangan dijanjikan sebagai fitur jadi |
| 2026-10-02 | Una | Una pendamping pemilik baru: begitu dibuka, Una menyapa duluan dengan daftar kesiapan gerai (menu, akun kasir, jualan pertama, resep, karyawan, titik lokasi) dan tombol kerjaan sekali ketuk; isi puluhan menu sekaligus dengan menempel daftar atau memotret papan menu (satu tabel, satu "Ya", hitungan berjalan); "batalkan yang barusan"; kamus istilah (HPP, jurnal, Rekening Bersama, dst.) tanpa jawaban karangan; tombol membukakan layar yang tidak lewat chat (akun kasir) | UJI | Menjawab ketakutan "nggak bisa makenya"/"isi barang ribet" — bukti: semua gerai yang jalan diisi tim, gerai yang mulai sendiri macet di nol barang (`UNA-PENDAMPING.md`). **§10 perlu ditinjau**: Bos Cyo menjadikan chat sebagai USP, sementara §10 masih menyembunyikan Una untuk tenant baru |
| 2026-10-03 | UI/UX | Skin D "Mode Warung" untuk kelontong/UMKM kecil: kasir satu layar (cari, paling sering, kembalian besar) + layar Pemilik "Hari ini" (untung bersih hari ini, yang menunggu keputusan, laci per gerai). Konsep & USP: "Untungnya kelihatan. Uangnya aman." | UJI | Membuka segmen kelontong/UMKM; lihat DESAIN-SKIN-D-WARUNG.md untuk USP & fase berikut |
| 2026-10-02 | Una | Membuat barang/resep lewat Una tidak lagi bertanya detail: cukup nama dan harga, sisanya diisi yang dasar (tertulis di kartu). Sesudah jadi, Una ngobrol santai menanyakan "dibikin sendiri atau beli jadi?" lalu menggiring ke resep; yang menyangkut uang tetap ditanya dengan ajakan halus | UJI | Memperkuat kesan "sesimpel ini"; arah dari Bos Cyo langsung |
| 2026-10-03 | UI/UX | Skin E "Jaga Sendiri" untuk warung TANPA karyawan (pemilik = kasir = admin): tanpa absen, tanpa minta izin, Buka/Tutup warung satu ketukan (uang awal otomatis dari sisa kemarin, saat tutup langsung tahu pas/lebih/kurang), tab Untung (hari ini, kemarin, 7 hari, paling laku) dari login kasir. Warna pastel lembut, teks tetap kontras tinggi. Janji: "Jualan seperti biasa. Malamnya tahu untung beneran — tanpa nyatet." Katalog persona & masalah semua skin: DESAIN-SKIN-KATALOG.md | UJI | Segmen warung satu orang; jangan dijual ke tenant yang punya karyawan (pengawasan absen/izin mati). "Ambil untuk dapur", tab Belanja, tanda "di bawah modal" BELUM ada |
| 2026-10-03 | Una | Una ingat 10 obrolan terakhir (dulu 5) dan pertanyaan lanjutan ("yang tadi kenapa?") tidak lagi salah dijawab dengan penjelasan istilah; Una bisa mengoreksi HPP bahan yang tercatat salah — pratinjau dulu, lalu "Ya" — baik menghitung ulang HPP penjualan sejak tanggal yang salah (tanggal dicari Una kalau tidak disebut) maupun hanya mengganti harga ke depan | UJI | Menjawab keberatan "angka HPP berantakan karena salah input" lewat chat tanpa perlu akuntan; jalurnya sama dengan fitur Hitung Ulang HPP yang sudah JUAL |
| 2026-10-03 | Una | Una bisa mengubah barang yang sudah ada lewat chat: harga jual, harga beli, nama, kategori — satu atau banyak sekaligus ("harga es teh blackcurant jadi 7rb"); salah ketik nama dikenali dan disebutkan di kartu "dicek dulu"; barang tidak dihapus dan foto/resep tidak tersentuh | UJI | Melengkapi "bisa bikin barang": pemilik kini bisa merawat daftar harga lewat chat tanpa membuka layar Data Barang |
| 2026-10-03 | Una | Una menulis rencana kerja untuk perintah berurutan ("cek harga yang aneh lalu ganti ke harga normal"): 1. … ✓ / 2. … / 3. …, dikerjakan satu per satu, berhenti untuk bertanya atau minta "Ya", dan bisa dilanjutkan dari langkah yang terputus; cek harga/HPP/stok barang tertentu langsung dijawab tabel; tulisan "mengetik…" seperti WhatsApp | UJI | Terasa seperti asisten yang benar-benar bekerja, bukan sekadar menjawab — bahan demo "pembukuan lewat chat" |
| 2026-10-03 | UI/UX | Skin D untuk warung/UMKM yang punya kasir tapi admin dikerjakan pemilik sendiri: Workspace Gerai dibuka di halaman "Hari ini" (untung bersih hari ini, yang menunggu keputusan pemilik dengan tombol Putuskan, siapa pegang laci + uang yang seharusnya ada), menu cuma 6 tombol (Hari ini · Persetujuan · Penjualan · Barang · Tim · Lainnya), "Lainnya" berupa daftar berkelompok berketerangan, istilah teknis diganti (Setujui/Tolak, Pengajuan kasir, Setujui otomatis) | UJI | Demo ke pemilik warung: buka HP → langsung lihat untung & yang perlu diputuskan, tanpa 29 menu. Detail: DESAIN-SKIN-D-WARUNG.md §4c |
| 2026-10-03 | UI/UX | Karyawan (Owner, Entity Admin, Admin Gerai, Kasir) kini punya halaman login sendiri, `/login`, yang otomatis mengenali pangkat dan membuka ruang kerja yang sesuai; login di halaman pelanggan khusus pelanggan sehingga pembeli tidak melihat pilihan karyawan | JUAL | Menjaga halaman pembeli bersih dan membuat pintu masuk tim jelas; §5 tidak perlu ditinjau |
| 2026-10-03 | Una | Una bisa mencari transaksi yang belum masuk pembukuan (beserta penyebabnya), mengaudit HPP yang janggal dengan usulan harga berbukti dan berurutan, menyinkron ke Akuntansi, dan melengkapi aturan jurnal yang kosong -- semuanya lewat draft cek-dulu dan jalur yang sama dengan akuntan manusia | UJI | Memperkuat janji "laporan untung rugi selalu dari pembukuan"; belum dijanjikan sebelum Una teruji menjalankan urutannya sendiri |
| 2026-10-03 | Una | Una bisa membetulkan tipe barang (bahan baku / setengah jadi / barang jadi), jenis barang, dan satuan untuk puluhan barang sekaligus lewat draft cek-dulu, dengan penjelasan terang bahwa ganti satuan hanya mengganti label (stok/HPP/resep tidak berubah) | UJI | Merapikan data master yang salah isi tanpa pemilik membuka barang satu per satu; belum dijanjikan sebelum Una teruji menjalankannya sendiri |
| 2026-10-03 | Una | Una bisa mengoreksi HPP puluhan bahan sekaligus (satu draft, satu "Ya" per gerai, urutan bahan baku lalu olahan dijaga) dan menghitung ulang HPP penjualan sejak tanggal yang disebut, dengan jurnal koreksi otomatis | UJI | Membereskan HPP anomali tanpa satu-satu per bahan; belum dijanjikan sebelum Una teruji menjalankannya sendiri |
| 2026-10-03 | Panel Entity | Tab Stok gerai punya pilihan **Lihat HPP**: HPP rata-rata tiap bahan di gerai terpilih dibanding acuan semua gerai, dengan penanda "HPP nol / Terlalu tinggi / Terlalu rendah"; Export Excel/PDF ikut tampilan yang dipilih | JUAL | Pemilik multi-gerai langsung melihat gerai mana yang HPP-nya janggal tanpa membuka satu-satu |
| 2026-10-03 | Una | Una sanggup perintah panjang: daftar koreksi HPP puluhan bahan langsung jadi satu draft, pesan sampai 8.000 huruf (kelebihan ditolak dengan jelas, tidak lagi terpotong diam-diam), dan rencana bertahap tidak lagi memotong daftar | UJI | Menghapus keluhan "Una tidak bisa disuruh yang panjang"; belum dijanjikan sebelum dicoba di gerai sungguhan |
| 2026-10-04 | Kasir | Isian angka Beli Bahan/Penjualan/Operasional: titik tidak bisa diketik, pemisah ribuan muncul otomatis, koma untuk pecahan — mencegah "1.500" terbaca 1,5 atau qty "1.000" gram terbaca 1 | JUAL | Data HPP tidak rusak karena salah ketik titik/koma; kasir baru langsung benar |
| 2026-10-04 | Kasir / Una | Rentang harga beli wajar per barang: kasir melihat "wajar Rp…–Rp…" saat Beli Bahan, pembelian di luar rentang ditolak dengan pesan jelas; Una bisa mengatur rentang banyak barang sekaligus (harga benar ±25%) | JUAL | Salah ketik qty/harga tertahan sebelum merusak HPP dan laporan untung rugi |
| 2026-10-04 | Admin Gerai | Isian "Harga beli wajar" (batas bawah/atas, tombol ±25% dari HPP) di Master Barang — setting manual yang sama dengan yang diisi Una | JUAL | Pemilik bisa mengatur/mengecek pengaman salah ketik tanpa lewat chat |
| 2026-10-04 | Una | "Una, sambungkan jurnal" dari panel satu gerai: Una mencari transaksi yang mandek karena aturan jurnal kosong, menyalin aturan dari gerai lain yang sudah beres, lalu langsung mengirim ulang transaksinya ke pembukuan (tidak lagi menyuruh pemilik mengisi setelan sendiri) | JUAL | Laporan untung rugi lengkap tanpa pemilik paham Setting Akuntansi |
| 2026-10-04 | Portal Staf / Admin Gerai | Setoran CS: CS kirim foto bukti transfer di Riwayat Setoran, piutang CS baru berkurang setelah Admin klik ACC di tab baru "Setoran CS" (antrean + foto, sisa piutang per CS, riwayat); tidak ada ACC otomatis | JUAL | Uang setoran laci terlacak sampai rekening, tanpa catatan manual |
| 2026-10-04 | Kasir / Portal Staf / Admin Gerai | Tutup laci memakai bahasa yang jelas: "Uang di laci sekarang" + "Taruh uang laci" → "Setoran" langsung terhitung dan tercatat sebagai piutang setoran (masuk pembukuan saat itu juga); Portal Staf punya tab "Setor Uang" sendiri (foto bukti wajib) dan "Riwayat Setoran" yang hanya berisi data; Riwayat Gaji menampilkan jam datang–pulang | JUAL | CS paham berapa yang harus dibawa/disetor tanpa istilah akuntansi; uang setoran terlacak dari laci sampai rekening |
| *(semua sesi menambah baris di sini)* | | | | |

---

## 9. Rujukan di repo (untuk yang ingin menggali lebih dalam)

`README.md` (gambaran fitur & rute), `MODULE_CATALOG.md` (status per modul),
`KNOWN_ISSUES.md` (masalah terbuka), `adr/ADR-040…` (arah platform modul/tenant),
`adr/ADR-044…`/`ADR-045…` + `HANDOFF-CACA.md` + `HANDOFF-HANA-PEMBUKUAN.md` (asisten AI),
`contracts/attendance-gps-v1.md` (presensi GPS), `HANDOFF-anjungan-tap-kartu-v1.md`
(absen tap kartu), `POS_MODULE_INDEPENDENCE.md` (arah POS berdiri sendiri tanpa akuntansi —
penting kalau mau menjual edisi POS-saja).

## 10. Keputusan sementara sesi strategi (2026-10-01)

Hasil diskusi dengan Bos Cyo; yang bertanda *(menunggu)* belum diputuskan.

- **Jual sekarang, jangan tunggu semua fitur.** Fitur yang belum jadi disembunyikan per
  Tenant, bukan dihapus.
- **Posisi**: bukan "aplikasi kasir", melainkan *sistem kontrol gerai* — "Gerai jalan, kas
  jujur, karyawan terpantau — tanpa Anda harus datang."
- **Segmen pertama**: pemilik 3–10 gerai minuman/booth; pengali: pemilik kemitraan/franchise.
  *Koreksi Bos Cyo 2026-10-01 (lewat sesi UI/UX): "targetnya fnb ya, bukan cuma leker" — segmen = gerai **F&B** umum (kopi, makanan, minuman, bakery, warung), Leker hanya bukti pemakaian.*
- **Paket pertama — Paket Kontrol Gerai**: kasir+laci, presensi foto+GPS+radius, permit ACC
  pemilik, stok+HPP dari resep, untung-rugi sederhana, gaji dari presensi, laporan
  presensi/permit, multi-gerai. Pembukuan lengkap = paket naik kelas.
- **Disembunyikan untuk tenant baru**: asisten AI Caca/Una, Game/Roda Puter, poin pelanggan,
  pendaftaran akun pelanggan, menu akuntansi lengkap.
- **Harga hipotesis** *(menunggu)*: Rp149rb/gerai/bulan (Kontrol), Rp249rb (+Pembukuan).
  Pembanding: Majoo Rp249rb–999rb, Moka Rp299rb–799rb, Pawoon Rp299rb per outlet/bulan;
  aplikasi absensi terpisah Rp5rb–12rb/karyawan/bulan.
- **Nama/domain** *(menunggu)*: kandidat OwnerTenang (pilihan Hana), PantauGerai, GeraiJujur;
  ketersediaan domain belum dicek.
- **Wajib sebelum demo ke orang luar**: lihat `HANDOFF-UIUX-SIAP-JUAL.md` T1–T5 (bersih kesan
  prototype, saklar paket, Ringkasan Pemilik, pemilik tahu permit menunggu, tenant demo).
- **Urutan kanal**: jual langsung lewat jaringan Bos Cyo → pemilik kemitraan → konten
  TikTok/Reels (tema "pemilik tenang walau tidak di gerai") → Google Search setelah halaman
  depan siap → iklan Meta paling akhir.
- **Landing page** ada di `/produk/` pada alamat aplikasi sekarang. Yang wajib diisi sebelum
  dibagikan: nomor WhatsApp, nama merek (satu blok pengaturan di bagian bawah halaman), dan
  persetujuan Bos Cyo memakai angka Leker (14 gerai, 37 akun, 1.200+ penjualan, 540 barang).
  Halaman hanya boleh menjanjikan fitur berstatus `JUAL`; tes otomatis menolak kata seperti
  AI/Caca, game, poin, offline, jurnal, prototype. **Pindah ke domain sendiri**: begitu domain
  dibeli, pasang sebagai Custom Domain di Cloudflare dan arahkan halaman utama domain itu ke
  landing page — keputusan teknisnya (Worker statis terpisah vs. aturan per alamat di Worker
  utama) diambil sesi pengembangan saat itu, tanpa mengubah isi halaman.
- **Target**: 3 pemilik membayar di hari ke-45; 10 gerai berbayar dari luar lingkaran Bos Cyo
  di hari ke-90.

<!-- DOC-IMPACT: 2026-10-01 dokumen baru; 2026-10-01 §8 diberi format wajib lintas sesi dan §10 keputusan sementara ditambahkan; 2026-10-02 §8 baris susulan Una + Una pendamping pemilik baru; 2026-10-03 §8 baris halaman login karyawan. Tidak mengubah perilaku sistem. -->
