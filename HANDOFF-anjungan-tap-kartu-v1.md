# Handoff — Anjungan Tap Kartu V1 (modul hardware)

Tanggal: 2026-09-15 (diperbarui 2026-09-15 sesi cloud kedua)
Asal: sesi Hana (Claude Code web/cloud) bersama Bos Cyo
Status: **belum ada kode, belum ada hardware.** Dokumen ini murni hasil keputusan
desain + status persiapan, supaya sesi berikutnya tidak mengulang pembahasan.

Pembaruan sesi kedua: smoke test PlatformIO **LULUS** dan kekhawatiran Python 3.14
gugur — komputer Bos Cyo siap, tinggal menunggu papan datang. Desain sisi server
sudah dikunci dan dipindahkan ke
`adr/ADR-043-anjungan-tap-boundary.md` (alasannya) dan
`contracts/anjungan-tap-kartu-v1.md` (bentuk tabel + endpoint). Belum ada task
yang dilempar ke agen implementer — ditahan sampai Bos Cyo bilang lanjut.

Dokumen ini sengaja dipisah dari sesi kerja Leker biasa karena eksekusinya
memang pindah tempat: flashing hardware butuh Claude Code yang jalan **lokal di
komputer Windows Bos Cyo** yang kabel USB-nya nyolok ke alat. Sesi cloud tidak
akan pernah bisa menyentuh alatnya.

## Apa yang dibangun

Sebuah "anjungan" kecil di gerai: kartu ditempel → alat baca ID kartunya →
kirim ke server → server balas → alat bunyi (suara menyebut nama orangnya) dan
lampu nyala.

Pemicu awalnya kebutuhan **absen karyawan** dengan suara yang beda-beda
(terlambat 2 menit vs 10 menit beda, CS baik vs kurang baik beda). Tapi Bos Cyo
eksplisit minta ini **jadi modul sendiri yang bisa lepas-pasang dan dipakai
modul lain**, bukan alat khusus absen.

## Prinsip arsitektur — jangan dilanggar

**Alat bodoh, server pintar.**

Alat hanya tahu tiga hal:
1. baca ID kartu;
2. kirim `{identitas alat, ID kartu, waktu}` ke server;
3. mainkan suara yang dikirim balik server + nyalakan lampu.

Alat **tidak tahu** tap itu untuk absen, check-in member, atau apa pun. **Arti
sebuah tap ditentukan server, per alat.** Konsekuensi yang diinginkan: alat yang
sama bisa dipakai modul lain nanti tanpa mengubah hardware maupun firmware —
cukup ganti setting di server.

Turunan penting: suara "sebut nama" digenerate di server lalu dikirim ke alat.
Bukan rekaman per orang di kartu memori alat. Jadi karyawan baru/ganti nama
tidak pernah perlu bongkar alat.

## Keputusan Bos Cyo yang sudah final

1. **Bukan tablet.** Opsi tablet Android + Web NFC sempat diajukan Hana dan
   **ditolak Bos Cyo**. Jangan ditawarkan lagi.
2. **Bukan laptop/PC di gerai.** Anjungan yang terpasang cuma colok listrik +
   wifi. (Laptop tetap dipakai di meja kerja untuk membuat & flash pertama kali —
   itu hal berbeda dan sudah disepakati.)
3. **Cari yang paling gampang dan paling murah**, tapi bukan termurah mutlak
   kalau itu menambah risiko mentok (lihat alasan pemilihan papan di bawah).
4. **Suara personal menyebut nama** (bukan sekadar bunyi kategori). Contoh:
   "Selamat pagi Budi, terlambat 10 menit."
5. **Update lewat wifi (OTA) wajib ada sejak firmware versi pertama.** Tanpa ini,
   tiap perbaikan kecil harus keliling gerai bawa laptop.

## Daftar belanja — STATUS: BELUM DIBELI

