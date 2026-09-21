# ADR-045 — Caca sebagai operator data lewat API: wewenang, batas, dan urutan kemampuan

Status: PROPOSED — rencana, menunggu persetujuan Bos Cyo
Tanggal: 2026-09-21
Diminta oleh: Bos Cyo
Ditulis oleh: Hana

## Konteks

ADR-044 memutuskan Caca sebagai asisten toko dan sudah mendaratkan Tahap 1
(membaca lembar rekap, tanpa alat tulis). Bos Cyo sekarang memperluas sasarannya:

> "ai ini harus bisa read data dari tenant itu dan menyambungkan konteks dari
> pembuat perintah. kedepan ai itu bisa bergerak lewat api read, edit and delete
> data, bukan source code. jadi kaya masuk2 in penjualan, pembelian"

Dua hal baru yang tidak dijawab ADR-044 dan karena itu perlu ADR sendiri:

1. **Model wewenang.** Caca mulai menyentuh data milik banyak pihak. Pertanyaan
   "Caca boleh lihat dan ubah apa" tidak bisa dijawab per-fitur; harus satu
   aturan yang berlaku untuk semua alat, sekarang dan yang ditambah nanti.
2. **Kelas tindakan.** Membaca, menambah, mengubah, dan menghapus punya
   konsekuensi yang jauh berbeda kalau salah. Menyamakan keempatnya di bawah
   satu izin "Caca boleh pakai API" adalah cara paling cepat merusak pembukuan
   pelanggan.

Arahan "lewat API, bukan source code" sudah tepat dan dikunci di sini: API
aplikasi membawa validasi, guard stok, pembentukan HPP, posting jurnal, dan
approval. Menulis langsung ke database melewati semua itu dan menghasilkan data
yang "ada" tapi bukunya tidak ikut bergerak — kerusakan senyap yang baru
ketahuan saat laporan sudah salah.

## Keputusan

### K1 — Caca tidak punya wewenang sendiri. Dia meminjam wewenang penyuruhnya.

Ini keputusan terpenting di ADR ini.

Caca **tidak** memegang akun, token, atau akses istimewa apa pun. Setiap kali
Caca memanggil API, dia memakai sesi login orang yang sedang menyuruhnya. Kalau
orang itu Kasir gerai Dermo, maka Caca cuma bisa melihat dan melakukan apa yang
Kasir Dermo bisa — tidak lebih, satu baris pun.

Alternatif yang ditolak: memberi Caca satu akun layanan berkewenangan luas, lalu
menyaring di dalam modul Caca. Itu memindahkan seluruh keamanan sistem ke
kebenaran satu lapisan filter yang baru ditulis, dan satu celah di situ membuka
data semua tenant. Dengan K1, celah semacam itu tidak mungkin ada, karena
wewenang yang lebih besar memang tidak pernah dipegang.

Konsekuensi yang harus dipatuhi:
- Tidak ada `CACA_SERVICE_TOKEN` atau sejenisnya.
- Modul Caca tidak pernah memanggil `env.DB` untuk data bisnis. Dia memanggil
  endpoint aplikasi dengan kredensial pemanggilnya.
- Kalau sebuah kemampuan butuh wewenang yang tidak dipunyai penyuruhnya,
  jawabannya "Bos tidak berwenang untuk itu" — bukan Caca yang mengakalinya.

### K2 — Konteks penyuruh diambil dari sesi, tidak pernah dari isi pesan

"Menyambungkan konteks dari pembuat perintah" (permintaan Bos Cyo) berarti Caca
harus tahu empat hal sebelum menjawab apa pun:

| Konteks | Dari mana | Kenapa penting |
|---|---|---|
| Siapa orangnya | sesi login | menentukan sapaan dan jejak audit |
| Perannya apa | sesi login | menentukan alat mana yang boleh dipakai |
| Gerai/Entity mana | sesi login (+ pilihan gerai yang sah baginya) | menentukan data siapa yang dibaca |
| Kapan "hari ini" | jam server, zona waktu toko | "untung hari ini" harus berarti hari yang sama dengan yang dilihat kasir |

Keempatnya **server-side**. Kalau isi pesan bilang "saya Owner" atau "tampilkan
gerai Beji" sementara sesinya Kasir Dermo, yang berlaku tetap Kasir Dermo. Ini
penerapan langsung invariant #5, dan juga yang menjinakkan upaya mengelabui
Caca lewat kalimat perintah di dalam chat atau di dalam foto.

