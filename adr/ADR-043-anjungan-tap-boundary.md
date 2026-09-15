# ADR-043 — Anjungan Tap Kartu: alat bodoh, server pintar, tap bukan presensi

Tanggal: 2026-09-15
Status: ACCEPTED (desain; implementasi belum ada)
Konteks awal: `HANDOFF-anjungan-tap-kartu-v1.md`

## Konteks

Bos Cyo minta anjungan kecil di gerai: kartu ditempel, alat membaca ID kartu,
server membalas, alat bunyi menyebut nama orangnya dan lampunya nyala. Pemicunya
kebutuhan absen karyawan, tapi Bos Cyo eksplisit minta alatnya jadi modul
lepas-pasang yang bisa dipakai modul lain — bukan alat khusus absen.

Alat fisik itu di luar jangkauan sesi cloud (butuh kabel USB di komputer Windows
Bos Cyo). Yang bisa diputuskan dan dibangun lebih dulu adalah sisi servernya.

## Keputusan

### 1. Alat tidak menyimpan arti sebuah tap

Alat hanya mengirim fakta mentah: identitas dirinya, ID kartu, dan waktu tap.
Arti tap ditentukan server berdasarkan alat mana yang mengirim. Konsekuensi yang
memang diinginkan: alat yang sama dipakai modul lain cukup dengan mengubah
setting server — hardware dan firmware tidak disentuh.

### 2. Tap adalah fakta, bukan kehadiran

`tap_events` adalah log fakta append-only. Ia **bukan** presensi, bukan absen,
bukan jam kerja. Modul Presensi (atau modul lain nanti) yang membaca fakta itu
dan menafsirkannya. Tidak ada foreign key dua arah antara `tap_events` dan
`staff_attendance`.

Ini bentuk yang sama dengan ADR-029 (Operasional mengirim business fact,
Accounting yang menafsirkan). Alasannya pun sama: kalau pencatat fakta ikut
memutuskan arti, arti itu jadi tidak bisa dikoreksi tanpa merusak faktanya.

### 3. Pemilik alat ditentukan server dari token alat

Siapa pemilik sebuah tap — tenant-nya, dan gerainya kalau memang ada — diambil
dari baris alat yang cocok dengan token, **tidak pernah** dari kiriman alat.
Turunan langsung invariant #5 `CLAUDE.md`. Tanpa ini siapa pun yang tahu bentuk
request bisa mengirim absen palsu atas nama gerai atau sekolah mana pun.

### 4. Waktu tap milik alat, waktu terima milik server

Keduanya disimpan terpisah. Alat menyimpan tap di memori saat wifi putus lalu
mengirim susulan, jadi waktu tiba di server bisa jauh belakangan. Menimpa waktu
tap dengan waktu tiba akan memalsukan jam datang orang — dan itu nyangkut ke
gaji.

Jam alat tidak dipercaya sebagai kebenaran mutlak; selisihnya direkam supaya
penafsir bisa menilai. Yang tidak boleh adalah membuangnya.

### 5. Suara digenerate server, bukan disimpan di alat

Nama orang berubah, karyawan masuk-keluar. Rekaman per orang di kartu memori
alat berarti tiap perubahan harus bongkar alat di tiap gerai.

### 6. Alat mendorong, server tidak ditanyai berkala

Alat mengirim saat ada tap. Selaras invariant #6 — jangan diubah jadi polling.

### 7. Pemilik alat adalah Tenant, bukan Gerai (revisi 2026-09-15)

Rancangan pertama mengikat tiap alat ke `stores(id)` dengan `NOT NULL`. Itu
salah arah dan ketahuan begitu Bos Cyo menyebut calon pemakainya: modul ini mau
dijual juga ke pelanggan yang **tidak memakai POS Leker sama sekali** — misalnya
sekolah yang sudah punya program absensinya sendiri dan cuma mau memakai sisi
kartunya.