| Barang | Kata kunci | Spesifikasi yang harus cocok | Jml | Kisaran |
|---|---|---|---|---|
| Papan otak | `ESP32-S3 DevKitC-1 N16R8` | **N16R8**: flash 16MB + PSRAM 8MB, USB-C | 2 | 100–130rb/pcs |
| Pembaca kartu | `RFID RC522 module` | 13.56MHz, SPI, 3.3V | 1 | 20–30rb |
| Kartu | `kartu RFID Mifare 13.56MHz isi 10` | **13.56MHz** (Mifare Classic/S50) | 1 pak | 25–35rb |
| Penguat suara | `MAX98357A I2S amplifier` | I2S digital in, ±3W, speaker 4–8 ohm | 1 | 30–40rb |
| Speaker | `speaker 3W 4 ohm mini` | 3W, 4 ohm | 1 | 15–25rb |
| Papan rakit + kabel | `breadboard 830 + kabel jumper dupont set` | 830 titik; jumper male-male **dan** male-female | 1 | 35–50rb |
| Kabel USB-C **DATA** | `kabel USB-C data sync` | data sync, bukan charge-only | 1 | 20–30rb |
| Adaptor | `adaptor 5V 2A USB-C` | 5V 2A | 1 | 25rb |

Total ± Rp 370–490rb. Harga kisaran, belum diverifikasi ke toko.

### Jebakan saat beli — empat ini yang paling sering bikin mentok

1. **Varian papan salah.** Penjual sering mengirim `N8` atau `N8R2` walau judulnya
   menyebut ESP32-S3. Yang dibutuhkan **N16R8**. Ini bukan rewel: PlatformIO
   terbukti (2026-09-15) menganggap papan ini varian *tanpa PSRAM* secara bawaan,
   dan PSRAM itu justru alasan papan ini dipilih — penahan suara supaya tidak
   patah-patah. Salah varian = suaranya bermasalah dan penyebabnya susah dilacak.
2. **Frekuensi kartu salah.** RC522 hanya membaca **13.56MHz**. Kartu RFID murah
   yang banyak beredar itu **125kHz** dan sama sekali tidak akan terbaca — alatnya
   normal, kartunya normal, tapi tidak pernah ketemu.
3. **Pin belum tersolder.** RC522 dan MAX98357A sering dikirim dengan pin
   header-nya masih lepas di dalam plastik. Kalau begitu, rencana "prototipe tanpa
   solder" batal sebelum mulai. Tanyakan ke penjual: minta yang pin-nya **sudah
   terpasang**, atau minta dipasangkan.
4. **Kabel USB charge-only.** Alat menyala, lampunya hidup, tapi komputer tidak
   mendeteksi apa pun. Ini jebakan paling banyak memakan waktu karena orang
   mencarinya di tempat yang salah.

**Alasan pemilihan (jangan diganti tanpa alasan kuat):**

- **ESP32-S3, bukan ESP32 klasik yang lebih murah.** Tiga alasan, semuanya demi
  kelancaran kerja agent: USB-nya native ke chip (tidak ada drama driver di
  Windows), punya PSRAM sehingga sanggup buffer audio streaming dari server
  (papan murah sering bikin suara patah-patah), dan lampu indikator RGB sudah
  onboard sehingga prototipe tidak perlu LED terpisah.
- **Beli 2 papan.** Papan gampang rusak saat tahap belajar; kalau cuma satu dan
  mati, pekerjaan berhenti total menunggu kiriman.
- **MAX98357A (I2S), bukan DFPlayer Mini + kartu memori.** DFPlayer hanya bisa
  memutar file rekaman yang sudah ada di kartu memori — tidak cocok dengan
  keputusan "suara digenerate server dan menyebut nama".
- **Breadboard + jumper** supaya prototipe **tidak perlu solder** sama sekali.
- **Kabel USB harus kabel data.** Kabel charge-only adalah jebakan paling sering:
  alat menyala tapi tidak terdeteksi sama sekali, dan orang bisa menghabiskan
  berjam-jam mencari masalahnya di tempat yang salah.

