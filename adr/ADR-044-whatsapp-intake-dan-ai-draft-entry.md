# ADR-044 — Entry data lewat WhatsApp dengan bantuan AI (WA Intake)

Status: PROPOSED — desain, menunggu keputusan Bos Cyo di bagian "Keputusan yang Hana minta"
Tanggal: 2026-09-17
Diminta oleh: Bos Cyo
Ditulis oleh: Hana

## Konteks

Bos Cyo: POS ini mau dijual, dan pasarnya termasuk orang yang gaptek — yang
akrabnya cuma WhatsApp. Idenya: entry penjualan/pembelian cukup dari WA,
termasuk kirim FOTO rekap harian (contoh nyata: lembar "Stok Awal / Stok Sisa
/ Terjual / Harga / Jumlah" + blok PENGELUARAN + Setoran), lalu sistem membaca
foto itu pakai AI dan memasukkannya ke web. Jatah chat dibatasi per hari
sesuai paket langganan.

Ini bukan sekadar fitur tambahan — ini **kanal input baru untuk data keuangan**.
Jadi keputusan arsitekturnya harus dikunci dulu sebelum ada kode, karena salah
di sini artinya angka uang pelanggan yang rusak, bukan sekadar UI jelek.

## Tiga keputusan yang mengunci semua sisanya

### D1 — AI TIDAK PERNAH memposting transaksi. AI hanya membuat DRAFT.

Ini pagar paling penting di seluruh desain ini, dan tidak boleh dikompromikan
demi "biar cepat".

Model AI pasti akan salah baca suatu saat: `8` jadi `3`, satu baris kelewat,
angka `12.000` jadi `120.000`. Kalau hasil bacaan itu langsung jadi baris
`sales`/`expenses`, yang rusak adalah laporan keuangan pelanggan — dan
rusaknya **senyap**, tidak ada error, baru ketahuan berminggu-minggu kemudian
waktu angkanya tidak masuk akal.

Jadi alurnya wajib tiga langkah, bukan satu:

```
Foto/teks masuk  →  AI baca  →  DRAFT (belum jadi transaksi)
                                  ↓
                         user konfirmasi / perbaiki
                                  ↓
              posting lewat API aplikasi yang SUDAH ADA
              (validasi, approval, guard stok, semua tetap jalan)
```

Konsekuensi teknisnya: WA Intake **tidak boleh** menulis langsung ke `sales`,
`sale_items`, `expenses`, `other_income`, atau tabel fakta mana pun. Dia
menulis ke tabel draft-nya sendiri, lalu memanggil jalur API yang sama persis
dengan yang dipakai Kasir. Ini juga otomatis membuat invariant yang sudah ada
(CLAUDE.md #1 sampai #9) tetap berlaku tanpa perlu ditulis ulang di modul baru.

Efek sampingnya bagus: Laporan Net Profit (ADR-043 / `src/net-profit-report.js`)
otomatis ikut benar tanpa perubahan apa pun, karena datanya masuk lewat tabel
yang sama.

### D2 — Wajib WhatsApp Business API resmi (Meta Cloud API), bukan library tidak resmi

Ada dua jalur teknis untuk menyambung WA, dan cuma satu yang boleh dipakai
kalau produk ini mau dijual:

| | Meta Cloud API (resmi) | Library tidak resmi (Baileys, whatsapp-web.js, dll) |
|---|---|---|
| Legal | Sah, didukung Meta | Melanggar ToS WhatsApp |
| Risiko | — | **Nomor diblokir permanen**, bisa kapan saja, tanpa peringatan |
| Setup | Perlu verifikasi bisnis + WABA | Tinggal scan QR |
| Cocok dijual? | Ya | **Tidak.** Satu nomor kena blokir = seluruh pelanggan berhenti jalan |

Jalur tidak resmi memang jauh lebih cepat dipasang, dan itu yang bikin banyak
orang tergoda. Tapi untuk produk yang dijual ke pelanggan yang membayar,
itu menaruh kelangsungan bisnis mereka di atas sesuatu yang bisa mati mendadak.
Hana tidak menyarankan jalur itu sama sekali — bukan karena idealisme, tapi
karena satu blokir nomor berarti semua pelanggan kehilangan kanal input
sekaligus, dan tidak ada yang bisa dilakukan untuk memulihkannya.

Konsekuensi yang harus Bos Cyo tahu di muka soal jalur resmi:
- Butuh verifikasi bisnis Meta (Facebook Business) — prosesnya berhari-hari.
- Ada **aturan jendela 24 jam**: sistem bebas membalas user dalam 24 jam
  setelah user mengirim pesan. Di luar itu, untuk memulai chat duluan (mis.
  kirim laporan harian otomatis jam 9 malam) wajib pakai *message template*
  yang didaftarkan dan disetujui Meta dulu, dan itu berbayar per pesan.
- Artinya: alur "user kirim → sistem balas" gratis dan lancar. Alur "sistem
  kirim duluan" perlu perencanaan tersendiri.

### D3 — Nomor WA didaftarkan dari panel web, tidak pernah dari WA

Nomor WA yang terdaftar itu **kredensial**. Kalau siapa pun bisa chat ke nomor
sistem lalu mendaftarkan dirinya sendiri ke sebuah gerai, itu lubang keamanan
yang setara dengan membagikan password kasir ke publik.

Jadi: Admin Gerai / Entity Admin yang sudah login di web yang mendaftarkan
nomor karyawannya. Dari sisi WA, nomor yang tidak terdaftar dijawab satu
kalimat netral ("Nomor ini belum terdaftar") dan berhenti di situ — tidak
diproses, tidak menghabiskan kuota AI.

`store_id` diresolusi server-side dari nomor pengirim, **tidak pernah** dari
isi pesan. Ini penerapan langsung invariant #5 (isolasi `store_id` server-side)
ke kanal baru — kalau pesannya bilang "ini untuk gerai Beji" tapi nomornya
terdaftar di Dermo, yang dipakai tetap Dermo.

## Bentuk alurnya

### Empat jenis intake, satu pipeline

Supaya fleksibel (permintaan eksplisit Bos Cyo), pipeline-nya generik: pesan
masuk → klasifikasi maksud → draft bertipe → konfirmasi → posting. Menambah
jenis baru nanti = menambah satu tipe draft + satu pemeta, **bukan** membangun
ulang pipeline.

| Jenis | Contoh input | Jadi apa |
|---|---|---|
| `REKAP_HARIAN` | Foto lembar rekap (contoh Bos Cyo) | Banyak baris penjualan + pengeluaran + setoran untuk satu hari |
| `JUAL_CEPAT` | Teks: "jual 3 es teh 15rb" | Satu transaksi penjualan |
| `PENGELUARAN` | Teks/foto nota: "beli gas 22rb" | Satu catatan pengeluaran |
| `BELI_BAHAN` | Foto nota supplier | Satu pembelian bahan |

Yang paling bernilai untuk pasar Bos Cyo justru `REKAP_HARIAN` — karena
pedagang gaptek **sudah** menulis rekap harian di kertas/Excel. Mereka tidak
disuruh mengubah kebiasaan, cuma memfoto yang sudah biasa mereka tulis.

### Contoh percakapan yang dituju

```
User:    [kirim foto rekap harian]
Sistem:  Lagi dibaca ya, tunggu sebentar…

Sistem:  Rekap 5 Agustus, Tunas Regency — cek dulu ya:
         • Cappucino    1 x 10.000  =  10.000
         • Thai Tea     2 x 11.000  =  22.000
         • Matcha       1 x 13.000  =  13.000
         • Mango        4 x  8.000  =  32.000
         … (12 baris lagi)
         Total penjualan: 539.000
         Pengeluaran: 212.000  (es batu, gula, galon, kantong, tisu)
         Setoran: 36.000

         Balas OK kalau sudah benar.
         Kalau ada yang salah, balas: SALAH <keterangan>

User:    OK
Sistem:  Tersimpan ✅ — sisa jatah foto hari ini: 3
```

Kalau user balas `SALAH gula 3 bukan 4`, draft-nya tidak hangus: sistem
memperbaiki baris itu lalu meminta konfirmasi ulang. Draft yang tidak
dikonfirmasi sampai lewat tengah malam otomatis kedaluwarsa dan tidak pernah
jadi transaksi.

### Dua permukaan, satu draft

Konfirmasi di WA itu wajib (karena itu yang bisa dilakukan user gaptek), tapi
draft yang sama juga muncul di panel web — supaya orang yang lebih paham
(Bos Cyo, Admin Gerai) bisa melihat foto aslinya berdampingan dengan hasil
bacaan AI, dan memperbaikinya dengan benar kalau rumit. Satu baris draft, dua
cara menyelesaikannya.

## Kuota dan paket

Kuota dihitung per **pesan yang butuh AI**, bukan per chat. Balasan "OK",
"SALAH ...", dan pesan dari nomor tak terdaftar **tidak** memotong kuota —
kalau konfirmasi ikut memotong jatah, user jadi takut mengoreksi kesalahan,
dan justru itu yang bikin datanya salah.

Rancangan tabelnya:
- `wa_registered_numbers` — nomor → store_id/entity_id, peran, aktif/nonaktif,
  siapa yang mendaftarkan dan kapan.
- `wa_intake_quota` — per tenant: paket, jatah harian, dipakai berapa hari ini.
- `wa_intake_drafts` — hasil bacaan AI + status (`MENUNGGU_KONFIRMASI`,
  `DIKONFIRMASI`, `DITOLAK`, `KEDALUWARSA`) + referensi foto aslinya.
- `wa_intake_messages` — log mentah tiap pesan masuk/keluar, untuk audit dan
  untuk membuktikan apa yang sebenarnya dikirim user kalau nanti ada sengketa
  angka.

Paketnya sendiri menumpang registry modul yang sudah ada (`platform_modules` +
`tenant_module_installations`, ADR-040 / migration 0080): modul `WA_INTAKE`
dipasang per tenant, jatah hariannya di tabel kuota di atas.

**Yang penting soal harga:** tiap foto yang dibaca AI itu ada biayanya
(panggilan ke model vision, per gambar). Jadi tingkatan paket harus dihitung
dari biaya nyata per foto, bukan ditebak. Entry lewat **teks** jauh lebih
murah daripada foto — masuk akal kalau teks dibikin longgar/gratis dan yang
dijatah itu fotonya.

## Hal teknis yang menentukan rasanya dipakai

**Balas cepat dulu, proses di belakang.** Membaca foto butuh beberapa detik.
User WA tidak tahan diam. Jadi: webhook langsung membalas "lagi dibaca ya"
(di bawah 1 detik), pembacaan AI-nya jalan di belakang, hasilnya dikirim
sebagai pesan berikutnya.

**Foto aslinya disimpan.** Bukan cuma hasil bacaannya. Kalau suatu saat ada
angka yang dipertanyakan, harus bisa dibuka lagi foto aslinya untuk
dicocokkan — tanpa itu, tidak ada cara membuktikan siapa yang salah, AI atau
tulisan tangannya.

**Rekap harian butuh "sesi laci" buatan.** Ini gesekan nyata dengan sistem
yang sekarang: `sales`/`expenses` selalu menempel ke sesi laci kasir yang
terbuka, sementara rekap dari WA datang untuk satu hari penuh yang sudah
lewat. Saran Hana: WA Intake membuka satu sesi laci khusus untuk tanggal
tersebut, memposting semua barisnya ke situ lewat jalur biasa, lalu menutupnya
— sehingga seluruh laporan yang sudah ada (Net Profit, laporan laci, Data
Transaksi) langsung ikut benar tanpa disentuh sama sekali. Alternatifnya
(bikin jalur fakta terpisah khusus WA) kelihatan lebih sederhana di awal, tapi
berarti tiap laporan harus diajari membaca dua sumber — itu utang yang
menyebar ke mana-mana.

## Urutan pengerjaan yang Hana sarankan

Jangan dibangun sekaligus. Tiap tahap sudah bisa dipakai sendiri:

1. **Tahap 0 — kanal dulu, tanpa AI.** Sambungkan Meta Cloud API, pendaftaran
   nomor dari web, dan entry lewat **teks** (`jual 3 es teh 15rb`) dengan
   parser aturan biasa. Ini sudah cukup membuktikan seluruh alur
   draft→konfirmasi→posting jalan, tanpa menunggu urusan AI dan tanpa biaya
   per pesan. Kalau tahap ini saja gagal, tahap berikutnya percuma.
2. **Tahap 1 — foto rekap harian + AI.** Ini nilai jual utamanya.
3. **Tahap 2 — nota pembelian, pengeluaran dari foto, dan jenis lain**, mengikuti
   pipeline yang sama.
4. **Tahap 3 — sistem kirim duluan** (laporan harian otomatis jam tutup), baru
   di sini urusan *message template* berbayar Meta perlu diselesaikan.

## Yang Hana sarankan JANGAN dilakukan

- **Jangan** biarkan AI memposting langsung tanpa konfirmasi, meski untuk
  "transaksi kecil saja". Batas "kecil" itu selalu bergeser, dan yang rusak
  tetap data keuangan.
- **Jangan** pakai library WA tidak resmi untuk produk yang dijual (D2).
- **Jangan** taruh kunci API AI atau token WA di repo. Jalurnya lewat secret
  Cloudflare, sama seperti kredensial lain (invariant #9).
- **Jangan** memproses pesan dari nomor tak terdaftar, sekalipun "cuma untuk
  tanya-tanya" — itu pintu masuk penyalahgunaan kuota dan tempat orang iseng
  mencoba menyuntik data.

## Keputusan yang Hana minta dari Bos Cyo

1. **Verifikasi bisnis Meta** — Bos Cyo siap menjalani proses WABA (verifikasi
   Facebook Business, nomor khusus yang tidak dipakai WA biasa)? Ini prasyarat
   keras, tidak ada jalan pintas yang aman.
2. **Satu nomor untuk semua pelanggan, atau satu nomor per pelanggan?** Satu
   nomor bersama = murah, tapi semua pelanggan bergantung pada satu nomor.
   Nomor sendiri per pelanggan = lebih mahal dan lebih ribet dipasang, tapi
   masalah satu pelanggan tidak menular. Ini keputusan bisnis.
3. **Sesi laci buatan untuk rekap harian** — setuju dengan pendekatan itu, atau
   Bos Cyo punya gambaran lain soal bagaimana rekap sehari penuh harus masuk?
4. **Angka paket** — berapa foto/hari untuk tiap tingkat paket? Hana bisa
   hitungkan biaya AI per foto dulu kalau perlu, supaya angkanya tidak
   ditebak.

## Related

- `ADR-040` — platform modul dan komposisi tenant (WA_INTAKE jadi modul di sini)
- `ADR-043` — Master Barang Entity; Laporan Net Profit ikut benar otomatis kalau D1 dipatuhi
- `ADR-029` — Operasional melaporkan fakta; Accounting yang menafsirkan
- `KNOWN_PITFALLS.md` — "Laporan Net Profit tidak otomatis ikut fitur Beban baru"

## DOC-IMPACT

**REQUIRED** — begitu Tahap 0 mendarat: `README.md` (kanal input baru),
`MODULE_OWNERSHIP.md` (pemilik modul WA_INTAKE), `KNOWN_PITFALLS.md` (aturan
"AI tidak pernah memposting langsung" naik jadi pitfall resmi), dan
`RUNBOOK.md` (prosedur kalau nomor WA bermasalah atau kuota habis).