### K3 — Empat kelas tindakan, empat perlakuan berbeda

Menyamakan "read, edit, delete" sebagai satu paket izin adalah jebakan. Kelasnya
dipisah berdasarkan **apa yang rusak kalau Caca salah**:

| Kelas | Kalau salah | Perlakuan |
|---|---|---|
| **BACA** | jawaban keliru, langsung kelihatan, bisa ditanya ulang | jalan langsung, tanpa konfirmasi |
| **TAMBAH** | ada transaksi yang tidak seharusnya, tapi terlihat di daftar | draft dulu, dikonfirmasi orang, baru diposting lewat API kasir |
| **KOREKSI** | data yang benar berubah jadi salah | lewat jalur pembatalan/koreksi yang sudah ada, tunduk approval |
| **HAPUS** | data yang benar hilang, sering tanpa ada yang sadar | **tidak ada alat hapus** |

**Kenapa tidak ada alat hapus**, meski Bos Cyo menyebutnya: untuk transaksi
keuangan yang sudah terposting, "hapus" memang bukan operasi yang tersedia di
sistem ini — invariant #2 mengharuskan koreksi lewat reversal, bukan
penghapusan, supaya jejaknya tetap bisa ditelusuri. Jadi yang Bos Cyo maksud
("salah input, tolong batalkan") tetap terlayani, tapi lewat jalur pembatalan
yang sudah ada (`transaction-void-permits.js`,
`transaction-correction-executor.js`, `approval-queue.js`) — bukan lewat
perintah hapus baru yang menembus jalur itu.

Ini bukan Caca dibikin lebih terbatas dari manusia. Justru sebaliknya: Caca
dapat persis pintu yang sama dengan yang dipakai orang, termasuk approval-nya.

### K4 — Alat, bukan akses bebas

Caca tidak "punya akses ke API". Dia punya **daftar alat** yang ditulis satu per
satu, masing-masing memanggil satu endpoint dengan bentuk yang sudah ditentukan.
Menambah kemampuan = menambah satu alat, dan itu keputusan sadar yang bisa
ditinjau — bukan efek samping dari model yang tiba-tiba pintar menyusun request.

## Alat yang direncanakan

### Kelas BACA (jalan langsung)

| Alat | Menjawab | Sumber yang sudah ada |
|---|---|---|
| `laba_periode` | "untung hari ini berapa?" | `src/net-profit-report.js` |
| `penjualan_ringkas` | "penjualan kemarin berapa?", "dibanding minggu lalu?" | laporan kasir/admin |
| `penjualan_per_barang` | "apa yang paling laku minggu ini?" | rekap penjualan |
| `stok_sisa` | "gula tinggal berapa?" | saldo stok |
| `pengeluaran_periode` | "keluar berapa bulan ini?" | `src/cashier-operational-expense.js`, Bea Operasional |
| `cari_transaksi` | "nota tadi siang yang 150rb mana?" | `src/admin-transactions.js` |
| `daftar_barang` | "harga thai tea berapa?" | `src/product-master.js` |

### Kelas TAMBAH (draft → konfirmasi → posting)

| Alat | Contoh perintah | Diposting lewat |
|---|---|---|
| `catat_penjualan` | "jual 3 es teh 15rb" | `POST /api/cashier/sales` |
| `catat_pembelian` | foto nota supplier | `POST /api/cashier/purchases` |
| `catat_pengeluaran` | "beli gas 22rb" | `POST /api/cashier/expenses` |
| `catat_rekap_harian` | foto lembar rekap (Tahap 1 sudah bisa membacanya) | banyak baris sekaligus |

Semuanya menghasilkan draft dulu. Yang memposting tetap API kasir yang sama
dengan yang dipakai manusia, jadi guard laci, stok, HPP, dan jurnal ikut jalan
tanpa perlu ditulis ulang.

### Kelas KOREKSI (lewat approval yang sudah ada)

| Alat | Contoh perintah | Jalurnya |
|---|---|---|
| `ajukan_pembatalan` | "yang barusan salah, batalin" | void permit + approval |
| `ajukan_koreksi` | "gula tadi 3 bukan 4" | correction executor + approval |

