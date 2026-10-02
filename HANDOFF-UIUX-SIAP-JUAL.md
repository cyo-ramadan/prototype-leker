# Handoff — Sesi UI/UX "Siap Jual"

Untuk: **sesi baru yang mulai dari nol** (Hana versi UI/UX). Instance tidak berbagi
memory; semua yang perlu diketahui ada di sini dan di dokumen yang dirujuk.

Ditulis: 2026-10-01 · Oleh: Hana (sesi strategi penjualan) · Atas permintaan Bos Cyo

---

## 0. Kenapa sesi ini ada

Sesi strategi penjualan menyimpulkan: **produk sudah cukup untuk dijual sekarang**, tidak
perlu menunggu semua fitur jadi. Yang menghalangi penjualan bukan kekurangan fitur,
melainkan **kesan pertama**: tulisan "Prototype", merek Leker di mana-mana, catatan
internal developer tampil di layar, fitur setengah jadi yang terlihat rusak, dan layar
admin yang terlalu ramai untuk pemilik gerai kecil.

Tugas sesi ini: **membereskan jalur yang dilihat calon pembeli dan pemilik**, supaya
produk bisa didemokan dan dipakai pemilik usaha di luar lingkaran Bos Cyo.

**Bukan** tugas sesi ini: redesign total, mempercantik layar akuntansi, menambah fitur
baru di luar daftar §3. Ukuran keberhasilannya satu: *apakah ini membantu orang asing
membeli?* Kalau tidak, tunda.

Konteks strategi lengkap: `HANDOFF-STRATEGI-PENJUALAN.md` (baca §1, §4, §5, §10).

## 1. Sasaran pembeli (supaya keputusan UI konsisten)

- **Koreksi Bos Cyo 2026-10-01: "targetnya fnb ya, bukan cuma leker".** Sasaran = pemilik usaha
  **F&B** secara umum (kedai kopi, warung/rumah makan kecil, bakery, booth minuman, jajanan),
  bukan hanya Leker atau booth minuman. Teks, contoh isian, dan data demo harus umum F&B.
- **Utama**: pemilik **3–10 gerai F&B kecil** (semula ditulis "minuman/booth"), 1–2 karyawan per gerai, pemilik
  jarang di lokasi, akrab HP dan WhatsApp, **tidak paham akuntansi**.
- **Pengali**: pemilik usaha kemitraan/franchise F&B (satu deal = banyak gerai mitra).
- Pesan jual: **"Gerai jalan, kas jujur, karyawan terpantau — tanpa Anda harus datang."**
- Paket yang dijual dulu: **Paket Kontrol Gerai** (kasir, laci, presensi foto+GPS, permit
  ACC pemilik, stok+HPP dari resep, untung-rugi sederhana, gaji dari presensi, laporan
  presensi/permit). Pembukuan lengkap = paket naik kelas, disembunyikan dulu.

## 2. Temuan yang sudah dibuktikan (dibaca dari kode `main`, 2026-10-01)

Ini titik awal, bukan daftar lengkap — sisir ulang sendiri.

**Kesan "prototype":**
- Judul halaman: `cashier.html` "Prototype Leker · Kasir", `staff.html` "Prototype Leker ·
  Portal Staf", `customer.html`/`index.html` "MAXI Prototype Leker"; halaman lain "MAXI Leker".
- `drawer-report-ui.js:100,168` — teks "Belum ada modul Masak pada prototype ini." tampil di
  laporan laci.
- Variabel global `window.LEKER_STORE_CODE` dan default `G001` di layar masuk — cek apakah
  ada yang tampil ke pengguna.

**Catatan internal developer tampil di layar:**
- `admin-accounting-flow-presets.js:120` — "…canonical `inventory_stock_balances` masih
  store-level… Karen sengaja tidak membuat stok lokasi bayangan."
