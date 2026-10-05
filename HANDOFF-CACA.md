# Handoff — "Caca", asisten toko berbasis AI

Dokumen ini untuk **sesi baru yang mulai dari nol** (Hana di sesi lain, atau agen
implementer). Instance tidak berbagi memory, jadi semua yang perlu diketahui
ditulis di sini atau ditunjuk dari sini.

Ditulis: 2026-09-17 · Oleh: Hana · Untuk: sesi lanjutan proyek Caca
Diperbarui: 2026-09-17 sore, setelah Tahap 1 mendarat.

> **Update 2026-09-27:** Bos Cyo menggeser prioritas ke asisten yang bisa **mencatat**
> (mengganti akuntan) untuk dirinya dan semua tenant. Baca `HANDOFF-HANA-PEMBUKUAN.md` dulu.
> Keputusan di dokumen ini tetap berlaku kecuali disebut lain di sana.

---

## Status singkat

**Tahap 1 sudah ada kodenya, lulus test, tapi BELUM live.** Kodenya masih di
branch `claude/wonderful-fermat-bn4szi` dan belum digabung ke `main` — sesuai
koreksi di `CLAUDE.md` 2026-09-17, kode Worker yang melayani user baru berubah
setelah branch digabung ke `main`, bukan setelah di-push. Klaim "sudah live"
pada versi handoff sebelumnya salah dan dikoreksi di sini.

Isinya: Caca bisa dikirimi foto lembar rekap lewat panel chat melayang di
Entity Admin, membacanya, lalu menampilkan hasil beserta daftar hal yang perlu
dipastikan. **Belum ada alat tulis sama sekali** — tidak ada satu pun jalur yang
menyimpan hasil bacaan jadi transaksi. Itu disengaja, jangan "dilengkapi" tanpa
membaca D1 di ADR-044 dulu.

Rencana kemampuan selanjutnya (baca data tenant, catat penjualan/pembelian,
ajukan pembatalan) ada di **`adr/ADR-045`** — arah dan pagarnya sudah disetujui
Bos Cyo, belum ada kodenya.

- Desain lengkap: **`adr/ADR-044-whatsapp-intake-dan-ai-draft-entry.md`**
  (status ACCEPTED untuk Tahap 1). **Baca itu dulu, utuh, sebelum apa pun** —
  terutama bagian "Apa yang ternyata ada di lembar rekap asli" dan urutan tahap,
  yang dua-duanya direvisi setelah Bos Cyo mengirim lembar sungguhan.
- Kodenya: `src/caca-chat.js` (endpoint), `src/caca-rekap-reader.js` (penguraian
  angka + verifikasi), `src/caca-ai-client.js` (pemanggil model),
  `public/caca-chat.js` + `public/caca-chat.css` (panel), kerangka panel di
  `public/entity-admin.html`. Test: `test/caca-rekap-reader.test.js`.

## Yang paling penting dikerjakan berikutnya

**Ukur akurasi bacanya dengan foto sungguhan.** Ini satu-satunya hal yang
menentukan apakah tahap-tahap berikutnya layak dilanjutkan, dan sampai sekarang
belum dilakukan. Yang sudah terbukti cuma logika penguraian angka dan
penghitungan ulangnya (diuji dengan angka asli lembar 06-Sep-26); kemampuan
model membaca fotonya **belum diukur sama sekali**.