Sengaja **belum** dibeli: solder, Raspberry Pi, tablet, layar/OLED, casing,
modul jam RTC, modul MP3+SD card. Baru dipertimbangkan setelah prototipe jalan.

## Status setup komputer lokal (Windows, milik Bos Cyo)

Sudah terpasang dan sudah diverifikasi lewat output langsung:

```
node    v24.21.0
git     2.55.0.windows.5
claude  2.1.272
python  3.14.7
pio     PlatformIO Core 6.2.0
```

**Keputusan: pakai Windows native, JANGAN WSL.** WSL menyulitkan akses port USB,
padahal justru itu inti pekerjaannya. Kalau menemukan panduan yang menyarankan
WSL, abaikan untuk kasus ini.

### Smoke test PlatformIO — LULUS (2026-09-15)

**Status akhir: `SUCCESS`.** Dijalankan dua tahap. Tahap pertama gagal karena
folder `src` masih kosong; setelah diisi `main.cpp` minimal, `pio run` berhasil
(dilaporkan Bos Cyo langsung dari layarnya: banner `SUCCESS` hijau). Artinya
rantai penuh — unduh toolchain sampai compile — sudah terbukti jalan di Windows
Bos Cyo, tanpa hardware. Riwayat di bawah ini disimpan supaya sebabnya tidak
ditebak ulang kalau nanti muncul lagi.


Perintah yang dijalankan Bos Cyo di PowerShell:

```
cd C:\Users\Asus
mkdir tes-pio
cd tes-pio
pio project init --board esp32-s3-devkitc-1
pio run
```

**Yang TERBUKTI jalan** (dari output langsung, bukan dugaan):

- `Project has been successfully initialized!`
- Seluruh toolchain terunduh dan terpasang bersih: `espressif32@7.1.3`,
  `toolchain-xtensa-esp32s3@8.4.0`, `toolchain-riscv32-esp@8.4.0`,
  `framework-arduinoespressif32@4.20017`, `tool-esptoolpy@2.41100`,
  `tool-scons@4.41101`.

**Kekhawatiran Python 3.14 GUGUR.** Output `pip` menunjukkan PlatformIO memasang
dependensinya ke `...\Python\Python313\python.exe` — PlatformIO memakai Python
3.13 miliknya sendiri, bukan Python 3.14 yang terpasang di PATH. Jadi rencana
"turunkan ke Python 3.12" **tidak perlu dijalankan**. Jangan diturunkan.

**Kenapa tahap pertama gagal:** `pio run` berhenti di
`Error: Nothing to build. Please put your source code files to the 'src' folder`
lalu `[FAILED]`. Itu bukan kegagalan toolchain — foldernya memang masih kosong,
jadi compiler-nya belum pernah sekali pun dipanggil. Kalau pesan ini muncul lagi
suatu saat, artinya sama: folder sumbernya kosong, bukan alat/setup-nya rusak.

Perintah yang menutupnya:

```
cd C:\Users\Asus\tes-pio
Set-Content -Path src\main.cpp -Value "#include <Arduino.h>", "void setup() { Serial.begin(115200); }", "void loop() {}"
pio run
```

Hasilnya `SUCCESS`. Komputer Bos Cyo sudah siap; langkah setup berikutnya tinggal
menunggu papan datang.

### Jebakan yang ketahuan dari output ini

Board profile bawaan `esp32-s3-devkitc-1` terbaca sebagai
**`ESP32-S3-DevKitC-1-N8 (8 MB QD, No PSRAM)`** — sedangkan papan di daftar
belanja adalah **N16R8** (flash 16MB, PSRAM 8MB). Padahal PSRAM justru salah satu
alasan papan ini dipilih (buffer audio streaming supaya suara tidak patah-patah).

