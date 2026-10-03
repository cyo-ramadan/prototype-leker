# Skin E — "Jaga Sendiri" untuk warung tanpa karyawan

Ditulis: 2026-10-02 · Oleh: Hana (sesi UI/UX) · Atas permintaan Bos Cyo:
*"di skin d ini user kita nanti ga ada karyawan, jadi yang jadi kasir dan adminnya nanti dia"* →
*"yang kusus ga ada karyawan dibuat skin e"*. Ditambah dua masukan: riset dulu sebelum meniru Shopee,
dan warna pastel supaya *"keliatan ini kasir engga kaku"*.

Skin D = warung yang dijaga bergantian (pemilik + anak/karyawan). **Skin E = pemiliknya sendiri yang
jaga, jadi kasir dan admin.** E satu-satunya skin yang juga mengubah **aturan** (bukan hanya tampilan),
karena aturan yang dibuat untuk mengawasi karyawan tidak ada gunanya kalau tidak ada karyawan.
Aturan uang (penjualan, stok, modal, jurnal) tidak berubah sama sekali.

Katalog semua skin: `DESAIN-SKIN-KATALOG.md`.

---

## 1. Siapa pembelinya

**Bu Rina, 38 tahun, warung kelontong + jajanan di gang perumahan.** Jaga sendirian dari subuh sampai
jam 9 malam, sambil masak dan ngurus anak SD. ±200 jenis barang. Belanja ke grosir naik motor 2× seminggu.
HP Android murah, sering dipakai di teras yang silau. Tidak punya karyawan dan tidak berniat punya.

| Yang terjadi | Yang dia rasakan |
|---|---|
| Uang dapur dan uang warung satu kaleng | "Ramai terus, kok uangnya nggak pernah ada?" |
| Pernah coba aplikasi kasir | Disuruh absen, buka shift, isi karyawan — "ini buat toko besar, bukan saya" |
| Harga grosir naik diam-diam | Rokok tetap dijual harga lama — rugi tanpa sadar |
| Malam capek | Tidak sempat nyatat. Buku tulis berhenti di halaman 4 |
| Belanja ke grosir | Dari ingatan; sering lupa barang yang sudah habis |

**Yang TIDAK dia butuhkan:** izin hapus transaksi (minta izin ke diri sendiri), absen foto + lokasi
(absen ke diri sendiri), dua akun (kasir dan pemilik), laporan per gerai.

## 2. Pembeda (USP)

> **"Jualan seperti biasa. Malamnya tahu untung beneran — tanpa nyatet."**

1. **Untung beneran, bukan omzet** — modal tiap barang dihitung otomatis dari harga beli (mesin modal
   rata-rata yang sudah ada). Angka malam hari = penjualan − modal barang yang terjual − biaya.
2. **Tanpa ribet toko besar** — tidak ada absen, izin, shift, akun pemilik terpisah. Satu login.
3. *(Fase berikut)* **Uang warung terpisah dari uang dapur** dan **tahu kapan belanja / barang yang
   merugi.**

USP skin D "uangnya aman walau ditinggal" **sengaja tidak dipakai** di E: tanpa karyawan tidak ada
yang perlu diawasi, menjualnya tidak jujur.

## 3. Satu hari Bu Rina dengan skin E

| Jam | Yang terjadi | Yang aplikasi lakukan |
|---|---|---|
| 05.30 | Buka rolling door | Layar "Warung masih tutup" → **Buka warung** (satu ketukan). Uang awal otomatis = sisa kemarin. Hari pertama saja ditanya "uang receh di kaleng sekarang". |
| Seharian | Jualan sambil masak | Tab **Jual**: kotak cari di pita atas, "paling sering", ketuk barang, **Bayar**, kembalian besar. |
| Kapan saja | Penasaran hari ini dapat berapa | Tab **Untung**: untung hari ini (sampai sekarang), kemarin, 7 hari, paling laku. |
| 21.00 | Tutup | **Tutup warung**: aplikasi bilang "seharusnya ada di kaleng RpX" → ketik hasil hitung → *Pas / Uang lebih / Uang kurang* → tersimpan, langsung lihat untung hari ini. |

## 4. Yang sudah dibangun (2026-10-02)

**Aturan server — aktif HANYA untuk tenant yang memilih E** (`isOwnerOperatedChoice`,
`src/tenant-policy.js`; dibaca di `requireCashier` sebagai `cashier.store.ownerOperated`):
- Buka laci **tanpa presensi** (`src/cashier-drawer.js`). Tenant lain tetap `PRESENSI_REQUIRED`.
- Pengajuan (arus barang/kas, tutup laci orang lain) **selalu Auto Permit** — tetap tercatat
  `approverRole = AUTO_PERMIT` (`src/approval-queue.js`, `src/cashier-drawer-close-permit.js`).
- **`GET /api/cashier/warung/untung`** (`src/warung-untung.js`): untung hari ini + rincian
  (penjualan, modal, biaya), kemarin, 7 hari, 5 barang paling laku hari ini. Hanya baca, hanya gerai
  sesi kasir itu, menolak `OWNER_OPERATED_ONLY` di tenant lain. Angka dari mesin yang sama dengan
  laporan Untung Bersih (`getNetProfitReport`).

**Layar** — halaman yang sama dengan Mode Warung (`/s/<kode>/warung`), cara pakainya berubah kalau
server bilang `ownerOperated`:
- Buka warung & Tutup warung langsung di layar (tanpa pindah ke Kasir lengkap).
- Bilah bawah **Jual · Untung**. ("Belanja" belum ditampilkan sampai fiturnya jadi — prinsip jujur.)
- Kasir lengkap (`/cashier`) tenant E langsung diarahkan ke layar ini; "Kasir lengkap" tetap ada di
  menu Lainnya untuk hal yang jarang (belanja, biaya).
