# Handoff — Anjungan Tap Kartu V1 (modul hardware)

Tanggal: 2026-09-15 (diperbarui 2026-09-15 sesi cloud kedua)
Asal: sesi Hana (Claude Code web/cloud) bersama Bos Cyo
Status: **belum ada kode, belum ada hardware.** Dokumen ini murni hasil keputusan
desain + status persiapan, supaya sesi berikutnya tidak mengulang pembahasan.

Pembaruan sesi kedua: desain sisi server sudah dikunci dan dipindahkan ke
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

| Barang | Kata kunci | Jml | Kisaran |
|---|---|---|---|
| Papan otak | `ESP32-S3 DevKitC-1 N16R8` | 2 | 100–130rb/pcs |
| Pembaca kartu | `RFID RC522 module` | 1 | 20–30rb |
| Kartu | `kartu RFID Mifare 13.56MHz isi 10` | 1 pak | 25–35rb |
| Penguat suara | `MAX98357A I2S amplifier` | 1 | 30–40rb |
| Speaker | `speaker 3W 4 ohm mini` | 1 | 15–25rb |
| Papan rakit + kabel | `breadboard 830 + kabel jumper dupont set` | 1 | 35–50rb |
| Kabel USB-C **DATA** | `kabel USB-C data sync` | 1 | 20–30rb |
| Adaptor | `adaptor 5V 2A USB-C` | 1 | 25rb |

Total ± Rp 370–490rb. Harga kisaran, belum diverifikasi ke toko.

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

### BELUM diverifikasi — ini langkah berikutnya

Python 3.14 tergolong sangat baru dan PlatformIO kadang belum mengejarnya.
`pio --version` jalan, tapi itu baru bukti "hidup", belum bukti "bisa kerja".
Smoke test berikut **sudah diperintahkan tapi hasilnya belum dilaporkan**:

```
cd C:\Users\Asus
mkdir tes-pio
cd tes-pio
pio project init --board esp32-s3-devkitc-1
pio run
```

Berhasil = baris terakhir `SUCCESS`. Tes ini tidak butuh hardware, dan sekalian
mengunduh toolchain ESP32-S3 yang nanti tetap terpakai.

**Kalau gagal:** kemungkinan besar Python 3.14 belum didukung → turunkan ke
Python 3.12. Jangan diulang-ulang berharap beda hasil.

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

1. Konfirmasi smoke test `pio run` di atas → `SUCCESS`.
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