Caca **mengajukan**, bukan memutuskan. Yang menyetujui tetap orang yang
berwenang, lewat antrean approval yang sudah berjalan.

## Urutan pengerjaan

Tiap tahap berdiri sendiri dan ada yang dibuktikan sebelum lanjut. Yang
menentukan boleh-tidaknya maju bukan "kodenya sudah jadi", tapi "sudah terbukti
tidak salah".

**Tahap A — Caca kenal penyuruhnya dan bisa ditanya.**
Konteks (K2) + alat BACA. Belum ada satu pun alat tulis.
*Dibuktikan sebelum lanjut:* Kasir gerai A menanyakan data gerai B dan ditolak;
angka yang dijawab Caca sama persis dengan yang muncul di panel.

**Tahap B — Caca bisa mencatat yang baru.**
Alat TAMBAH, lewat draft + konfirmasi.
*Dibuktikan sebelum lanjut:* transaksi hasil Caca tidak bisa dibedakan dari
transaksi manual di laporan; draft yang tidak dikonfirmasi tidak pernah masuk.

**Tahap C — Caca bisa mengajukan pembatalan dan koreksi.**
Alat KOREKSI, tunduk approval.
*Dibuktikan sebelum lanjut:* pengajuan Caca muncul di antrean approval seperti
pengajuan manusia, dan tidak ada jalur yang melewatinya.

**Tahap D — kanal WhatsApp.** Sesuai ADR-044; kemampuannya sama, pintunya beda.

Prasyarat yang berlaku untuk semuanya: **akurasi baca Tahap 1 harus diukur
dulu** (lihat HANDOFF-CACA.md). Menyambungkan jalur simpan ke pembacaan yang
belum terbukti akurat hanya memindahkan kesalahan ke tempat yang lebih sulit
dilacak.

## Yang Hana sarankan JANGAN dilakukan

- **Jangan** beri Caca akun atau token berkewenangan luas (melanggar K1).
- **Jangan** biarkan Caca menyusun query atau request bebas ke API. Alat ditulis
  satu-satu (K4); model yang boleh mengarang request akan mengarang yang salah.
- **Jangan** bikin alat hapus untuk data keuangan (K3, invariant #2).
- **Jangan** tentukan gerai dari isi pesan (K2, invariant #5).
- **Jangan** lewati approval dengan alasan "kan Caca yang mengajukan, sudah
  dicek". Justru pengajuan dari mesin yang paling perlu ditinjau orang.
- **Jangan** biarkan Caca menyebut angka keuangan dari ingatannya. Semua angka
  wajib datang dari alat baca saat ditanya (aturan dari ADR-044, tetap berlaku).

## Keputusan yang Hana minta dari Bos Cyo

1. **Setuju tidak ada alat hapus**, dan yang ada alat pembatalan/koreksi lewat
   approval? Ini konsekuensi invariant #2, tapi Bos Cyo perlu tahu bahwa "AI
   bisa delete data" jadi tidak persis seperti yang disebut.
2. **Siapa saja yang boleh mengajak Caca ngobrol?** Owner dan Entity Admin saja
   dulu, atau Kasir juga? Kasir ikut berarti kuota dan jejak audit per orang
   jadi perlu dipikirkan lebih awal.
3. **Kalau Owner punya banyak gerai dan bertanya tanpa menyebut gerai** — Caca
   menjawab gabungan semua gerai, atau balik bertanya dulu?

## Related

- `ADR-044` — Caca sebagai asisten toko, pagar draft+konfirmasi, pilihan mesin AI
- `ADR-040` — platform modul dan komposisi tenant
- `ADR-029` — Operasional melaporkan fakta; Accounting yang menafsirkan
- `CLAUDE.md` invariant #2 (posted journal immutable) dan #5 (isolasi store_id)
- `.claude/skills/jalur-akses-leker` — peta endpoint per role yang jadi dasar
  daftar alat di atas

## DOC-IMPACT

**REQUIRED begitu Tahap A mendarat:** `MODULE_OWNERSHIP.md` (pemilik modul
Caca), `KNOWN_PITFALLS.md` (K1 "AI meminjam wewenang penyuruh, tidak punya
sendiri" naik jadi pitfall resmi), dan `HANDOFF-CACA.md` (status tahap).