- Panel Pemilik tetap bisa dibuka (blok "Hari ini" seperti skin D) kalau pemilik suka layar besar.

## 5. Riset warna: ikut Shopee atau tidak?

**Diambil** dari Shopee: pita warna di atas dengan **kotak cari di dalamnya**, kartu barang bergrid,
bilah bawah — pola yang sudah ada di jempol puluhan juta orang Indonesia (Jakob's Law, NN/G: orang
lebih nyaman dengan pola yang sudah biasa mereka pakai).

**Tidak diambil**: latar oranye jenuh penuh dengan teks putih/merah di atasnya.
- Putih di atas oranye Shopee kontrasnya **3,66 : 1**; merah di atas oranye **1,57 : 1**. Batas
  minimum baca (WCAG AA) **4,5 : 1**. Di Shopee teksnya pendek dan dilihat sebentar; kasir dipandangi
  15 jam sehari.
- Latar jenuh di area luas melelahkan mata (UX Movement); pengguna 40+ dan layar di bawah matahari
  butuh kontras lebih tinggi — target **7 : 1** (panduan aksesibilitas untuk lansia / AAA).

## 6. Tampilan "Tenda Warung" (revisi 2026-10-03)

Bos Cyo: *"skin e nya ga jelas banget, masih berantakan banget, engga eyecatching"* — lalu meminta
skill `frontend-design` dipasang. Diagnosis versi pertama: latar krem (justru gaya bawaan AI yang
paling umum), warna kartu bergilir **acak** per urutan (kelihatan berantakan), judul huruf kapital,
tidak ada satu pun elemen yang khas warung.

**Satu elemen berani, sisanya tenang:**
- **Tenda bergaris hijau-putih dengan pinggir bergelombang** di atas papan nama warung — ciri yang
  paling dikenali dari warung mana pun. Hanya di sini keberanian dipakai.
- **Kartu barang = label toples:** putih, "tutup" pastel di atas. Warna tutup ditentukan **kategori
  barang** (barang sejenis selalu sewarna), bukan urutan. Barang di keranjang: tutupnya hijau tua +
  lencana jumlah kuning.
- **Untung = nota:** kertas putih, garis putus di bawah judul, Penjualan − Modal − Biaya, garis
  dobel, lalu **Untung** besar berwarna hijau; pinggir bawah sobek. Dibaca seperti nota warung.
- **Huruf Baloo 2** (bulat, tebal, mirip tulisan papan warung dicat tangan) untuk semua teks.
- Layar "Warung masih tutup" tanpa ikon minimarket; papan nama memberi titik abu-abu saat tutup,
  hijau saat buka.

| Peran | Warna | Kontras teks `#1B2420` |
|---|---|---|
| Latar (sage pucat, bukan krem) | `#EAF2EE` | 13,97 |
| Kartu / nota | `#FFFFFF` | — |
| Tutup toples per kategori | mint `#C9EEDA` · persik `#FFD7C4` · lila `#E0D8FF` · langit `#CBE6FF` · mentega `#FFEFAE` | 11,7–13,8 |
| Tombol utama & angka untung | hijau `#0A5C43` (putih di atasnya) | 8,0 |
| Angka minus | `#9C1C12` di putih | 8,1 |
| Teks pendamping | `#3F4C47` | ≥ 7 |
| Garis tenda | hijau `#7FCBA4` + putih | (dekorasi, tanpa teks) |

Aturan: tidak ada teks putih di atas pastel; tidak ada label huruf kapital; minus tetap minus.
Token: `public/warung.css` (`html[data-skin="e"]`, layar Jual/Untung) dan
`scripts/generate-skin-css.py` (skin `e`, layar lain).

## 7. Fase berikutnya (belum dibangun — jangan dijanjikan ke pembeli)

| Ide | Kenapa | Butuh |
|---|---|---|
| **"Ambil untuk dapur"** | Uang warung terpisah dari uang dapur — akar masalah "uangnya nggak ada" | Keputusan Akuntansi: dicatat sebagai *prive* pemilik, **bukan** setoran karyawan (setoran karyawan membuat piutang karyawan — salah untuk pemilik) |
| **Tab Belanja**: barang mau habis + catat harga beli grosir | Belanja tidak lagi dari ingatan | Batas stok minimum per barang |
| **Tanda "di bawah modal"** saat barang dijual | Harga grosir naik diam-diam | Bandingkan harga jual vs modal terakhir per barang |
| Utang pelanggan (kasbon) + pengingat WA | Masalah nomor satu warung | Modul piutang pelanggan |
| Satu login pemilik (bukan akun kasir) | Sekarang pemilik login sebagai kasir gerai | Akun pemilik yang juga boleh jualan — sentuh auth, perlu ADR |

## 8. Batas yang dijaga

- Hanya tenant yang memilih **E** (Owner Console → Tenant → Kebijakan → Tampilan). Deskripsi
  pilihannya memperingatkan: jangan dipilih kalau tenant punya karyawan (absen & izin jadi tidak
  berlaku).
- Penjualan, stok, modal, jurnal lewat jalur yang sama. Tidak ada tabel atau migration baru.
- Auto Permit tetap tercatat siapa/kapan; koreksi tetap reversal (invariant #2).

<!-- DOC-IMPACT: 2026-10-03 §6 diganti: tampilan "Tenda Warung" (tenda bergaris, label toples per kategori, nota untung, Baloo 2, latar sage). -->
<!-- DOC-IMPACT: 2026-10-02 dokumen baru; skin E (Jaga Sendiri): ui_skin = E, aturan server ownerOperated (tanpa presensi, Auto Permit), endpoint /api/cashier/warung/untung, layar Buka/Tutup warung + tab Untung pastel. -->