Konsekuensinya: saat papan aslinya datang, `platformio.ini` **wajib** disetel
eksplisit untuk flash 16MB + PSRAM aktif. Kalau dibiarkan bawaan, PSRAM-nya tidak
akan terpakai dan gejalanya muncul belakangan sebagai suara patah-patah — jauh
dari penyebabnya. Flag persisnya dicocokkan ke dokumentasi PlatformIO saat itu,
jangan ditulis dari ingatan.

## Urutan langkah berikutnya

Langkah 1–6 di bawah ini semuanya **jatah sesi lokal di komputer Windows**, bukan
sesi cloud. Hasil smoke test `pio run` dilaporkan ke sesi hardware itu, jangan ke
sesi cloud — sesi cloud tidak bisa berbuat apa-apa dengan hasilnya.

Jatah sesi cloud (sisi server) urutannya terpisah:

- **C1. Kunci desain server.** SELESAI 2026-09-15 → ADR-043 + contract.
- **C2. Lempar implementasi ke agen tukang.** BELUM — ditahan atas permintaan
  Bos Cyo. Briefnya tinggal disusun dari contract; jangan disusun dari ingatan.
- **C3. Setelah tabel jadi:** daftarkan alat pertama (provisioning token) dan
  daftarkan kartu pertama ke karyawan.

1. ~~Konfirmasi smoke test `pio run` → `SUCCESS`.~~ **SELESAI 2026-09-15.**
2. Beli hardware sesuai daftar.
3. Saat barang datang: colok papan, cek Windows mengenalinya (kemungkinan besar
   tanpa install driver karena USB-nya native; driver CH343/CP2102 hanya perlu
   kalau memakai port UART, bukan port USB).
4. Setel izin Claude Code lokal supaya perintah upload/monitor tidak minta
   konfirmasi tiap kali — tanpa ini loop otomatisnya tidak jalan.
5. Firmware v1: baca kartu → tampilkan ID-nya di layar serial. Sesederhana itu
   dulu; jangan langsung wifi + audio.
6. Tambah bertahap: wifi → kirim ke server → terima balasan → audio → OTA →
   buffer offline.

## Yang MASIH menggantung (jangan ditebak sendiri)

1. **Jam masuk standar** untuk menghitung telat. Bos Cyo menjawab "di presensi",
   dibaca sebagai: jadi setting baru di area Presensi yang sudah ada, satu jam
   per gerai, diatur Admin. **Belum ada di sistem.** Tabel `staff_attendance`
   (migration 0015) hanya mencatat jam datang aktual + foto, terikat
   `cashiers(id)`, tidak punya pembanding "seharusnya jam berapa".
2. **Skor CS baik/kurang baik.** Bos Cyo: "di raport di portal ca, abis ini bikin
   sistem biar nilainya keluar disana" — artinya proyek terpisah setelah ini,
   dan kebijakan KPI-nya ditetapkan Bos Cyo dulu. Saat ini `src/staff-raport.js`
   sengaja mengembalikan `score: null` dengan
   `scoreStatus: 'NEEDS_KPI_POLICY'` — itu keputusan sadar untuk tidak mengarang
   skor. **Modul anjungan hanya membaca skor itu nanti, tidak membuat logikanya.**
   Sampai skor itu ada, bagian suara CS dibiarkan kosong.
3. **Tempat kode firmware.** Rekomendasi Hana: subfolder di repo ini, mengikuti
   preseden `agent-bridge/` (Worker terpisah, config sendiri, tidak ikut
   ter-deploy Git Integration). Ini memenuhi "modul terpisah" di level kode
   sekaligus membuat sesi cloud dan sesi lokal berbagi satu sumber kebenaran:
   cloud menulis firmware & push, lokal pull → flash → baca serial → perbaiki →
   push balik. **Belum dikonfirmasi Bos Cyo.**

## Skema data yang perlu dibuat (dirancang, belum dibuat)