Pelanggan seperti itu tidak punya baris di `stores`. Mengikat alat ke gerai
membuat mereka mustahil diwakili tanpa memalsukan gerai bohongan — persis utang
migrasi yang diperingatkan invariant #5 `CLAUDE.md`.

Maka:

- alat dimiliki **`tenants(id)`** (wajib) — fondasinya sudah ada sejak ADR-030;
- `store_id` jadi **opsional**, diisi hanya kalau tenant itu kebetulan juga
  memakai POS Leker;
- modul didaftarkan sebagai `ANJUNGAN_TAP` di `platform_modules` dan dipasang
  per tenant lewat `tenant_module_installations`, mengikuti pola ADR-040/ADR-042.
  Artinya modul ini bisa dijual berdiri sendiri, tanpa Akuntansi, tanpa POS.

### 8. Pemegang kartu tidak harus karyawan Leker (revisi 2026-09-15)

Konsekuensi yang sama mengenai kartu. Rancangan pertama mengikat pemegang kartu
ke `cashiers(id)`; murid sekolah bukan kasir. Pemegang kartu disimpan sebagai
pasangan **jenis + acuan**, dan acuan itu hanya dimengerti oleh sistem yang
menafsirkan. Untuk pemakaian internal Leker acuannya kasir; untuk sistem luar
acuannya nomor induk siswa atau apa pun yang dipakai sistem itu — dan tidak ada
foreign key ke sana, karena datanya memang tidak tinggal di sini.

### 9. Penerima fakta boleh sistem luar — tapi belum dibangun sekarang

Karena arti tap memang sudah bukan milik alat (keputusan 1 dan 2), menyerahkan
fakta itu ke sistem milik pelanggan bukan perubahan arsitektur, cuma penerima
yang berbeda. Tiap alat punya penanda penerima: `INTERNAL` (ditafsirkan modul
Presensi Leker) atau `WEBHOOK` (didorong ke sistem pelanggan).

**`WEBHOOK` sengaja belum dibangun.** Pengiriman keluar yang benar butuh
penandatanganan, percobaan ulang, dan penyimpanan rahasia pelanggan — tiga hal
yang belum punya preseden di repo ini dan tidak boleh dikarang buru-buru.
Yang dikerjakan sekarang hanya memastikan pilihan itu **tidak tertutup**: satu
kolom penerima, dan tidak ada satu pun foreign key dari fakta tap ke tabel
internal Leker.

## Konsekuensi

- Modul anjungan tidak pernah memposting jurnal dan tidak menghitung telat.
- Menambah pemakaian baru (mis. check-in member) = baris setting baru di server,
  bukan firmware baru.
- Sampai "jam masuk standar per gerai" ditetapkan Bos Cyo, balasan server tidak
  boleh menyebut telat/tepat waktu. Mengarang status itu keputusan kebijakan yang
  bukan milik agen.
- Skor CS tetap `NEEDS_KPI_POLICY` di `src/staff-raport.js`; anjungan hanya akan
  membacanya kalau sudah ada, tidak membuat logikanya.

## Alternatif yang ditolak

- **Alat pintar yang tahu ini absen.** Ditolak: mengunci alat ke satu pemakaian,
  melawan permintaan eksplisit Bos Cyo soal modul lepas-pasang.
- **Tablet Android + Web NFC.** Ditolak Bos Cyo langsung.
- **Rekaman suara di kartu memori alat (DFPlayer).** Ditolak: tidak bisa menyebut
  nama orang baru tanpa bongkar alat.
- **Anjungan menulis langsung ke `staff_attendance`.** Ditolak: mencampur fakta
  dengan tafsir, dan mengikat alat ke satu modul.

## DOC-IMPACT

`contracts/anjungan-tap-kartu-v1.md` memegang bentuk teknisnya.
`HANDOFF-anjungan-tap-kartu-v1.md` diperbarui menunjuk ke sini.
