# Una sebagai pendamping pengguna baru — riset ketakutan & rancangan

Ditulis: 2026-10-02 · Oleh: Hana (sesi Una) · Atas permintaan Bos Cyo:

> "usp kita kan berbasis chat, jadi user merasa bener2 didampingi waktu pertama kali pake
> ... pahami banget kebutuhan user yang ketakutan gabisa make suatu aplikasi. hapus ketakutan
> itu dengan fitur chat yang bisa mengerjakan ketakutan itu ... misal user takut ngisi2 jenis
> barang yang panjang, maka solusinya adalah una yang bisa menawarkan segala jenis pekerjaan
> ... oh sesimple ini ya."

Catatan arah: `HANDOFF-STRATEGI-PENJUALAN.md` §10 (2026-10-01) masih menulis asisten AI
*disembunyikan untuk tenant baru*. Permintaan di atas membalik arah itu — chat jadi pembeda
utama. §10 perlu ditinjau sesi strategi; baris di §8 sudah menandainya.

---

## 1. Bukti dari aplikasi kita sendiri (database produksi, dibaca 2026-10-02)

| Gerai | Asal isinya | Barang | Kasir | Penjualan |
|---|---|---|---|---|
| 9 gerai Leker yang jalan (Pendem, Beji, Dermo, …) | **disalin tim** dari gerai Pendem lewat migration | 42–121 | ada | ada |
| Galeh – Ikan dari Petani (IKAN01), dibuat 22 Agt | harus mulai sendiri | **0** | 0 | 0 |
| MAXI Leker Dinoyo (M002), dibuat 9 Agt | harus mulai sendiri | **0** | 0 | 0 |
| Gerai Contoh (LAB01), dibuat 1 Okt | harus mulai sendiri | **0** | 0 | 0 |
| Ngijo | disalin tim | 44 | **0** | 0 |

Kesimpulannya keras: **belum pernah ada satu gerai pun yang berhasil mengisi dirinya sendiri.**
Semua gerai yang jalan diisi tim. Galeh sudah 41 hari dan satuan barangnya pun belum pernah
terbentuk — artinya layar Data Barang tidak pernah dibuka sama sekali. Ini bukan soal fitur
kurang; ini **layar kosong yang menakutkan**.

Yang harus dilewati pemilik baru sebelum transaksi pertama:
1. Mengisi daftar menu satu per satu (form: nama, kategori, harga jual, harga beli, satuan,
   tipe, jenis barang, foto, poin, pelacakan stok). Gerai Leker rata-rata 42 barang.
2. Bahan baku + resep (supaya HPP dan untung-rugi benar) — 22–99 resep per gerai.
3. Akun kasir (username + PIN), karyawan, jadwal, titik lokasi presensi.
4. Paham istilah: HPP, jurnal, akun, Jenis Barang vs Tipe Barang, Bea, Deposit, Rekening Bersama.
5. Workspace Gerai punya 24 tombol menu (skin 0).

## 2. Bukti dari luar