Tiga kebutuhan di bawah ini sekarang sudah punya bentuk konkretnya di
`contracts/anjungan-tap-kartu-v1.md` — kolom, aturan keras, dan bentuk endpoint.
Yang belum: tabelnya sendiri belum ada di database, endpoint-nya belum ada.

- **Kartu → karyawan**: UID kartu, milik siapa, gerai mana. → `tap_cards`.
  Kartu hilang di-revoke, tidak dihapus, supaya tap lama tetap bisa ditelusuri.
- **Identitas alat**: tiap anjungan punya token sendiri. **Gerai ditentukan
  server dari token alat, JANGAN diterima dari kiriman alat** — ini turunan
  langsung invariant #5 CLAUDE.md (isolasi `store_id` server-side). Tanpa ini
  siapa pun bisa mengirim absen palsu dari luar. → `tap_devices`, token disimpan
  sebagai hash mengikuti pola `hashCredential()`.
- **Buffer tap offline**: kalau wifi putus, tap disimpan di memori alat lalu
  dikirim susulan. Ini data absen — nyangkut ke gaji orang, tidak boleh hilang.
  Konsekuensi: waktu tap harus ikut dikirim dari alat, bukan dicap waktu tiba di
  server, karena tap susulan bisa datang jauh belakangan. → `tap_events` dengan
  `tapped_at` (jam alat) dan `received_at` (jam server) terpisah, plus
  `UNIQUE (device_id, client_event_id)` supaya kiriman ulang tidak menggandakan.

Keputusan tambahan yang diambil sesi kedua (alasan lengkap di ADR-043): tap
disimpan sebagai **fakta**, bukan sebagai kehadiran. Modul anjungan tidak menulis
`staff_attendance`, tidak menghitung telat, dan tidak memposting jurnal apa pun.
Modul Presensi yang membaca fakta itu dan menafsirkannya — bentuk yang sama
dengan ADR-029 (Operasional mengirim fakta, Accounting yang menafsirkan).

## Invariant repo yang relevan

- **#5 isolasi `store_id` server-side** — lihat poin identitas alat di atas.
- **#6 tanpa polling periodik** — aman: alat mengirim saat ada tap (push), bukan
  menanyai server berkala. Jangan diubah jadi polling.

## Batasan jujur

- **Sesi cloud tidak bisa flash hardware.** Bukan soal kurang install — memang
  tidak ada kabel. Yang bisa: menulis firmware, push ke repo.
- **Sesi Claude Code lokal tidak punya ingatan percakapan ini.** Itu alasan
  dokumen ini ada. Brief sesi lokal dengan dokumen ini.
- **Telinga dan mata tetap milik manusia.** Serial monitor bisa membuktikan
  "kartu terbaca, ID sekian, wifi konek, server membalas". Tidak bisa
  membuktikan suaranya cukup keras di gerai yang berisik, lampunya terlihat dari
  jauh, atau jarak tempel kartunya nyaman.

## Cara memulai sesi berikutnya

Sesi lokal (di komputer Windows, setelah hardware datang): buka Claude Code di
folder repo, minta baca `HANDOFF-anjungan-tap-kartu-v1.md` ini lebih dulu, lalu
mulai dari "Urutan langkah berikutnya" nomor yang belum selesai.

Sesi cloud (kalau yang dikerjakan sisi server/skema, bukan alatnya): dokumen yang
sama, tapi kerjanya di bagian "Skema data yang perlu dibuat".

## DOC-IMPACT

**NONE** — masih belum ada perubahan perilaku sistem: tidak ada tabel baru, tidak
ada endpoint baru, tidak ada firmware. Yang bertambah 2026-09-15 hanya dokumen
keputusan: `adr/ADR-043-anjungan-tap-boundary.md` dan
`contracts/anjungan-tap-kartu-v1.md`.

Saat tabel/endpoint pertama benar-benar dibuat, contract naik dari status DESIGN
dan dokumen ini wajib diperbarui lagi.
