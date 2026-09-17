# Menjual program POS-nya sendiri — keputusan penempatan & pagar isi

Ditulis Hana, 2026-09-17, atas permintaan Bos Cyo: *"aku pingin jual program leker ini
juga. via web nanti by wa aja deh komunikasinya."* Penempatan domainnya didelegasikan
eksplisit ke Hana (*"Biar Hana yang putuskan"*), jadi keputusannya ditulis di sini —
bukan ditinggal di transkrip chat.

Ini bukan ADR. Ini catatan keputusan komersial + pagar isi halaman, supaya agen mana pun
yang menyentuh halaman jualan tahu apa yang boleh dan tidak boleh ditulis di situ.

## Yang dijual

Aplikasi di repo ini — POS self-ordering + workspace kasir + administrasi gerai — dijual
sebagai program buat usaha F&B lain, bukan cuma dipakai sendiri buat Leker. Ini konsisten
dengan arah yang sudah ditulis di `POS_MODULE_INDEPENDENCE.md`: rentang kebutuhan pelaku
F&B itu lebar, dan produknya sengaja dibentuk supaya modulnya bisa dicabut satu-satu
untuk melayani ujung bawah rentang itu.

Nama kerja di halaman jualan: **MAXI POS**. Diturunkan dari penamaan yang sudah dipakai
di ekosistem (MAXI Workboard, MAXI Leker), **bukan** nama final — Bos Cyo boleh ganti,
dan kalau diganti cukup di `public/program.html`.

## Keputusan 1 — dipisah dari SEO TemanNikah

Bos Cyo bertanya apakah ini disambungkan ke SEO TemanNikah. **Tidak.** Alasannya:

- Yang dicari orang beda total. Calon pengantin mencari *"booth jajanan nikahan Malang"*.
  Pemilik warung mencari *"aplikasi kasir"*. Tidak ada satu pun kata kunci yang dipakai
  dua-duanya.
- Google menilai sebuah domain dari satu topik yang konsisten. Menempelkan halaman jualan
  software B2B ke domain vendor pernikahan membuat Google bingung domain itu tentang apa,
  dan **dua-duanya** melemah — persis kebalikan dari strategi satu-domain-payung yang
  disepakati di `temannikah-platform/docs/strategi-konten-seo.md` bagian 2.
- Pembelinya juga beda jalur. Pembeli program tidak datang dari artikel resep atau
  ide dekorasi; dia datang dari pencarian aplikasi kasir, grup pedagang, atau rujukan.

**Dan sambungannya ke Leker juga tidak ada** — dikoreksi langsung Bos Cyo 2026-09-17:
*"untuk jualan pos nya ga ada hubungan dengan leker lo ya. kebetulan aja leker adalah
penggunanya. pasarnya tetap orang2 yang cari aplikasi."*

Artinya Leker **bukan** asal-usul, bukan identitas, dan bukan bahan cerita produk ini.
Leker kebetulan salah satu pemakainya, titik. Halaman jualan karena itu **dilarang**
memuat cerita "program ini lahir dari jualan leker/pentol" atau sejenisnya. Kredibilitas
yang boleh dipakai cuma yang netral: programnya sudah dipakai harian di usaha yang
beneran jalan — tanpa menyeret nama lini bisnis mana pun.

Pasarnya adalah orang yang sedang **mencari aplikasi kasir**. Jalur masuknya pencarian
aplikasi, grup pedagang, dan rujukan — bukan lewat konten pernikahan dan bukan lewat
nama Leker.

## Keputusan 2 — ditumpangkan dulu ke Worker yang sudah hidup

Halaman jualan ditaruh di **repo ini**, sebagai halaman statis di `/program`:

| | |
|---|---|
| Berkas | `public/program.html` |
| Route | `/program` — dilayani otomatis oleh lapisan aset, **tanpa** baris tambahan di `src/index.js` |
| Alamat hidup | `https://prototype-leker-v2.daily-napkin.workers.dev/program` |
| Biaya tambahan | Rp0 — tidak ada Worker baru, domain baru, atau layanan baru |

Kenapa begini, bukan bikin situs/domain sendiri sekarang:

1. **Bos Cyo bisa langsung klik dan menilai hari ini.** Aturan "tiap hasil kerja wajib
   ada link yang bisa diklik" cuma bisa dipenuhi kalau ada tempat deploy yang sudah
   hidup. Repo `temannikah-platform` belum punya deployment sama sekali, dan domain
   sendiri belum dibeli — dua-duanya jalan buntu untuk hari ini.