Prasyaratnya: kunci mesin AI terpasang sebagai secret Cloudflare. Tanpa itu
panelnya hidup tapi menjawab "belum tersambung". Jangan pernah meminta kuncinya
dalam bentuk teks ke Bos Cyo (invariant #9).

**Bentuk panelnya meniru WhatsApp** (keputusan Bos Cyo 2026-09-30): satu ruang
chat, tanpa tombol "baca rekap" terpisah — teks dikirim sebagai pertanyaan,
foto (tombol + di kotak ketik) dikirim sebagai lembar rekap. Judul panel adalah
gerai yang sedang dibahas, dipilih lewat tombol ▾ di sampingnya. Pilihan
"semua gerai" (tingkat entity) sudah ada di daftar tapi **belum punya alat**:
panel sengaja tidak mengirim apa pun ke server dalam mode itu, karena tanpa
`?store=` server jatuh ke gerai bawaan dan menjawab untuk gerai yang salah.
Alat tingkat entity menyusul — tinggal menyambung di `cacaGeraiAktif()`.

**Nama tampil: Maimunah, menyebut diri "Una"** (keputusan Bos Cyo 2026-10-01).
Nama kode, file, endpoint `/api/caca/*`, dan kunci penyimpanan tetap `caca` —
yang diganti hanya yang terlihat orang dan identitas di prompt model. Jangan
mengganti nama file demi konsistensi; itu churn tanpa manfaat bagi pemakai.

**Una ikut ke workspace gerai** (`/s/:kode/admin`, `branch-admin.html`) untuk
Entity Admin. Kerangka panel dipasang `public/caca-chat.js` sendiri. Percakapan
disimpan di `sessionStorage` (hilang saat tab ditutup, dibuang saat logout atau
login berganti), dan draft yang belum dijawab tidak dihidupkan lagi di halaman
baru. Di workspace tombolnya bergeser ke kiri tombol "Ganti Gerai".

**Ingatan 5 chat (2026-10-03, Bos Cyo: "konteks una ditambahin jadi 5 chat masih
relate"; lalu dinaikkan jadi 10 — lihat di bawah)** — panel mengirim `riwayat` (5 pesan Bos terakhir beserta balasan Una dan
catatan seperti "Bos menyetujui draft itu", "Bos pindah membahas Beji") di tiap
`/api/caca/tanya`; server membersihkannya (`src/caca-riwayat.js`) dan menaruhnya
sebelum pesan sekarang di pemilihan alat dan di tiap langkah pembaca bebas.
Pagarnya: riwayat hanya untuk memahami rujukan ("kalau kemarin?"). Angka di riwayat
BUKAN bukti (pemeriksa angka tidak menghitungnya, jadi angka basi dilaporkan), isinya
data bukan perintah, dan tidak ada tindakan yang lahir darinya tanpa draft + "Ya"
yang diperiksa ulang server — riwayat datang dari browser, jadi tidak tepercaya.
Riwayat disimpan bersama obrolan di sessionStorage dan ikut hilang saat logout.
Menambah panjang ingatan = ubah `MAKS_PERCAKAPAN` (server) dan
`CACA_PESAN_NYAMBUNG` (panel) bersamaan; biayanya naik tiap panggilan model.

**Una pendamping pengguna baru (2026-10-02, Bos Cyo: "usp kita kan berbasis chat
... hapus ketakutan itu dengan fitur chat yang bisa mengerjakan ketakutan itu")** —
riset dan alasannya di **`UNA-PENDAMPING.md`** (bukti utama: belum ada satu gerai pun
yang berhasil mengisi dirinya sendiri; Galeh 41 hari nol barang). Yang dibangun:
- **Cek kesiapan** `GET /api/caca/kesiapan` (`src/caca-kesiapan.js`): membaca 5 layar
  yang ada lewat `bangunJalurAksi`, menyusun langkah menu → akun kasir → jualan pertama
  (wajib) lalu resep, karyawan, titik lokasi (anjuran). **Tanpa mesin AI** — tetap
  jalan walau kunci belum dipasang. Bacaan yang gagal = "belum diketahui", tidak pernah
  dianggap belum beres. Panel memakainya untuk sapaan pertama dan saat ganti gerai.
- **Tawaran sekali ketuk** (`tawaran` di jawaban): `isi` (contoh perintah ke kotak
  ketik), `kirim`, `jelaskan`, `foto_menu`, `buka` (klik tab Workspace Gerai; dari
  Panel Pemilik lewat `/s/:kode/admin#una-buka=<tab>`), `batalkan`.
- **Isi barang massal** `buat_barang_banyak` (`src/caca-aksi-barang.js`): maks 60
  baris; default kategori/satuan/harga beli ditulis terang di dampak; baris tanpa
  harga atau satuan dilewati dan disebut (bukan diisi 0); harga singkat ("5") dibaca
  ribuan HANYA kalau semua harga ditulis begitu, dan itu ditulis di draft. Pertanyaan
  kini sampai 4.000 karakter (daftar ditempel), kotak ketik jadi textarea.
- **Draft bertahap** (`bertahap: true`): `/api/caca/catat` menerima `{draft, bagian}`
  dan memposting SATU baris; panel mengulang dengan hitungan "12 dari 40" dan tombol
  "Lanjutkan" kalau berhenti di tengah. Draft diperiksa ulang utuh di setiap potongan;
  pembagian "sudah ada" diambil dari draft (`ctx.draftAsli`) supaya barang potongan
  sebelumnya tidak membuat draft dianggap berubah, dan keberadaan barang dicek lagi
  tepat sebelum dibuat (klik ganda = `sudah_ada`, tidak kembar). Editor barang
  menerima `?ringkas=1` supaya balasan tiap barang tidak membawa seluruh isi editor.
- **Foto daftar menu** `POST /api/caca/baca-menu` (`src/caca-baca-menu.js`): lampiran
  foto kini memilih "Daftar menu / harga" atau "Lembar rekap" (bawaan mengikuti
  kesiapan). Model hanya menyalin nama/harga/judul kelompok; kode menyusun draft yang
  sama dengan jalur ketik. Tulisan kapital semua dirapikan dan terlihat di draft.
- **Kamus & peta aplikasi** `jelaskan` (`src/caca-jelaskan.js`), juga
  `GET /api/caca/jelaskan?topik=`: isi ditulis tangan, dicocokkan kode — model tidak
  mengarang definisi. Menambah topik = tambah entri `KAMUS`; test memastikan setiap
  tawaran menunjuk layar/topik yang ada.
- **Batalkan yang barusan** `nonaktifkan_barang`: menonaktifkan (bukan menghapus)
  lewat `POST /api/caca/siapkan` (draft tanpa AI dari id barang yang tadi dibuat;
  hanya aksi di `SIAPKAN_LANGSUNG`) lalu draft + "Ya", bertahap.
- Sengaja **tidak** lewat chat: akun kasir (PIN tidak boleh lewat mesin AI pihak
  ketiga) — Una membukakan layarnya.
- Test ujung ke ujung: `test/caca-pendamping.test.js` (migration asli, gerai IKAN01).
- **Koreksi Bos Cyo (sesudahnya): yang bukan uang tidak bertanya.** Barang/bahan/resep cukup nama +
  harga jual; kategori, satuan (pcs), harga beli (0), dan jumlah hasil resep (1) diisi bawaan dan
  ditulis di draft. Sesudah barang jualan tanpa modal jadi, panel bertanya santai "dibikin sendiri atau
  beli jadi?" (kalimat tetap, tanpa AI) lalu menggiring ke resep. Alat uang (`ALAT_UANG` di
  `src/caca-agen.js`) tetap bertanya, diawali ajakan halus (`tanyaHalus`).

**Koreksi HPP lewat Una + ingatan 10 obrolan (2026-10-03, Bos Cyo, setelah HPP Bubuk
Matcha Genengan tercatat Rp1.899.004 per pcs dan Una menjawab pertanyaan lanjutan dengan
kamus HPP)** —
- **Salah pilih alat yang jadi akarnya:** aturan prompt "maksudnya … apa = jelaskan"
  (dari tahap pendamping) membelokkan "maksudnya stok matcha tadi? kamu bisa ubah
  hppnya?" ke kamus. Sekarang `jelaskan` HANYA untuk arti istilah/cara pakai yang berdiri
  sendiri; pesan yang merujuk percakapan, menyebut barang/gerai/angka tertentu, atau
  meminta tindakan bukan `jelaskan` (prompt di `src/caca-agen.js` + petunjuk alatnya;
  dijaga test).
- **Ingatan 10 obrolan** (`MAKS_PERCAKAPAN` 10 di server, `CACA_PESAN_NYAMBUNG` 10 di
  panel, harus sama). Jawaban Una boleh 900 karakter (pesan Bos 400) dan panel ikut
  menyimpan ringkasan isi tabel (maks 10 baris) di riwayat, karena nama yang dirujuk
  "yang tadi" sering hanya ada di tabel. Angka di riwayat tetap bukan bukti. Biaya
  tiap panggilan model naik; kalau terasa mahal turunkan angkanya di kedua tempat.
- **Alat `hitung_ulang_hpp`** (`src/caca-aksi-hpp.js`): merangkai Hitung Ulang HPP yang
  sudah ada (`src/hpp-recalculation.js`) — pratinjau → draft → "Ya"; tidak ada jalur tulis
  baru (pintu `/api/admin/hpp-recalculation` ditambah ke `PINTU_AKSI`). Dua bentuk:
  rekap ulang sejak tanggal (HPP penjualan sejak itu dihitung ulang + harga rata-rata
  bahan dibetulkan) dan "hanya harga ke depan" (urgent; tanggal mulai = besok, jadi tak
  ada penjualan yang ikut). Tanggal yang salah dicari KODE bila tidak disebut: tanggal
  pertama saat HPP bahan di penjualan melenceng > 20% dari harga benar (yang < 20%
  dilewati), tertulis di draft; tanggal dan cara DIBEKUKAN di `muatan` supaya "Ya"
  mengonfirmasi persis yang tadi tampil. Tabel draft hanya sampai kemarin (penjualan
  hari ini terus bergerak dan akan membuat draft "berubah"); hari ini tetap ikut
  dihitung dan itu disebut di dampak. Harga benar WAJIB disebut (tidak ditebak, ditanya
  dengan HPP tercatat sekarang); pecahan koma/titik diterima, nol ditolak. Hanya bahan
  di daftar `/components` (dipakai produksi dadakan atau bahan baku) yang bisa
  dikoreksi — selain itu Una menyebut bahan yang bisa. Hitung ulang kedua dengan harga
  sama tidak menggandakan koreksi (409 "tidak ada yang berubah"). Test: `test/caca-hpp.test.js`
  (migration asli).

**Una bisa mengubah barang (2026-10-03, Bos Cyo: "ganti harga aja masa ga bisa ... uda bisa
bikin barang, masak edit ga bisa")** — alat `ubah_barang` (`src/caca-aksi-barang.js`):
harga jual, harga beli, nama, kategori; satu atau banyak barang; lewat PATCH editor produk
yang sama dengan layar Data Barang (parsial: hanya isian yang disebut dikirim, foto/poin/
tipe/resep tidak tersentuh). Draft sebelum→sesudah, diposting bertahap per barang.
- Daftar barang dibaca lewat `GET /api/admin/master/products/editor?ringkas=1` (baru:
  tanpa foto; foto bisa ratusan KB per barang). Layar biasa tetap membawa foto.
- **Salah ketik nama dibaca kode** (jarak edit, hanya fungsi ini — `cocokkanSatu` yang
  dipakai alat lain sengaja tidak dilonggarkan): tepat satu yang nyaris sama → dipakai dan
  DISEBUT di draft ("Una membaca 'x' sebagai 'Y'"); selain itu **rekomendasi dari
  kemiripan terbanyak** (irisan potongan huruf + kata yang ada di nama; Bos Cyo 2026-10-03:
  "maksudnya es teh black curent atau milktea black curent ya bos?"), maks 3, dan nama
  gerai yang sedang dibuka disebut — sebab umum "barang tidak ada" adalah gerai yang
  dibuka bukan yang diucapkan ("di Mandala" padahal panel di Dermo). Barang
  nonaktif tidak diubah diam-diam; nama kembar, nilai kebesaran, dan "tidak ada yang beda"
  ditolak dengan penjelasan.
- Isi draft DIBEKUKAN di `muatan` (id + nilai lama/baru): potongan berikutnya tidak menganggap
  draft "berubah" setelah potongan sebelumnya mengubah harganya. Penjagaan wewenang tetap di
  endpoint editor (hanya produk di gerai sesi; diuji dengan id produk gerai lain).
- Harga beli yang diubah hanya Harga Beli di Master Barang; HPP (average cost) tidak ikut —
  Una mengarahkan ke koreksi HPP bila itu yang salah.

**Rencana bertahap, cek barang, "mengetik…", gerai vs entity (2026-10-03, Bos Cyo):**
- **Fakta yang dulu dijawab salah oleh model:** harga/nama/kategori barang ada di Data Barang
  TIAP GERAI; entity hanya Kode Barang + foto. Una sempat menjawab "tidak punya akses master
  entity" — prompt kini menyebut fakta ini, ada entri kamus `master_barang`, dan pesan
  selesai `ubah_barang` menyebut gerainya. Una mengikuti gerai di judul panel (▾), BUKAN
  workspace yang sedang terbuka (diverifikasi di produksi: ubahan Bos masuk ke Mandala).
- **`cek_barang`** (baca, tanpa model kedua): harga jual/beli, HPP, stok untuk barang yang
  disebut namanya; semua barang yang memuat kata itu (Besar/Kecil), dan karena hanya membaca,
  yang paling mirip ditampilkan langsung (disebut terang). Lahir dari "cek harga es teh leci
  …" yang gagal "Lembarnya terlalu panjang": pembaca bebas membawa seluruh daftar barang.
  Katalog `barang` kini selalu `?ringkas=1` (kolom `tetap` di katalog); pesan MAX_TOKENS
  penyedia AI tidak lagi bicara soal foto.
- **"mengetik…" ala WhatsApp:** subjudul panel berganti "mengetik…" dan gelembung bertuliskan
  "Una sedang mengetik…" (bukan tiga titik).
- **Alat `rencana`:** perintah berurutan (2–5 langkah) ditulis model sebagai judul + perintah;
  server TIDAK menjalankan apa pun. Panel mengirim tiap langkah sebagai pesan biasa (lewat
  pilih-alat, draft, "Ya" yang sama), kartu menampilkan 1. … ✓ / 2. … (jalan) / 3. …. Draft →
  menunggu "Ya" lalu lanjut sendiri; Una balik bertanya (`belumLengkap`) → berhenti, Bos
  menjawab di chat lalu tekan "Lanjutkan ke langkah n"; putus (RTO) → "Ulangi langkah n".
  Keadaan rencana disimpan di kartunya (`data-caca-rencana`), jadi bertahan pindah halaman
  (langkah yang sedang jalan jadi "terputus").

**Mode agen berputar (2026-10-05, Bos Cyo: "rangka mesin setara Claude Code, hanya di lingkungan tenant"):**
- **Masalahnya bukan batas konteks Gemini** (keluarga Flash-Lite menerima sekitar 1 juta token), tapi Una dulu
  sekali tembak: pilih satu alat, jalan, selesai. Sekarang `jawabPertanyaan`
  (`src/caca-agen.js`) berputar: model memilih SATU alat per putaran, mengisi `judul_langkah`
  dan `lanjut`. `lanjut=true` → hasil alat dijadikan "catatan kerja" (`teksPengamatan`, maks
  2.500 huruf/langkah) dan model memilih langkah berikutnya sambil membacanya; alat `selesai`
  menulis `jawaban_akhir`. `lanjut` kosong/false → perilaku persis seperti dulu (semua test
  lama tidak diubah).
- **Pagar tetap:** tiap putaran memilih dari daftar alat yang sama, alat tulis berhenti di
  draft + "Ya" (diperiksa ulang server). Angka di `jawaban_akhir` diperiksa `angkaTanpaBukti`
  terhadap catatan kerja + pesan Bos: meleset → model diminta memperbaiki sekali, masih
  meleset → `peringatan`. `selesai` TANPA catatan kerja (menjawab dari ingatan) yang
  menyebut angka ≥3 digit ditolak dengan kalimat jujur. Riwayat tetap bukan bukti angka.
- **Lintas permintaan:** maks `MAKS_PUTARAN`=4 pilih-alat per permintaan (batas subrequest
  Cloudflare). Belum tuntas → `{lanjutkan:true, kerja}`; panel mengirim ulang otomatis sampai 3x
  ("Una lagi ngerjain langkah n…"), sesudah itu tombol "Lanjutkan kerjaan". Total maks
  `MAKS_LANGKAH_KERJA`=12 langkah per perintah. Catatan kerja dibawa browser =
  data tak tepercaya (`bersihkanKerja`: bentuk, panjang, jumlah) — paling jauh membuat Una
  salah paham, tidak bisa melewati draft + "Ya". Tanpa tabel D1 baru (tanpa migration).
- **Draft di tengah kerjaan:** `lanjutSesudahYa` → sesudah Bos menekan "Ya", panel menambah
  langkah `persetujuan` (isi = catatan sistem hasil simpan) lalu Una melanjutkan. "Batal" =
  berhenti. Una bertanya di tengah kerjaan (`belumLengkap` + kerja) → pesan Bos berikutnya
  dikirim bersama catatan kerja (`cacaState.kerjaTertunda`), jadi Una lanjut, bukan mulai lagi.
  Lanjutan tidak memakai `alatPasti`.
- Panel menulis langkahnya ala agen: 1. … ✓ 2. … ⏸ (menunggu "Ya") di atas jawaban.
  Prompt memuat contoh percakapan (`ATURAN_PUTARAN`) — model lite lebih nurut dengan contoh.
- **Graphify bukan untuk Una:** itu peta KODE untuk agen pengembang; Una bekerja di DATA
  tenant lewat endpoint yang sama dengan layar. "Peta" milik Una = katalog API baca + daftar
  alat; dengan mode berputar dia bisa menelusuri hubungan data sendiri (barang → resep → HPP).
  Test: `test/caca-agen-putar.test.js`.
- **Tampilan kerja (2026-10-05, Bos Cyo: "visualnya kaya claude agent"):** panel mengirim
  `satuLangkah:true` → server satu putaran per permintaan, jadi kartu "Una lagi kerja"
  (`cacaTambahKerjaLive`) mencentang tiap langkah begitu selesai, dengan stopwatch di
  browser (bukan polling server). Panel lanjut otomatis sampai 11 kali (server tetap
  membatasi 12 langkah).
- **Ukuran panel (Bos Cyo: "ukurannya berubah2", "di HP tombol ganti gerai ga keliatan"):**
  tinggi tidak lagi dihitung dari posisi bilah tab (ikut bergeser saat halaman tergulir).
  Layar lebar: tetap maks 640px. HP (≤560px): penuh layar mengikuti `visualViewport`, jadi
  kepala panel tetap terlihat saat keyboard muncul; isi chat `overscroll-behavior: contain`.
- **Gerai uji `TESTINGUNA` ("Testing Una", ENT-KPM, migration 0137):** salinan master Mandala
  untuk Hana menguji Una langsung ke produksi (akun Entity Admin yang dititipkan Bos Cyo
  lewat environment sesi). Ikut muncul di laporan tingkat entity KPM — jangan mencatat
  penjualan/pembelian di sana; uji ubah master/draft saja.

**Bahasa pertanyaan balik jangan kaku (2026-10-03):** "tidak ditemukan/tidak ketemu" diganti
"belum ketemu nih"/"belum nemu nih" (`kataBelumKetemu` di `src/caca-aksi-dasar.js`, dipilih
dari isi kalimat supaya pasti untuk tes tapi bervariasi); deteksi "belum ketemu" di kode
memakai `BELUM_KETEMU`, jangan membandingkan teks lama. Kalimat baru dari kode: nada
santai, sebut gerai/angkanya, tawarkan jalan keluar.

**Una baca bebas (2026-10-02, Bos Cyo: "untuk read kasihlah dia semua akses")**
— alat `baca_api`: model memilih API dari katalog (`src/caca-baca-katalog.js`,
~50 endpoint baca admin/entity), lalu bergantian dengan kode maksimal tiga
langkah (`src/caca-baca.js`): baca → hitung/baca lagi → jawab. Hal-hal yang
tidak boleh dilonggarkan:
- **Model tidak pernah menghitung.** Saring/urut/jumlah/banding/kolom turunan
  dikerjakan `src/caca-hitung.js` (BigInt skala 1.000.000, half-up, tanpa
  float). Tabel di layar dari kode; angka di jawaban yang tidak ada di data
  dilaporkan (`peringatan`).
- **Semua hasil lewat `src/caca-baca-aman.js`** sebelum ke penyedia AI: rahasia
  (sandi, PIN, token, hash) dibuang, gambar/data besar dibuang, kontak dan
  identitas pribadi disamarkan. Berlaku untuk SEMUA endpoint, jadi keamanan tidak
  bergantung pada menyaring satu per satu.
- **Parameter per API ditulis tangan di katalog; tidak ada parameter gerai.**
  (Pitfall "parameter daftar gerai di query string tidak ikut terkunci".)
  `test/caca-baca-katalog.test.js` menjaga ini dan memastikan setiap path
  katalog ada di kode. Menambah API baca = tambah satu baris di katalog.
- **Pintu**: katalog hanya membuka halaman baca PERSIS, bukan sub-path tulis.
- **Kuota**: maks 24 pembacaan dan 3 langkah per pertanyaan. Di lingkup entity
  ("semua gerai", Bos Cyo 2026-10-02) API per gerai dibaca ke semua gerai dan
  digabung dengan kolom `_gerai`; API `berat` (mis. `transaksi`) tetap lintas
  gerai tapi barisnya dibatasi `batasLimit` per gerai. API yang tidak bermakna
  lintas gerai (`tanpaFanOut`: id/akun beda per gerai) ditolak dengan alasan, dan
  `stok_entity` satu panggilan lintas gerai. Alat baca lama (`laba_periode`,
  `stok_sisa`) di lingkup entity dijalankan lewat pembaca ini. Periode ("kemarin")
  selalu dihitung kode dan menimpa tanggal tulisan model. Pitfall kuota baca D1
  harian (2026-09-29).
- **Batas per permintaan (dikoreksi 2026-10-02 dari dokumentasi Cloudflare).**
  Akun terindikasi Workers gratis (D1 menyentuh "free tier daily row read
  limit"). Batasnya **bukan** 50 kueri D1: paket gratis membatasi 50 subrequest
  *eksternal* dan **1.000 panggilan ke layanan Cloudflare (termasuk D1)** per
  permintaan, plus **10 ms CPU**. Yang lebih mungkin kena adalah CPU (mengurai
  JSON besar berkali-kali), bukan jumlah kueri. Kalau satu jalur meledak,
  pembacaan berhenti, gerai yang tidak terbaca disebut di jawaban (bukan 500).
  Kerja tulis banyak baris sengaja dipecah per permintaan (draft bertahap).
- Skema pilih-alat sudah besar; bila penyedia menolak ("too many states"),
  pesan alasannya sekarang tampil (400 soal skema) — sederhanakan skema, jangan
  tambah isian.
- Data Bos Cyo sendiri boleh lewat jalur gratis Gemini untuk uji coba; data
  tenant lain wajib jalur berbayar (ADR-044).

**Gaya bicara Una (2026-10-02, Bos Cyo: "jangan kaku")** — santai, sesekali
"peh" (logat Tulungagung) kalau kerjaannya agak berat, kadang "wkwk/ckck/hhe".
Kalimat dari kode dibumbui di batas API lewat `src/caca-gaya.js` (acak,
peluang sebagian), jawaban model lewat `GAYA_UNTUK_MODEL` di prompt. **Isi
draft tidak boleh dibumbui**: draft dicocokkan ulang huruf per huruf saat "Ya";
untuk draft berat bumbunya jadi `sapaan` terpisah di luar kartu.

**Alat akun (2026-10-02)** — `src/caca-aksi-akun.js`: `cek_rekening_bersama`
(baca saja: mutasi Rekening Bersama vs akun 1103 per gerai), `atur_cara_bayar`
(akun, tautan Rekber, nama, aktif/nonaktif), `pindah_saldo_akun` (jurnal resmi
dua sisi dengan nominal skala persis, opsional menonaktifkan akun asal; juga
"nonaktifkan saja" untuk akun bersaldo nol). Prinsip Bos Cyo: yang dikerjakan
Una harus sudah punya jalurnya di sistem — semuanya merangkai endpoint layar
yang ada, tidak ada endpoint baru. Di lingkup "semua gerai" perintah dijalankan
ke tiap gerai entity (`jalurGerai`), pencocokan akun/cara bayar per gerai wajib
PERSIS (bukan "mengandung") supaya satu kalimat tidak memilih akun berbeda di
tiap gerai, dan hasil tiap gerai dilaporkan sendiri-sendiri. Akun di gerai
standar (ADR-047) tetap terkunci — draft menyebutnya, tidak dipaksa. Alat
baca ditandai `baca: true`: menjawab langsung tanpa draft dan tidak bisa
"diposting" lewat /api/caca/catat.

**Alat tulis tahap ketiga (2026-10-01): semua transaksi admin gerai yang
tidak menyentuh kas/laci** — `src/caca-aksi-bayar.js`: Bea Gaji, Bea Lapak,
Pembayaran Lainnya, pelunasan hutang, Uang Muka/Deposit. Cara bayar hanya
Transfer Bank / Rekening Bersama / Deposit; "Tunai / Kas Admin" sengaja
ditolak sebelum data apa pun dibaca (keputusan Bos Cyo: Una tidak menyentuh
kas/laci). Jurnal kini mengikuti lingkup panel: buku gerai atau buku entity.
Penjualan dan pembelian barang TIDAK di sini — keduanya lewat kasir (Bos Cyo
2026-10-01). Rencana berikutnya dari Bos Cyo: mekanisme tenant tanpa
karyawan, owner tunggal merangkap kasir dan admin.

**Una menulis lewat pintu masuk utama (`handleApi` di `src/index.js`),
bukan handler modul.** Sampai 2026-10-01 Una memanggil handler modul
langsung dan melewati jembatan Akuntansi ADR-046 yang dipasang di pintu
utama: Bea yang dicatat Una tidak dijurnal. Sekarang `bangunJalurAksi`
menerima `jalurUtama` dari index.js dan hanya meneruskan path yang ada di
`PINTU_AKSI` (dijaga test). Bea yang terlanjur dicatat Una sebelum perbaikan
ini tidak dijurnal mundur (sama seperti kebijakan tanpa backfill ADR-046).

**Alat tulis tahap kedua (2026-09-30): barang baru, resep baru, jurnal
entity** — di `src/caca-aksi.js`, pola sama dengan catat pengeluaran: satu
panggilan AI untuk menangkap kalimat, sisanya kode. Yang perlu diketahui:
- Nama barang/bahan/satuan/akun dicocokkan kode ke master: persis dulu, lalu
  "mengandung" satu arah dan hanya kalau kandidatnya tepat satu. Lebih dari
  satu = ditanyakan. (Dua arah pernah membuat "Kas Lama" nonaktif jatuh ke
  "Kas" — dijaga test.)
- Harga beli barang baru tidak pernah diisi 0 diam-diam; jurnal wajib balance
  exact (invariant #3), selisih ditanyakan.
- Jurnal hanya di lingkup entity (`?lingkup=entity`, Entity Admin saja);
  barang dan resep hanya per gerai. Model boleh memilih alat lingkup lain,
  lalu kode yang menjelaskan harus pindah lingkup.
- Saat "Ya" ditekan, draft disusun ULANG dari tangkapannya dan harus sama
  persis dengan yang tadi tampil — kalau master berubah atau draft diutak-atik,
  ditolak. Jurnal membawa `sourceReferenceId` per draft, jadi klik ganda tidak
  menghasilkan jurnal kembar.
- Semua tulisan lewat endpoint layar yang sama (`PINTU_AKSI` di
  `src/caca-chat.js`) dengan kredensial penyuruh. Menambah alat tulis baru =
  tambah entri di `AKSI_TULIS` dan, kalau endpoint-nya baru, di `PINTU_AKSI`.
- Belum ada: mengubah/menghapus barang atau resep, jurnal balik. (Jurnal gerai
  sudah ada sejak 2026-10-01; menonaktifkan barang sejak 2026-10-02.)

**Lokasi server menentukan apakah Gemini mau menjawab.** 2026-09-30 Caca
mati dengan `400 FAILED_PRECONDITION: User location is not supported for the
API use` — kuncinya benar, tapi Worker dijalankan di data center terdekat
pengguna, dan dari Indonesia itu kadang wilayah yang tidak dilayani Google.
Obatnya `placement.region = "gcp:asia-southeast1"` di `wrangler.jsonc` (dijaga
`test/worker-placement.test.js`). Singapura dipilih karena didukung Gemini dan
dekat dengan D1 (APAC). Kalau pesan yang sama muncul lagi, cek dulu apakah
baris itu masih ada dan terpasang di Worker yang live — jangan mengganti kunci.

**Mengganti kunci bisa memundurkan program.** 2026-09-29: kunci diganti lewat
dashboard Cloudflare, lalu kode yang melayani user ternyata versi sebelum
PR #358 — perbaikan status Caca hilang, padahal build `main` terakhir
`SUCCESS`. Mengganti secret membuat deployment baru, dan deployment itu bisa
berangkat dari versi yang lebih lama dari build `main` terakhir. Sesudah
mengganti kunci, buktikan kode live masih versi `main` (grep hasil
`workers_get_worker_code` untuk teks yang baru ditambahkan). Kalau mundur,
jalankan ulang build `main` — jangan menyimpulkan kuncinya yang salah dari
gejala yang ternyata datang dari kode lama.

**Dua mesin AI tersedia berdampingan, tinggal pilih:**

| Mesin | Kunci | Kapan dipakai |
|---|---|---|
| `gemini-3.1-flash-lite` (bawaan) | `GEMINI_API_KEY` | Uji coba — ada jalur gratis |
| `gpt-6-luna` | `OPENAI_API_KEY` | Pemakaian sungguhan — ~3x lebih murah per token |

Memasang kunci saja sudah cukup untuk menyalakan. Kalau dua-duanya terpasang,
`CACA_MESIN` (`gemini` / `openai`) yang menentukan. Berpindah tidak menyentuh
kode sama sekali — logika pembacaan, penguraian nominal, dan penyusunan draft
tidak tahu-menahu soal penyedia mana yang sedang dipakai.

Mesin yang terpasang **`gemini-3.1-flash-lite`**, dipilih karena murah selagi
masih tahap uji (~Rp70 per foto). Itu keputusan sadar Bos Cyo, bukan default
yang kebetulan — alasan dan pagarnya di ADR-044 bagian "Model mana untuk apa".
Jangan menaikkannya ke model mahal tanpa angka meleset yang menunjukkan perlu,
dan jangan pula menganggap yang murah sudah terbukti cukup sebelum diukur.

**Kalau kuncinya dari jalur gratis Gemini:** itu sah untuk menguji lembar milik
Bos Cyo sendiri, tapi **wajib pindah ke jalur berbayar sebelum data tenant lain
lewat sini** — di jalur gratis isinya boleh dipakai Google mengembangkan
produknya. Pindahnya tidak mengubah kode sama sekali. Rincian di ADR-044.

---

## Apa yang sedang dibangun

Caca = asisten toko yang **diajak ngobrol** oleh pemilik/pegawai toko. Bukan form,
bukan pipa data. Dia sudah tersambung ke toko orangnya, jadi bisa dua hal:

1. **Ditanya** — "untung berapa hari ini?", "stok gula tinggal berapa?"
2. **Disetori data** — kirim foto rekap harian / ketik "jual 3 es teh 15rb"

Pasarnya: pemilik warung/toko yang gaptek, yang akrabnya cuma WhatsApp. Tujuan
akhirnya POS ini bisa dijual, bukan cuma dipakai sendiri.

**Arah jangka panjang**: masuk lewat WhatsApp. **Tapi langkah pertama yang
disepakati bukan WhatsApp** — lihat "Langkah berikutnya" di bawah.

---

## Yang sudah DIPUTUSKAN (jangan dibongkar ulang tanpa Bos Cyo)

1. **Alat BACA jalan langsung; alat TULIS selalu lewat draft + konfirmasi.**
   AI tidak pernah memposting transaksi sendiri. Draft dikonfirmasi user, lalu
   diposting lewat API aplikasi yang sudah ada (bukan tulis langsung ke tabel).
   Ini pagar utama — kalau dilanggar, yang rusak data keuangan pelanggan.
2. **Kalau nanti masuk WhatsApp: wajib Meta Cloud API resmi**, bukan library
   tidak resmi (Baileys/whatsapp-web.js dsb). Alasannya di ADR — intinya nomor
   bisa diblokir permanen dan semua pelanggan berhenti jalan sekaligus.
3. **Nomor WA = kredensial.** Didaftarkan dari panel web oleh admin yang sudah
   login, tidak pernah self-service dari WA. `store_id` diresolusi server-side
   dari nomor pengirim, tidak pernah dari isi pesan.
4. **Mesin AI: pakai API model, otaknya dirakit sendiri.** Bukan bikin model
   sendiri, bukan numpang produk chatbot jadi (Cekat dsb). Alasan + perkiraan
   biaya + model mana untuk apa: ADR-044 bagian "Mesin AI-nya: pakai apa".
5. **Urutan tahap**: kemampuan **bertanya** (alat baca) dulu, baru foto rekap.
   Yang berisiko dan mahal ditaruh setelah alur konfirmasi terbukti dipakai
   orang sungguhan.
6. **Mulai dari kotak chat di web, bukan WhatsApp.** Dikonfirmasi Bos Cyo
   2026-09-17 ("ok berarti kita kasih tombol chat untuk owner ya").
7. **Satu nomor WA dipakai bersama semua pelanggan**, bukan nomor per pelanggan.
   Dikonfirmasi Bos Cyo 2026-09-17. Konsekuensinya: nomor itu jadi titik
   kegagalan tunggal, jadi jalur resmi Meta (D2) bukan lagi saran melainkan
   keharusan. Nomor khusus jadi paket premium, bukan bawaan.
8. **Membaca foto didahulukan, sebelum kemampuan tanya-jawab.** Arahan Bos Cyo
   2026-09-17 ("fokus kerjakan ai di web nya dulu agar dia bener2 bisa ngerti
   kalo dikasih gambar seperti itu"). Aman dilakukan lebih awal justru karena
   modulnya tidak diberi alat tulis sama sekali.
9. **Caca menyalin, kode yang menghitung.** Model tidak pernah diminta
   menjumlahkan atau membetulkan. Ini yang membuat salah baca satu angka
   ketahuan lewat total yang tidak nyambung, bukan lewat begitu saja.
10. **Nama barang dicocokkan ke master barang gerai yang sedang login**, hanya
    kalau cocok persis. Tidak di-hardcode, tidak ditebak mirip-mirip — antar
    tenant daftar barangnya pasti berbeda.
11. **Caca di dokumen ini SPESIFIK untuk konteks pelanggan-tenant (pemilik/
   pegawai toko yang tanya soal operasional gerainya sendiri) -- bukan untuk
   customer publik (pembeli yang mau pesan jajanan di suatu gerai).**
   Dikonfirmasi Bos Cyo, 2026-09-22: "whatsapp dari customer ke caca dan dari
   pelanggan tenant ke caca itu ya beda donks. caca harus bisa deteksi kalo
   ini konteksnya masalah setting gerai, yang satu masalah pingin order2
   jajanan di suatu gerai." Kalau nanti dibangun jalur WA buat customer
   publik (akuisisi member / tanya-tanya jajanan), itu **fitur terpisah**,
   jangan diam-diam digabung ke rancangan Caca di dokumen ini. Semua
   keputusan #1-6 di atas (terutama nomor WA = kredensial yang didaftarkan
   admin dari panel, bukan self-service) berlaku untuk konteks tenant ini
   saja -- BELUM tentu cocok dipakai apa adanya untuk konteks customer
   publik, yang audiensnya anonim dan volumenya berpotensi jauh lebih besar
   dan tidak terkontrol.

---

## Yang BELUM diputuskan (butuh Bos Cyo)

1. **Arti kolom "Qris" di lembar rekap.** Dugaan kuat Hana: penjualan yang
   dibayar non-tunai, jadi mengurangi setoran tapi bukan uang keluar. Belum
   dikonfirmasi Bos Cyo. Jangan ditebak sendiri — salah tafsir di sini bikin
   laba toko salah tanpa ada error yang muncul. Sementara ini Caca
   menanyakannya setiap kali ketemu.
2. Verifikasi bisnis Meta (WABA) — siap dijalani atau belum? Prasyarat keras
   sebelum jalur WhatsApp bisa dimulai sama sekali.
3. Angka paket: berapa foto/hari dan tanya-jawab/hari per tingkat langganan.
   Perlu diukur biayanya dulu, jangan ditebak.
4. Apakah model murah sudah cukup teliti untuk baca foto — sekarang dipasang
   `gemini-3.1-flash-lite`, belum diukur. Naikkan hanya setelah ada angka
   meleset dari pengujian lembar sungguhan, bukan ditebak di atas kertas.
5. Rekap sehari penuh masuk lewat "sesi laci buatan" (usul Hana di ADR) atau
   cara lain — belum dikonfirmasi Bos Cyo. Baru relevan di Tahap 3.
6. Apakah bentuk lembar rekap sama di semua cabang/tenant, atau tiap tempat
   punya versi sendiri. Menentukan seberapa longgar pembacaannya harus dibuat.
7. **Jalur WA untuk customer publik (bukan pelanggan-tenant): satu nomor WA
   yang mendeteksi konteks pengirim (tenant vs customer) lewat AI, atau dua
   persona/nomor terpisah** ("Caca" khusus pelanggan tenant, "Cici" khusus
   customer publik, usul Bos Cyo 2026-09-22)? Belum diputuskan mana yang
   dipakai. Pertimbangan Hana kalau nanti dibahas lagi: satu nomor bersama
   berarti risiko dari sisi customer (volume publik, lebih rawan dianggap
   spam oleh Meta) bisa ikut menjatuhkan akses Caca versi tenant kalau
   nomornya kena banned/limit -- jadi ada alasan infrastruktur (bukan cuma
   kerapian nama) buat pisah nomor/persona sejak awal. Ini baru catatan
   pertimbangan, bukan rekomendasi final; belum dibahas tuntas karena
   Bos Cyo minta ditunda ("bahas lain kali aja").
8. Seluruh mekanisme customer publik lewat WA (identitas = nomor WA tanpa
   registrasi lain, akuisisi member lintas-tenant, dst) masih di tahap
   ide kasar dan BELUM ada satu keputusan pun yang dikunci -- termasuk hal
   dasar seperti verifikasi identitas, pemulihan kalau nomor ganti, dan
   titik temu dengan sistem customer per-gerai yang sudah ada. Jangan
   dianggap sudah punya arah yang jelas hanya karena sempat dibahas.

---

## Langkah berikutnya yang disarankan

**Ukur dulu, jangan menambah fitur.** Godaan terbesar di titik ini adalah
langsung menyambung tombol simpan atau menambah kemampuan tanya-jawab, padahal
hal yang paling menentukan belum diketahui: seberapa sering Caca salah membaca.

Urutannya:
1. Pasang kunci API, kirim beberapa lembar rekap sungguhan lewat panelnya.
2. Catat berapa banyak baris yang meleset dan di bagian mana — angka, nama
   barang, atau baris yang kelewat.
3. Kalau melesetnya sering, perbaiki pembacaan dulu (prompt, atau model).
   Kalau jarang, baru lanjut ke Tahap 2 atau 3 sesuai ADR.

Yang **tidak** boleh dilakukan sebelum langkah di atas selesai: menyambungkan
hasil bacaan ke jalur simpan mana pun. Alur konfirmasi yang belum terbukti
akurat cuma memindahkan kesalahan ke tempat yang lebih sulit dilacak.

---

## Yang sudah ada di repo dan bisa langsung dipakai

Jangan bangun ulang yang sudah ada:

| Kebutuhan Caca | Sudah ada di | Catatan |
|---|---|---|
| Pemanggilan model AI | `src/caca-ai-client.js` | Satu-satunya tempat bicara ke penyedia model. Jangan panggil langsung dari handler — modelnya harus tetap bisa ditukar. |
| Penguraian angka + verifikasi lembar | `src/caca-rekap-reader.js` | Sudah teruji dengan angka lembar asli. Tambah jenis pemeriksaan di sini, bukan di prompt. |
| Resolusi gerai/entity dari sesi login | `src/stores.js`, `src/owner-auth.js` (`requireManagement`) | Pakai ini, jangan bikin jalur otorisasi baru |
| Pendaftaran modul per tenant (untuk paket langganan) | `platform_modules` + `tenant_module_installations` (migration 0080), `src/platform-module-registry.js` | Modul Caca direncanakan bernama `CACA_WA`; belum dipasang, Tahap 1 belum berkuota |
| Panel tempat menaruh tombol chat | `public/entity-admin.html` | Panel melayang, di luar sistem tab |

**Alat baca "untung hari ini" sudah tersedia di `main`** —
`src/net-profit-report.js` plus panel `public/admin-net-profit-report.js`, masuk
lewat PR #295/#296. Jadi Tahap 2 tinggal membungkusnya jadi alat, bukan
membangun dari nol.

---

## Pagar yang tidak boleh dilanggar

Selain 10 keputusan di atas:

- **`CLAUDE.md` invariant #1–#9 tetap berlaku penuh.** Terutama: uang selalu
  scaled-integer (bukan float), Accounting satu-satunya yang memposting jurnal,
  isolasi `store_id` server-side.
- **Gerai tidak pernah ditentukan dari isi gambar.** Lembar rekap memuat tulisan
  "Cabang", dan itu sengaja diabaikan — yang dipakai selalu gerai dari sesi login
  yang sudah divalidasi. Penerapan invariant #5 ke kanal baru.
- **Caca tidak membetulkan lembar yang tidak konsisten.** Kejanggalan diangkat
  sebagai pertanyaan. AI yang "merapikan" angka pemilik toko menghasilkan
  pembukuan yang tidak pernah bisa dicocokkan balik ke kertasnya.
- **Angka keuangan tidak boleh keluar dari ingatan model.** Semua angka wajib
  datang dari query saat ditanya. Model yang "mengingat" angka kemarin lalu
  menyebutkannya lagi hari ini adalah cara paling halus menyajikan angka palsu
  yang terdengar meyakinkan.
- **Caca tidak boleh mengaku manusia** kalau ditanya.
- **Kunci API tidak pernah masuk repo** — lewat secret Cloudflare (invariant #9).
- Baca `KNOWN_PITFALLS.md` sebelum menyentuh apa pun yang berkaitan dengan
  Accounting/Inventory — khususnya catatan "Laporan Net Profit tidak otomatis
  ikut fitur Beban baru".

---

## Siapa yang mengerjakan

Saran Hana, mengikuti pembagian kerja di `CLAUDE.md`:

- **Rancangan dan brainstorming lanjutan → Hana** (di sesi mana pun). Desainnya
  masih bergerak: dalam satu sesi kemarin saja bentuknya berubah tiga kali
  seiring Bos Cyo memperjelas maksudnya. Menyerahkan rancangan yang belum stabil
  ke agen implementer yang mulai dari nol itu pemborosan — dia akan mengerjakan
  versi yang sudah basi sebelum selesai.
- **Implementasi, setelah rancangan sebuah tahap dikunci → agen implementer
  (Karen/dst)** lewat papan agent-bus, pakai skill `agent-task-brief`.
- Tahap 1 dikerjakan Hana sendiri, sesuai perkecualian di `CLAUDE.md`: bentuknya
  berubah beberapa kali dalam satu percakapan, dan konteks lembar rekap aslinya
  mahal ditransfer ulang ke sesi yang mulai dari nol.
- **Pengukuran akurasi berikutnya juga cocok dipegang Hana**, karena hasilnya
  langsung mengubah rancangan (prompt, pemeriksaan, pilihan model) — itu
  rangkaian coba-coba yang saling bergantung, bukan potongan kerja berbatas
  jelas. Begitu angkanya stabil, Tahap 2 dan 3 sudah rapi untuk dilempar.

---

## DOC-IMPACT

Dokumen ini **sementara** — berlaku sampai akurasi baca Tahap 1 terukur dan
dokumen turunannya menyusul (lihat DOC-IMPACT di ADR-044). Begitu
modulnya ada, isinya pindah ke `ADR-044` (status jadi ACCEPTED),
`MODULE_OWNERSHIP.md`, dan `RUNBOOK.md`, lalu file ini dihapus.