- `admin-accounting-flow-presets.js:224` — pesan error menyebut "Karen tidak overwrite…".
- `admin.html:59` / `owner.html:59` — "…operasi tersendiri per ADR-030."
- Sisir kata: `Karen`, `Hana`, `ADR-`, `canonical`, `legacy`, `fallback`, `compatibility`,
  `<code>` pada string yang **tampil** (bukan komentar kode).

**Fitur setengah jadi yang terlihat:**
- `admin.html:93` / `owner.html:93` — "rumus earn/redeem belum diaktifkan".
- `cashier-data-explorer.js:174` — tombol "Cari Lanjutan" → toast "segera hadir".
- `customer.html:42` — tombol melayang **🎮 GAME** di halaman pesan pelanggan.
- Panel chat Caca dimuat di `branch-admin.html` dan `entity-admin.html`.

## 3. Target kerja (urut prioritas)

Setiap target punya "selesai kalau". Jangan klaim selesai tanpa bukti di layar
(skill `hana-cara-kerja`), dan ingat: **belum live sebelum digabung ke `main`**.

### T1 — Buang kesan prototype (kecil, dampak terbesar)
- Semua judul/teks yang tampil tanpa kata "Prototype"; merek diambil dari **satu tempat**
  (konfigurasi), karena **nama merek final belum diputuskan Bos Cyo** (kandidat:
  OwnerTenang / PantauGerai / GeraiJujur). Untuk gerai Leker sendiri, tampilan boleh tetap
  "Leker" — merek per tenant, bukan diganti paksa.
- Nol catatan developer di layar. Kalimat penjelasan diganti bahasa pemilik, atau dihapus.
- Nol teks "segera hadir / belum diaktifkan / prototype" — fiturnya disembunyikan (T2), bukan
  diumumkan belum jadi.
- **Selesai kalau**: sisir string tampil di `public/` bersih dari daftar kata di §2, dan
  dicek di layar HP sungguhan untuk kasir, admin gerai, owner, portal staf, halaman pelanggan.

### T2 — Saklar paket per Tenant (sembunyikan, jangan hapus)
Yang disembunyikan untuk tenant baru (default mati; Leker tetap seperti sekarang):
| Fitur | Alasan |
|---|---|
| Asisten AI Caca/Una | akurasi belum diukur; gagal di depan calon pembeli = hilang kepercayaan |
| Tombol GAME / Roda Puter di halaman pelanggan | terlihat seperti mainan |
| Poin pelanggan | saldo selalu 0, terlihat rusak |
| Pendaftaran akun pelanggan | datanya bilang belum laku (11 akun) |
| Menu akuntansi lengkap (jurnal, neraca, Setting Akuntansi, Aturan Transaksi) | menakutkan pemilik kecil; jadi paket naik kelas |

- Gunakan mekanisme yang **sudah ada** dulu: registry modul per Tenant (`ADR-040`,
  `platform_modules`/`tenant_module_installations`, sudah dipakai `GAME`) dan edisi gerai
  LITE/FLEXIBLE/ACCOUNTING. **Belum dicek**: apakah edisi LITE benar-benar menyembunyikan
  semua menu akuntansi di UI — buktikan dulu sebelum membangun saklar baru.
- Menyembunyikan di UI **tidak cukup** kalau endpoint tetap menerima; minimal pastikan menu
  tidak tampil dan tidak ada tautan tersisa. Penolakan server-side boleh menyusul, tapi catat.
- **Selesai kalau**: login sebagai tenant demo baru → fitur di tabel tidak terlihat di mana
  pun; login Leker → semua tetap ada.