2. **Perubahannya kecil dan gampang dicabut.** Cuma satu berkas statis baru — nol baris
   di kode aplikasi. Versi pertama sempat menitip satu baris di peta route; itu dicabut
   begitu ketahuan lapisan aset sudah melayaninya sendiri, karena baris itu menambah
   risiko tanpa menambah kemampuan. Tidak menyentuh API, autentikasi, database, maupun
   route yang dipakai pelanggan/kasir.
3. **Pindah nanti murah.** Begitu ada domain sendiri, `program.html` tinggal disalin ke
   situs baru dan `/program` di sini diarahkan (redirect) ke alamat barunya.

## Pagar yang dipasang, dan kenapa

Empat pagar ini dijaga tes `test/program-landing-page.test.js` — masing-masing sudah
dibuktikan merah kalau pagarnya dicabut.

1. **Peta route aplikasi tidak boleh disentuh sama sekali.** Halaman jualan numpang di
   Worker yang dipakai gerai sungguhan. Kalau `/` sampai mengarah ke brosur, pelanggan
   yang mau pesan mendarat di halaman jualan — itu kerusakan produksi, bukan sekadar tes
   merah. Tesnya mengunci seluruh peta route lama **dan** melarang halaman jualan
   menitipkan barisnya sendiri di situ.
2. **Dilarang ada angka harga.** Bos Cyo belum pernah menetapkan harga. Halaman publik
   adalah tempat paling mahal untuk mengarang angka — sekali terbaca calon pembeli, itu
   jadi janji. Halaman menyatakan terbuka bahwa harganya dibicarakan lewat WhatsApp,
   bukan menghilangkan bagian harga diam-diam.
3. **`noindex` selama masih di hostname prototype.** Kalau halaman ini terindeks di
   alamat `workers.dev` lalu nanti dipindah ke domain sendiri, isinya jadi konten kembar
   dan dua-duanya melemah — masalah yang sama persis dengan situs `chatgpt.site` yang
   sudah tercatat di `temannikah-platform/docs/inventaris-aset.md`. **Hapus baris
   `<meta name="robots">` itu saat sudah pindah ke domain final**, jangan sebelumnya.
4. **Tidak ada formulir.** Belum ada backend yang menerima kiriman formulir. Formulir yang
   tidak ke mana-mana lebih buruk daripada tidak ada formulir: calon pembeli merasa sudah
   menghubungi, padahal tidak ada yang masuk. Semua CTA jatuh ke satu nomor WhatsApp.

Pagar tambahan yang tidak bisa dites otomatis, tapi tetap berlaku:

- **Dilarang menulis testimoni, jumlah pelanggan, atau angka pencapaian.** Belum ada satu
  pun yang bisa dibuktikan. Halaman versi sekarang sengaja tidak memuatnya.
- **Dilarang menyebut Leker/Pentol atau lini bisnis Bos Cyo mana pun sebagai identitas
  produk.** Lihat Keputusan 1 — itu koreksi langsung dari Bos Cyo, bukan preferensi gaya.
- **Fitur yang ditulis harus yang sudah jalan hari ini.** Yang masih rancangan atau
  separuh jalan (mis. rumus poin pelanggan yang formulanya belum aktif, mode HPP resep
  yang masih rancangan `ADR-037`) **tidak** ditulis sebagai fitur. Kalau mau menambah
  baris fitur, baca dulu kodenya, jangan menyalin dari dokumen rencana.

## Isi yang masih nunggu Bos Cyo

| Yang kurang | Akibatnya kalau tidak diisi |
|---|---|
| Nama final produk (sekarang "MAXI POS") | Nama kerja terus dipakai; ganti belakangan berarti revisi materi jualan |
| Harga per tingkat | Tiap calon pembeli harus ditanya balik satu per satu lewat chat |
| Nomor WhatsApp khusus jualan program | Sekarang memakai nomor yang sama dengan situs wedding (`0821 3238 4762`). Chat program dan chat nikahan bakal campur di satu inbox |
| Foto tampilan program | Halaman sekarang murni teks. Foto/tangkapan layar asli akan menaikkan kepercayaan jauh lebih besar daripada tambahan kalimat |
| Domain sendiri | Selama masih di alamat `workers.dev` yang ada kata "prototype", halaman ini layak buat dinilai Bos Cyo tapi belum layak disebarkan ke calon pembeli |

Foto tampilan program tunduk pada aturan yang sama dengan media TemanNikah: **diperlihatkan
dulu ke Bos Cyo untuk dipilih, baru disimpan** — bukan langsung diunggah ke storage.

<!-- DOC-IMPACT: perbarui dokumen ini saat nama produk difinalkan, saat harga ditetapkan,
     saat nomor WhatsApp jualan dipisah, atau saat halaman pindah ke domain sendiri
     (dan `noindex` dicabut). -->