- Hambatan UMKM yang paling sering disebut: merasa **gaptek**, **takut ribet** (input daftar
  dan terlalu banyak tombol), dan aplikasi yang setelah beberapa minggu terasa rumit sehingga
  dasbornya tidak dibuka lagi ([Jubelio](https://jubelio.com/aplikasi-kasir-untuk-umkm/),
  [Kasir Pintar](https://kasirpintar.co.id/solusi/detail/5-rekomendasi-aplikasi-kasir-terbaik-untuk-umkm-di-2025-kenapa-umkm-butuh-aplikasi-kasir)).
- Kompleksitas dan rasa takut salah/kehilangan data tercatat sebagai penghambat utama adopsi
  alat keuangan digital UMKM Indonesia ([MDPI 2025](https://www.mdpi.com/1911-8074/18/5/251),
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S154461232100235X)).
- Sebagian besar pemilik UMKM **tidak familiar dengan istilah akuntansi** dan tidak punya
  orang khusus keuangan; pemilik memegang semuanya sendiri
  ([ResearchGate 2025](https://www.researchgate.net/publication/398321446_Eksplorasi_Kesulitan_Penyusunan_Laporan_Keuangan_pada_UMKM)).
- BukuWarung/BukuKas laku karena **sederhana** dan tidak menuntut latar akuntansi
  ([Kompas](https://tekno.kompas.com/read/2022/02/21/17450017/daftar-aplikasi-catatan-keuangan-gratis-untuk-umkm-)).
- Pesaing (Majoo, Moka) menjawab "isi barang banyak" dengan **template Excel**
  ([Majoo](https://majoo.id/panduan-pengguna/detail/31),
  [Moka](https://help.mokapos.com/s/article/4405760461721?language=in)) — untuk pemilik gaptek,
  Excel itu sendiri ketakutan baru.
- Produk SaaS: pengguna yang tidak merasakan manfaat di sesi pertama kebanyakan tidak kembali;
  layar kosong tanpa bantuan memicu ditinggal di sesi pertama
  ([Userpilot](https://userpilot.com/blog/saas-user-onboarding-funnel/),
  [Rework](https://resources.rework.com/libraries/saas-growth/onboarding-time-to-value)).

## 3. Tujuh ketakutan → jawaban Una

| # | Ketakutan pemilik | Bentuknya di Leker | Jawaban Una |
|---|---|---|---|
| 1 | "Nggak tahu mulai dari mana" | layar kosong, 24 tombol | **Una yang menyapa duluan**: membaca kondisi gerai lalu bilang "gerai ini baru 1 dari 3 langkah siap jualan", dengan tombol kerjaan berikutnya |
| 2 | "Ngisi daftar barang panjang banget" | form per barang, 42+ barang | **Kirim yang sudah ada**: foto papan menu/daftar harga, atau ketik daftarnya seperti chat WhatsApp → satu tabel draft → satu "Ya". Tanpa Excel, tanpa form |
| 3 | "Takut salah terus rusak" | uang, jurnal, stok | Semua lewat **draft dulu** ("belum tersimpan apa-apa sebelum Bos tekan Ya") + **"batalkan yang barusan"** untuk barang yang terlanjur dibuat |
| 4 | "Istilahnya nggak ngerti" | HPP, jurnal, akun, Bea | **"Apa itu HPP?"** dijawab dari kamus tetap (bukan karangan AI), dengan bahasa pemilik dan tombol ke layarnya |
| 5 | "Nggak sempat, saya sibuk di gerai" | tiap langkah butuh duduk lama | Kerjaan dipecah jadi **satu ketukan**; isi massal jalan sendiri dengan hitungan "12 dari 40" |
| 6 | "Saya nggak tahu harus pencet apa" | menu berlapis | Una **membukakan layarnya** (tombol "Buka layar Akun Kasir") untuk yang memang tidak boleh lewat chat |
| 7 | "Belum kelihatan gunanya" | manfaat baru terasa setelah jualan | Daftar langkah menuju **jualan pertama** dan "Una bisa apa aja?" berisi contoh kerjaan nyata |

Aturan desain yang mengikat semua jawaban di atas:
- **Default dulu, tanya belakangan.** Kategori, satuan, harga beli punya nilai bawaan yang
  **ditulis terang di draft** (bukan diisi diam-diam). Yang ditanyakan hanya yang benar-benar
  memblok (nama, harga jual).
- **Kerjakan yang bisa, laporkan yang belum.** Satu baris yang harganya tidak terbaca tidak
  menggagalkan 39 baris lainnya; baris itu disebut terang dan dilewati.
- **Una tidak memegang rahasia.** Akun kasir (PIN/kata sandi) tidak dibuat lewat chat —
  isinya akan lewat mesin AI pihak ketiga. Una membukakan layarnya.
- **Tanpa AI pun pendampingan jalan.** Cek kesiapan dan kamus istilah dihitung kode, jadi tetap
  muncul walau kunci AI belum dipasang atau kuota habis.

**Koreksi Bos Cyo (2026-10-02, sesudah tahap pertama):** *"kalo aku nih ya disuruh bikin barang, yang
paling penting adalah harga jual, beli dan nama barang, detil lainnya aku kasih yang basic aja, engga
perlu nanyakan ... baru nanti setelah kerjain bilang kalo udah done, terus ngobrol santai ... nanya kalo
boleh tau aja nih barangnya ini dibikin dulu apa uda langsung jadi ... saranin pake resep secara ga
langsung menggiring ke manufactur. jadi semuanya seperti itu kecuali pencatatan yang nanti berhubungan
dengan masuk keluar uang langsung barulah itu ditanyakan detil tapi dengan ajakan yang soft."* Maka:
- Barang, bahan, resep **tidak bertanya** selain nama dan harga jual. Kategori → "Menu"/"Bahan",
  satuan → pcs, harga beli → 0, jumlah hasil resep → 1 — semuanya ditulis terang di draft.
- Sesudah barang jualan tanpa modal jadi, Una ngobrol santai lalu bertanya "dibikin sendiri atau beli
  jadi?". Dibikin → diajak bikin resep (atau masukin bahan dulu). Beli jadi → modal terbaca dari
  pembelian di kasir.
- Pencatatan uang masuk/keluar (biaya, gaji, lapak, hutang, uang muka, jurnal, pindah saldo) tetap
  bertanya bila kurang, diawali ajakan halus.

## 4. Yang dibangun (tahap ini)

1. **Cek kesiapan gerai** — `GET /api/caca/kesiapan?store=` membaca 5 layar yang sudah ada
   (referensi barang, resep, kasir, karyawan, laci) dengan wewenang si penyuruh, lalu
   menyusun langkah: menu jualan, akun kasir (wajib), bahan & resep, karyawan, titik lokasi
   presensi, jualan pertama. Tiap langkah membawa tawaran kerjaan sekali ketuk.
2. **Sapaan proaktif** di panel: begitu dibuka (atau gerai diganti), Una menampilkan kartu
   kesiapan bila gerai belum siap jualan; kalau sudah siap, sapaan biasa dengan tawaran kerjaan.
3. **Isi banyak barang** (`buat_barang_banyak`): dari teks bebas atau foto daftar menu, sampai
   60 baris per draft. Diposting **bertahap satu barang per permintaan** dari panel — jatah
   Cloudflare gratis 10 ms CPU dan 1.000 panggilan layanan internal per permintaan, sementara
   satu barang memakai belasan kueri; bertahap juga memberi hitungan kemajuan yang terlihat.
4. **Foto daftar menu** — lampiran foto kini ditanya dulu: "Lembar rekap" atau "Daftar menu /
   harga". Pembaca menu menyalin nama + harga + judul bagian (jadi kategori), lalu kode menyusun
   draft yang sama dengan isi massal.
5. **Kamus & peta aplikasi** (`jelaskan`): istilah dan "di mana layarnya", dijawab dari daftar
   tetap; ditambah "Una bisa apa aja?".
6. **Batalkan yang barusan** (`nonaktifkan_barang`): barang yang baru dibuat Una dinonaktifkan
   (bukan dihapus — riwayatnya tetap), lewat draft + "Ya", juga bertahap.

Belum (sengaja): membuat akun kasir/karyawan lewat chat, resep massal, impor dari foto nota
supplier, pendampingan di Kasir. Kandidat tahap berikutnya ada di §5.

## 5. Tahap berikutnya (usulan, belum dikerjakan)

- **Karyawan lewat chat** (nama + no HP saja, tanpa rahasia) — menutup langkah "karyawan".
- **Resep massal**: "Es Teh: teh 5 g, gula 20 g; Es Jeruk: …" jadi banyak resep dalam satu draft.
- **Foto nota belanja → bahan + harga beli** (sekaligus mengisi HPP awal yang benar).
- **Kabar pagi**: sapaan untuk gerai yang sudah jalan — hal yang perlu perhatian hari ini
  (izin menunggu, laci belum ditutup) — tetap tanpa polling, dibaca saat panel dibuka.
- **Ukur**: berapa gerai baru yang mencapai jualan pertama < 24 jam setelah dibuat.

<!-- DOC-IMPACT: 2026-10-02 dokumen baru — riset ketakutan pengguna baru dan rancangan Una
pendamping (kesiapan gerai, isi barang massal bertahap, foto daftar menu, kamus, batalkan); 2026-10-02
koreksi Bos Cyo: non-uang tidak bertanya, obrolan santai menggiring ke resep, uang ditanya halus. -->