### T3 — Layar "Ringkasan Pemilik" (layar jualan utama)
Satu layar, dibuka pertama oleh Owner: per gerai hari ini — omzet, status laci & selisih,
presensi merah/telat/belum absen, **permit menunggu ACC** (bisa langsung ACC dari situ).
- Pakai data yang sudah ada; ini layar ringkasan, bukan laporan baru.
- **Tanpa polling periodik** (invariant #6): refresh manual/on-focus.
- **Selesai kalau**: pemilik bisa menjawab "ada masalah apa hari ini di semua gerai saya"
  dalam < 30 detik tanpa pindah halaman.

### T4 — Pemilik tahu ada permit menunggu
Kontrol tidak jalan kalau pemilik tidak tahu ada yang menunggu ACC. **Belum dicek** apakah
sudah ada pemberitahuan. Kalau belum: minimal penanda jelas di Ringkasan Pemilik; pemberitahuan
ke WhatsApp/push hanya setelah impact assessment (invariant #6, `ADR-048` untuk pola push).

### T5 — Tenant demo
Perusahaan demo dengan 3 gerai, beberapa karyawan, contoh presensi merah, permit menunggu,
selisih laci kecil, penjualan beberapa hari. **Bukan data asli Leker.** Data dibuat lewat
API aplikasi (skill `jalur-akses-leker` — jangan INSERT langsung ke D1). Perlu cara
mengembalikannya ke kondisi awal.

### T6 — Bingkai ulang fitur sensitif (copy, bukan fitur baru)
- Presensi GPS: bahasa "bukti kerja karyawan jujur", bukan "memata-matai".
- Gaji nol saat absen di luar jadwal: di tenant demo **mati**; label "ditandai untuk ditinjau".
- Stok minus: **tetap tampil** (invariant #8, jangan `abs()`), tambah keterangan
  "minus = terjual sebelum pembelian dicatat".

### Menyusul (jangan dikerjakan di sesi ini tanpa izin Bos Cyo)
Halaman depan/landing (menunggu nama merek & domain), panduan awal 15 menit, pasang-ke-layar-
utama (PWA), skor KPI, pendaftaran mandiri, penagihan.

## 4. Pagar

- Semua invariant di `CLAUDE.md` tetap berlaku. Yang paling dekat dengan pekerjaan ini:
  #5 (isolasi `store_id`), #6 (tanpa polling), #8 (saldo/stok negatif bukan bug).
- File `public/*.js` lama yang diubah → **bump `?v=`** di setiap HTML yang memakainya.
- File baru di `src/`/`public/` → tambahkan ke script `check`.
- `npm test` dan `npm run check` sebelum commit.
- Default `CLAUDE.md`: "eksekusi" = pecah jadi task untuk Karen (skill `agent-task-brief`).
  T1 dan T6 kecil dan saling terkait dengan konteks yang sudah dipegang sesi ini — boleh
  dikerjakan sendiri; T2–T5 timbang dilempar.

## 5. Kewajiban lapor balik (penting)

Setiap target yang **sudah live di `main`**, tambahkan **satu baris** di
`HANDOFF-STRATEGI-PENJUALAN.md` §8 (format di sana). Sesi strategi membaca baris itu untuk
memutuskan kapan demo, iklan, atau halaman depan boleh jalan — tanpa harus membaca kode.

## 6. Keputusan yang masih ditunggu dari Bos Cyo

1. Nama merek + domain (mempengaruhi T1 dan landing).
2. Harga paket (tidak menghalangi T1–T6).

## 7. Progres (diisi sesi UI/UX)

### 2026-10-01 — Tenant Lab Tampilan + saklar skin per tenant (permintaan Bos Cyo)

Bos Cyo minta semua perubahan UI/UX **tidak langsung kena semua tenant**: dikerjakan dan
dipilih dulu di satu tenant laboratorium, baru diterapkan ke semua.

- **Tenant baru** `TEN-LAB-TAMPILAN` "Lab Tampilan" (migration 0132): entity
  `ENT-LAB-TAMPILAN`, satu gerai kosong `LAB01` "Gerai Contoh", login pemilik (Entity Admin)
  `lab_pemilik` — password **tidak** ada di repo, sudah diserahkan ke Bos Cyo. Kasir dibuat
  dari Workspace Gerai seperti biasa.
- **Saklar**: kebijakan tenant `ui_skin_siap_jual` (`src/tenant-policy.js`), muncul otomatis di
  Owner Console → Tenant → Kebijakan. Default **OFF** untuk semua tenant; hanya Lab yang ON.
- **Cara kerja**: `GET /api/ui-profile?store=` / `?entity=` (`src/ui-profile.js`) menjawab skin
  dan merek; `public/ui-skin.js` dimuat di kasir, portal staf, workspace gerai, panel pemilik
  (entity-admin), dan halaman pelanggan. Owner Console (pemilik platform, lintas tenant) sengaja
  tidak ikut skin.
- **Koreksi Bos Cyo (2026-10-01, sesudahnya)**: *"yang tadi diminta dari handoff itu kerjakan
  ke semua tenant, perintah sehabis itu baru untuk tenant khusus ini."* Jadi:
  - **T1–T6 di handoff ini berlaku untuk SEMUA tenant (universal)** — tidak di belakang saklar,
    dan **tidak** ada pengecualian merek untuk Leker (koreksi Bos Cyo: "jangan leker doank, itu
    dikerjakan buat universal"). T1 sudah: judul & header tanpa "Prototype"/"Leker", satu merek
    untuk semua dari `PRODUCT_BRAND_NAME` ("MAXI", `src/ui-profile.js`), teks khas Leker di
    halaman pelanggan jadi umum ("Pilih menu", "Belum ada menu yang dipilih"), contoh isian
    Owner Console generik, catatan developer diganti bahasa pemilik (Karen/canonical/stale/
    snapshot/PROVISIONAL/legacy/Renderer), catatan ADR-030 & poin "belum diaktifkan" dihapus,
    tombol "Cari Lanjutan" disembunyikan. Tes `test/ui-skin-tenant-toggle.test.js` menolak
    kata-kata itu kembali. Pengecualian sadar: halaman menu `dermo.html` milik satu gerai Leker.
  - **Saklar `ui_skin_siap_jual` hanya untuk desain "jualan" baru** (permintaan Bos Cyo
    berikutnya) yang diuji di tenant Lab Tampilan sebelum dipilih untuk semua tenant. Desain itu
    selalu di belakang saklar: HTML pakai `data-skin-hide` / `data-skin-only` / `data-skin-text`
    / `data-skin-placeholder`, CSS pakai `html[data-skin="siap-jual"]`, teks JS pakai
    `window.MaxiSkin?.pick(teksLama, teksBaru)`. Yang sudah di belakang saklar: label "Panel Pemilik" di
    panel Entity Admin. Calon skin (A Tenang, B Papan Siaga, C Kabar Gerai) + alasan jualannya
    sedang dipilih Bos Cyo — lihat §8.
- **Belum**: cek layar HP sungguhan, T2–T6.

## 8. Desain "jualan" (khusus tenant Lab, belum untuk umum)

Disusun 2026-10-01 dari sudut pandang penjual: pembeli = pemilik 3–10 gerai F&B (kopi, makanan, minuman, bakery) yang
jarang di lokasi; takutnya kas kurang, titip absen, struk dihapus, bahan bocor, hitung gaji.
Empat momen yang memenangkan demo: (1) Ringkasan semua gerai < 30 detik, (2) kasir minta
hapus → pemilik Setujui/Tolak dari HP, (3) foto absen + lokasi sebagai "bukti kerja jujur",
(4) kasir tiga ketukan. Enam aturan desain: ringkasan dulu; masalah membawa tombolnya; bahasa
pemilik (bukan HPP/permit/saldo kas); warna = status; navigasi di jangkauan jempol (4 tujuan:
Ringkasan, Persetujuan, Karyawan, Laporan); minus tetap tampil.

Tiga calon skin: **A Tenang** (hijau landing page, kartu rapi), **B Papan Siaga** (atas
grafit, sudut tegas, huruf rapat & angka besar), **C Kabar Gerai** (atas hijau toska ala WhatsApp,
kartu berbentuk gelembung).

**2026-10-01, Bos Cyo: "bikin aja ketiga2nya. nanti ada tombol a b dan c dan 0. 0 itu yang
skr."** Sudah dibangun:
- Saklar ON/OFF diganti pilihan kebijakan tenant `ui_skin` = `0`/`A`/`B`/`C` (Owner Console →
  Tenant → Kebijakan → "Tampilan (skin)"). Default `0` untuk semua tenant; Lab mulai di `A`
  (migration 0133). Baris lama `ui_skin_siap_jual` dari 0132 tidak dibaca lagi.
- `/api/ui-profile` menjawab `skin: classic|a|b|c`; `public/ui-skin.js` memasang
  `<html data-skin="a|b|c">`, memuat `/skin-<kode>.css` + hurufnya (Plus Jakarta Sans / Archivo /
  Nunito). Pilihan `0` tidak memuat apa pun.
- `public/skin-a.css`, `skin-b.css`, `skin-c.css` dibangkitkan dari **satu kerangka selektor yang
  sama** (beda hanya token + sedikit aturan khas) — menimpa topbar, merek, tombol, tab, kartu,
  isian, kartu menu, laci, keranjang, hero pelanggan. Tes menolak selektor yang bocor keluar
  `html[data-skin="<kode>"]`.
- Dicek di layar 390 px lewat server lokal: halaman pelanggan, Workspace Gerai, kasir (layar
  presensi), Owner Console pemilih skin.

**Batasnya (jujur):** ini lapisan *tampilan* di atas layar yang ada — warna, huruf, bentuk. Bagian
mockup yang butuh layar baru belum ada di skin mana pun: Ringkasan Pemilik (T3, berlaku untuk semua
tenant), umpan "Kabar" ala chat (C), tabel status semua gerai (B), dan navigasi 4 tujuan di bawah
layar. B sengaja tidak gelap penuh: banyak kartu lama berwarna putih tertanam di kode, jadi latar
gelap penuh akan meninggalkan pulau putih; gelapnya ada di bagian atas/tombol utama.

### 2026-10-02 — Kartu ringkas, menu berkelompok, landing page baru (permintaan Bos Cyo)

- **Kartu daftar (semua tenant):** akar masalah "nama terpotong & keterangan satu kata per baris"
  adalah grid HP `50px | isi` yang dipakai juga oleh kartu tanpa foto. `public/list-cards.css`
  (dimuat sesudah `admin.css`/`cashier-master-panels.css`) mengganti jadi flex: isi memakai lebar
  penuh, nama + keterangan mengalir satu baris dengan pemisah titik, status jadi penanda berwarna
  (`.status-chip ok|warn|bad|off`). Dipakai di daftar tenant/entity (Owner), karyawan, akun,
  rekening, jurnal (Entity).
- **Menu berkelompok (hanya skin A/B/C):** `public/nav-groups.js` menyembunyikan deretan tab lama
  dan menampilkan 7 tombol (Workspace Gerai: Toko, Transaksi, Barang, Tim, Laporan, Keuangan,
  Pelanggan) / 6 tombol (Panel Pemilik) dengan sub-tombol di dalamnya. Tombol asli tetap ada dan
  ditekan lewat `click()`; tab baru dari sesi lain otomatis masuk "Lainnya" — **daftarkan di `GROUPS`
  di file itu**. Skin 0 tidak berubah.
- **Sisa kesan prototype dibersihkan (semua tenant):** tab "Laporan" kosong ("Coming next") di
  Workspace Gerai dicabut; label "Structure level 0/0.5/1" diganti bahasa pemilik.
- **Landing page `/produk/` dirombak:** satu janji ("Gerai jalan. Kas jujur. Anda tenang."), satu
  gambar (HP dengan kejadian gerai), tiga janji, "Sehari bersama kami", F&B umum, satu ajakan.
  Tetap patuh `test/landing-page-claims.test.js` (hanya fitur berstatus JUAL).

<!-- DOC-IMPACT: 2026-10-01 dokumen baru; §7 ditambah: tenant Lab Tampilan + saklar skin per tenant (ui_skin_siap_jual). -->
