# Module Contract v1 — cara menulis modul MAXI

Status: ACTIVE
Contract: `MAXI_MODULE_CONTRACT_V1`
Ditulis oleh: Hana, atas permintaan Bos Cyo 2026-08-23
Mengikat: `ADR-040` (platform modul dan komposisi tenant)

## Untuk siapa dokumen ini

Untuk siapa pun yang menulis modul baru, atau memindahkan kode lama jadi modul.
Dokumen ini menggantikan pertanyaan "modul yang bener itu bentuknya gimana?" —
jawabannya tidak lagi tergantung sesi mana yang kebetulan mengerjakan.

**Kenapa dokumen ini ada.** Program Ikan Galeh ditulis tanpa standar modul, dan
hasilnya bukan modul Olshop — melainkan salinan paralel dari Leker (`ADR-040`
temuan #1). Yang salah bukan sesi yang mengerjakannya: standarnya memang belum
pernah ditulis. Orang tidak bisa mengikuti bab yang tidak ada di bukunya. Empat
tenant berikutnya akan mengulang persis kesalahan yang sama kalau bab ini tetap
kosong.

## Definisi — sebuah modul itu apa

Satu modul memenuhi **lima** syarat sekaligus. Kurang satu, itu bukan modul —
itu folder berisi file.

1. **Satu titik masuk.** Semua permintaan dari luar lewat satu fungsi
   `handle<Nama>Api(request, ctx)`. Tidak ada jalur belakang; kalau modul lain
   perlu sesuatu dari modul ini, dia lewat titik masuk yang sama seperti dunia
   luar.
2. **Tabel miliknya sendiri, diprefiks namanya.** Modul Olshop memiliki tabel
   `olshop_*`. Modul lain **tidak boleh** menulis ke tabel itu — baca pun tidak,
   kecuali lewat titik masuk pemiliknya.
3. **Nol impor ke modul sesama-level.** Boleh mengimpor lapisan platform. Tidak
   boleh mengimpor saudaranya. Ini yang dijaga otomatis oleh
   `test/platform-module-contract.test.js`.
4. **Bisa dimatikan.** Tenant yang tidak memasang modul ini tetap jalan normal.
   Kalau mematikan modul ini bikin tenant lain rusak, berarti ada yang diam-diam
   bergantung — dan itu pelanggaran syarat 3 yang belum ketahuan.
5. **Punya test yang jalan tanpa modul lain.** Kalau test-nya butuh modul
   tetangga supaya hijau, modulnya belum berdiri sendiri.

## Yang WAJIB diambil dari lapisan platform

Ini bukan anjuran. Menyalin salah satu dari ini ke dalam modul adalah cara
paling cepat merusak data keuangan lintas-tenant, karena dua salinan selalu
berakhir beda.

| Hal | Ambil dari | Jangan pernah |
|---|---|---|
| Uang | `src/platform/money.js` | Bikin konstanta skala sendiri, pakai float, `* 1.0` di SQL |
| Kuantitas | `src/platform/quantity.js` | Bikin `QTY_SCALE` versi modul |
| Waktu/tanggal | platform | Format tanggal sendiri per modul |
| Pembuatan id | platform | Pola id karangan sendiri |

Aturan uang selengkapnya di `CLAUDE.md` invariant #1 dan `KNOWN_PITFALLS.md`.
Modul **tidak berhak** menafsirkan ulang aturan itu.

**Kalau menemukan salinan yang skalanya beda dari platform: BERHENTI dan
eskalasi.** Itu bukan pekerjaan refactor — itu artinya ada data keuangan yang
sudah tersimpan salah, dan itu temuan yang harus sampai ke Bos Cyo, bukan
diam-diam diseragamkan.

## Yang sebuah modul TIDAK BOLEH lakukan

- **Menulis jurnal sendiri.** Accounting yang memiliki posting jurnal
  (invariant #4). Modul mengirim business fact; Accounting yang menafsirkan.
- **Punya foreign key ke tabel Accounting.** Operasional tidak boleh terikat ke
  interpretasi Accounting.
- **Mengedit jurnal yang sudah posted.** Koreksi lewat reversal (invariant #2).
- **Polling berkala.** Tanpa `setInterval` untuk kesan real-time (invariant #6).
- **Memutuskan sendiri bahwa dia butuh data tenant lain.** Kalau sebuah modul
  merasa perlu membaca lintas-tenant, itu keputusan arsitektur — eskalasi, jangan
  dikerjakan.
- **Menambah tenant lewat migration.** Tenant dipasang lewat jalur provisioning.
  Migration hanya untuk struktur tabel, tidak untuk mengisi tenant.

## Satu modul atau dua? — aturan pemutusnya

Ini pertanyaan yang paling sering dijawab dengan perasaan, dan jawaban perasaan
selalu berakhir jadi salinan paralel. **"Kelihatannya mirip" bukan bukti.**

Dua kandidat digabung jadi **satu modul dengan dua profil** kalau ketiganya benar:

1. Aturan bisnisnya sama, yang beda cuma nilai/pengaturannya (mis. sama-sama
   "penjualan menurunkan stok", beda cuma boleh minus atau tidak);
2. Perbedaannya bisa dinyatakan sebagai **data** — baris pengaturan — bukan
   sebagai percabangan `if` yang menyebar ke banyak fungsi;
3. Perubahan pada satu profil secara wajar memang harus ikut berlaku ke profil
   lain.

Kalau salah satu tidak terpenuhi → **dua modul terpisah**. Lebih baik dua modul
yang jujur terpisah daripada satu modul yang di dalamnya penuh `if (jenis ===
'olshop')` — bentuk itu tampak hemat di awal dan jadi tidak bisa disentuh dalam
hitungan bulan.

**Kalau ragu, pisahkan.** Menggabungkan dua modul nanti itu pekerjaan sehari.
Memisahkan modul yang sudah telanjur nyampur itu pekerjaan berminggu-minggu, dan
biasanya tidak pernah dikerjakan.

## Batasnya diputuskan siapa

Supaya tidak ada lagi keputusan arsitektur yang jatuh ke tangan yang salah gara-gara
tidak pernah ditulis siapa pemiliknya:

| Keputusan | Pemilik | Bentuknya |
|---|---|---|
| Aturan pemutus di atas | **Hana** | Dokumen ini — mengikat, sudah final |
| Fakta: berapa banyak logika yang benar-benar sama | Implementer | Hasil audit, angka dan `file:baris` |
| Kesimpulan: jadi satu modul atau dua | **Aturan di atas**, diterapkan ke fakta audit | Bukan selera implementer, bukan tebakan Hana |
| Nama tabel, tipe kolom, bentuk teknis | Implementer | Setelah baca kode |
| Kontrak: pertanyaan apa yang wajib bisa dijawab | **Hana** | Kontrak ini + ADR |

Artinya: implementer **tidak sedang memutuskan arsitektur** waktu menyimpulkan
satu-atau-dua. Dia sedang menerapkan aturan yang sudah tertulis ke fakta yang dia
kumpulkan sendiri. Kalau hasilnya terasa salah, yang diperdebatkan adalah
aturannya — lewat eskalasi ke Hana/Bos Cyo — bukan diam-diam diputuskan lain.

## Registry — pertanyaan yang wajib bisa dijawab

Bentuk teknisnya (nama tabel, tipe kolom) milik implementer. **Yang tidak boleh
ditawar adalah pertanyaan-pertanyaan ini** — apa pun bentuk tabelnya, semuanya
harus bisa dijawab:

1. Tenant X memasang modul apa saja, per hari ini?
2. Tenant X boleh memanggil modul Y atau tidak? — dijawab **di server**, bukan
   dengan menyembunyikan tombol di UI.
3. Sejak kapan modul Y aktif di tenant X, dan sampai kapan? — riwayatnya
   tersimpan, tidak ditimpa. Baris lama ditutup, baris baru dibuka; isi baris
   yang sudah ditutup **tidak pernah di-`UPDATE`**. Pola versioned-nya sama
   persis dengan `entity_tenancy` di `migrations/0039` — tiru dari situ, jangan
   karang pola baru.
4. Kalau modul Y dimatikan hari ini, data lamanya masih terbaca atau hilang?
   (Jawaban benar: **masih terbaca**. Mematikan modul menghentikan transaksi
   baru, bukan menghapus sejarah.)

Pertanyaan 3 dan 4 yang paling sering dilupakan, dan keduanya tidak bisa
ditambal belakangan tanpa migrasi data.

## Sebelum bilang sebuah modul selesai

Checklist, bukan formalitas — tiap baris pernah jadi masalah nyata di repo ini:

- [ ] Lima syarat definisi di atas terpenuhi semua, bukan sebagian
- [ ] Tidak ada konstanta uang/kuantitas yang disalin ke dalam modul
- [ ] `test/platform-module-contract.test.js` hijau (bukan di-skip, bukan
      ditambahi pengecualian baru tanpa nama task pembereskannya)
- [ ] Tenant yang tidak memasang modul ini terbukti tetap jalan — ada test-nya
- [ ] Penolakan modul-tidak-terpasang terjadi di server, dibuktikan test
- [ ] `npm test` hijau penuh, `npm run check` bersih
- [ ] File `src/` baru sudah ditambahkan ke script `check` di `package.json`
- [ ] `MODULE_CATALOG.md` dan `MODULE_OWNERSHIP.md` diperbarui

**Tentang test yang perlu diubah:** kalau memindahkan kode lama jadi modul, satu-satunya
perubahan test yang boleh adalah pembaruan jalur import karena file pindah.
Mengubah angka yang diharapkan, mengubah pesan error, atau melonggarkan assertion
artinya perilakunya ikut berubah — dan itu bukan pemindahan lagi. **Berhenti dan
lapor**, jangan diteruskan.

## DOC-IMPACT

**REQUIRED** — `ADR-040` (keputusan yang mendasari), `MODULE_CATALOG.md` (status
per modul), `MODULE_OWNERSHIP.md` (pemilik tiap modul), dan
`test/platform-module-contract.test.js` (pagar otomatisnya) satu kesatuan dengan
dokumen ini. Kontrak ini naik ke v2 kalau lima syarat definisi atau aturan
pemutus satu-modul-atau-dua berubah — bukan diedit diam-diam di tempat.
