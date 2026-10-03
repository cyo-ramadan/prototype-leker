# Kontrak: alat akuntan Una (v1)

Status: dibuat 2026-10-03 atas arahan Bos Cyo — *"semuanya harus konek dengan akuntansi. Kalau belum
bisa konek karena setelan, nanti aku suruh Una. Alatnya sama dengan alat akuntan orang."*

Dokumen ini untuk sesi yang mengerjakan **koding Una** (perencana, urutan kerja, percakapan). Alatnya
sudah ada dan teruji; yang belum ada adalah Una yang *memutuskan kapan memakainya*. Jangan menambah
jalur tulis baru untuk pekerjaan ini: semuanya lewat alat di bawah.

## Prinsip

1. **Laporan Untung Rugi gerai Akuntansi dibaca dari jurnal** (`ADR-051`). Transaksi yang belum berjurnal
   belum ikut mengurangi/menambah laba. Jadi "beres" berarti: tidak ada transaksi aktif yang berutang jurnal.
2. **Alat Una = layar akuntan.** Setiap alat tulis hanya merangkai endpoint yang sama dengan layar
   (Setting Akuntansi, tombol Sinkron, Hitung Ulang HPP), dengan kredensial si penyuruh. Tidak ada INSERT langsung.
3. **Jurnal posted immutable.** Koreksi lewat jurnal pembalik/koreksi (sudah otomatis di Hitung Ulang HPP).
4. Semua alat tulis lewat **draft "dicek dulu"**; yang diposting persis yang dilihat orang.

## Alat

### Baca (katalog baca, `src/caca-baca-katalog.js`)

| id | Endpoint | Isi |
|---|---|---|
| `jembatan_masalah` | `GET /api/admin/accounting/bridge/issues?store=` | Transaksi aktif yang belum berjurnal, kode penyebab, dan alat yang membereskannya |
| `audit_hpp` | `GET /api/admin/hpp-audit?store=&from=` | HPP janggal + usulan harga berbukti, **berurutan** |
| `setting_akuntansi` | `GET /api/admin/settings/accounting` | (sudah ada) cara bayar, kategori transaksi + aturan jurnal + `completeness`/`blockers` |
| `laba_rugi` | `GET /api/admin/accounting/profit-loss` | (sudah ada) laba rugi **dari jurnal** — alat verifikasi akhir |
| `stok_entity` | `GET /api/admin/entity-stock` | (sudah ada) stok semua gerai; sejak 2026-10-03 tiap sel juga membawa HPP (`averageCost`), acuan median lintas gerai (`hppReference`), dan penanda janggal (`anomaly` NOL/TINGGI/RENDAH) — layar "Lihat HPP" di tab Stok panel Entity memakai data yang sama |

Per gerai, **tanpa fan-out** (berat). Di lingkup entity, panggil gerai satu per satu.

### Tulis (`src/caca-aksi-akuntan.js` + yang sudah ada)

| Alat | Lingkup | Melakukan | Endpoint yang dipakai |
|---|---|---|---|
| `sinkron_akuntansi` | gerai/entity | Mengirim semua yang belum berjurnal (tombol Sinkron) | `POST /api/admin/accounting/bridge/sync` |
| `samakan_aturan_jurnal` | entity | Melengkapi aturan jurnal sebuah kategori dengan menyalin dari gerai yang beres (hanya menambah/mengaktifkan) | `POST/PATCH /api/admin/settings/accounting/journal-rules` |
| `betulkan_klasifikasi_barang` | gerai (bertahap) | Membetulkan Tipe Barang / Jenis Barang / satuan dasar banyak barang sekaligus (layar Master Barang) | `PATCH /api/admin/master/products/editor/:id` |
| `koreksi_hpp_banyak` | gerai (bertahap) | Mengoreksi HPP BANYAK bahan sekaligus dari satu daftar `bahan = harga benar` + tanggal mulai; satu draft, satu "Ya"; urutan daftar dijaga (bahan baku dulu, olahan di belakang). Tiap baris = satu Hitung Ulang HPP biasa | `POST /api/admin/hpp-recalculation[/preview]` + `GET .../components` |
| `atur_cara_bayar` | semua | (ada) hubungkan cara bayar ke akun | `PATCH /api/admin/settings/business/payment-methods/:id` |
| `hitung_ulang_hpp` | gerai | (ada) koreksi HPP bahan + hitung ulang penjualan sejak tanggal; jurnal koreksi otomatis | `POST /api/admin/hpp-recalculation[/preview]` |
| `buat_jurnal` | semua | (ada) jurnal manual balance exact | `POST /api/admin/accounting/journals` |

## Bentuk data penting

`jembatan_masalah`:

```
{ accounting: true|false,
  summary: { owing, byCause: [{ code, count, firstDate, lastDate, amountRupiah, cause }] },
  facts: [{ producer, factType, factId, businessDate, amountRupiah, status, failureCode, failureDetail,
            category, attempts, neverTried, cause: { arti, alat, langkah, parameter? } }],
  hppCorrectionsWaiting, ignored: { voided }, truncated, order: [...] }
```

- `cause.alat` = nama alat Una yang membereskan; `null` = **belum ada alat → laporkan ke Bos Cyo**, jangan menebak.
- `cause.parameter` mis. `{ kategori: 'operational' }` langsung dipakai sebagai `aj_kategori`.
- `ignored.voided`: baris pengiriman lama milik transaksi yang **sudah dibatalkan**. Netral di laba. Abaikan.
  (Bukti 2026-10-03: 6 penjualan "NEEDS_PAYMENT_MAPPING" di BEJI/PENDEM ternyata semuanya dibatalkan.)

`audit_hpp`:

```
{ from, summary, corrections: [{ order, level, kind: 'BAHAN_BAKU'|'OLAHAN', productId, name, unit,
    currentRupiah, proposedRupiah, from, confidence, source: 'PEMBELIAN'|'GERAI_LAIN'|'RESEP',
    needsConfirmation, reason, evidence, after: [productId], command: { alat: 'hitung_ulang_hpp',
    parameter: { hpp_bahan, hpp_harga, hpp_dari } } }],
  needsPrice: [{ name, reason: 'NOL_TANPA_BUKTI'|'BUKTI_BERTENTANGAN'|'BAHAN_BELUM_ADA_HARGA', message }],
  typeIssues: [{ kind: 'TIPE'|'SATUAN', message, items? }], notes: [...] }
```

Harga dikirim sebagai teks dari integer skala (tidak pernah float). `hpp_harga` siap dipakai apa adanya.

## Alur kerja baku: "beresin akuntansi dan HPP dari September"

Urutan ini penting; langkah berikutnya bergantung pada yang sebelumnya.

1. **Baca** `jembatan_masalah` tiap gerai. Catat per kode penyebab.
2. **Bereskan setelan** sesuai `cause.alat`:
   - `NEEDS_MAPPING`/`NEEDS_TRANSACTION_MAPPING`/`NEEDS_FIXED_ACCOUNT`/`NEEDS_COMPONENT_ALLOCATION` → `samakan_aturan_jurnal` (kategori dari `cause.parameter`).
   - `NEEDS_PAYMENT_MAPPING` → `atur_cara_bayar`.
   - `NEEDS_PRODUCT_KIND` → `sinkron_akuntansi` dulu (Jenis Barang kosong di transaksi lama diisi otomatis dari barangnya sekarang); kalau barangnya sendiri belum punya Jenis Barang → `betulkan_klasifikasi_barang` (jenis).
   - `audit_hpp.typeIssues` (tipe/satuan mencurigakan) → `betulkan_klasifikasi_barang` memakai `command.parameter` yang sudah disiapkan. Kerjakan SEBELUM koreksi HPP. Selalu minta konfirmasi Bos Cyo dulu (`needsConfirmation`): ganti satuan hanya mengganti label, stok/HPP/resep tidak dikonversi.
   - `alat: null` → catat dan laporkan (lihat "Belum ada alat").
3. **HPP**: baca `audit_hpp` (`from` = awal September, atau yang Bos Cyo sebut).
   - Terapkan `corrections` **berurutan dari `order` 1**. Satu bahan = `hitung_ulang_hpp` (pratinjau → "Ya"); dua bahan atau lebih = **`koreksi_hpp_banyak`** (satu draft untuk seluruh daftar, `kh_daftar` berurutan + `kh_dari`; tanggal mulai WAJIB disebut, tidak dicari sendiri). Daftar siap tempel per gerai ada di `INSTRUKSI-UNA-HPP-SEPTEMBER.md`. Bahan baku dulu, olahan sesudahnya: harga olahan dihitung dari harga bahan yang sudah benar. Setelah bahan dikoreksi, **baca ulang audit** sebelum olahan, karena usulan olahan ikut berubah.
   - `needsConfirmation: true` (usulan dari gerai lain / bahan belum pasti) → **tanyakan ke Bos Cyo dulu**, jangan langsung diterapkan.
   - `needsPrice` → tanyakan harga yang benar; jangan mengarang.
   - Koreksi mengubah laba harian yang sudah dilaporkan: sebutkan itu di ringkasan.
4. **`sinkron_akuntansi`** (jurnal koreksi HPP dan transaksi mandek ikut terposting).
5. **Verifikasi**: `jembatan_masalah.summary.owing = 0` dan `hppCorrectionsWaiting = 0`; `audit_hpp.corrections` kosong (sisa hanya `needsPrice`/`typeIssues` yang sudah dilaporkan); bandingkan `laba_rugi` (dari jurnal) sebelum/sesudah dan laporkan selisihnya dengan angka.

## Belum ada alat (laporkan, jangan menebak)

| Gejala | Kenapa | Jalan manusia |
|---|---|---|
| `NEEDS_ITEM_CATEGORY_MAPPING` / `*_INVENTORY_MAPPING` | **Tidak ada kasusnya di produksi** (dicek 2026-10-03: nol Jenis Barang tanpa kategori akun; Jenis Barang baru otomatis dapat akun bawaan 1301/5101/4101). Alat sengaja belum dibuat | Setting Akuntansi > Kategori Barang |
| Stok opname / selisih stok | **Akun sudah diputuskan Bos Cyo 2026-10-03** (kurang = Beban Kehilangan Barang, lebih = Pendapatan Penambahan Barang), tetapi jembatan Warehouse→Akuntansi untuk opname **belum dibangun**, jadi belum berjurnal (`KNOWN_ISSUES`) | — |
| Selisih uang laci saat tutup | Sengaja di luar sistem; akuntan jurnal manual | `buat_jurnal` bila diminta |
| Jumlah stok yang salah catat (qty dalam kemasan) | Audit HPP hanya memperbaiki harga | Opname / Penyesuaian Stok |
| Harga bahan tanpa bukti sama sekali (`needsPrice`) | Tidak boleh dikarang | Tanya Bos Cyo, lalu `hitung_ulang_hpp` |

## Batas yang sengaja

- Tidak ada alat yang menghapus atau mengedit jurnal posted, aturan jurnal, atau transaksi.
- `betulkan_klasifikasi_barang` tidak mengubah Jenis Barang kecuali disebut, tidak mengubah harga/nama, dan hanya mengirim konfirmasi ganti satuan untuk baris yang tampil di draft.
- `samakan_aturan_jurnal` menolak menyalin aturan yang memakai pilihan akun (choice group) dan menolak menebak akun yang tidak ada di gerai tujuan.
- `hitung_ulang_hpp` menerapkan satu harga benar sejak tanggal tertentu (bukan harga per hari). Kalau harga bahan sungguh berubah di tengah periode, mulai tanggal koreksi perlu dipilih dengan sadar.
- `koreksi_hpp_banyak` maksimal 30 bahan per draft. Semua nama dan harga diperiksa sebelum pratinjau pertama; harga `4.664` (titik tiga digit) dibaca ribuan seperti `hitung_ulang_hpp`, jadi daftar siap tempel memakai koma desimal.
- Angka uji produksi 2026-10-03 (audit di data asli, hanya baca): MANDALA Air Mineral → Rp0,4375/ml (sama dengan hitungan manual `KOREKSI-HPP-2026-10-02.md`); GENENGAN Gula → ±Rp18,97/g; DERMO Adonan Leker → **berhenti dan bertanya** (bukti saling bertentangan).

## Daftar izin jalur Una (jebakan nyata)

Una hanya boleh memanggil jalur di `PINTU_AKSI` (`src/caca-chat.js`). Alat baru yang memakai jalur BARU wajib
menambahkannya di sana, kalau tidak, di produksi gagal "Jalur ini tidak terdaftar untuk Una" sementara test
dengan jalur palsu tetap hijau. Gelombang pertama alat ini sempat kena (bridge/sync dan journal-rules);
sekarang dijaga test yang memakai `bangunJalurAksi` sungguhan (`test/caca-aksi-akuntan.test.js`,
`test/caca-aksi-klasifikasi.test.js`). Jalur baca otomatis ikut dari `KATALOG`.

## Pengujian

`test/accounting-bridge-issues.test.js`, `test/hpp-audit.test.js`, `test/caca-aksi-akuntan.test.js`, `test/caca-aksi-klasifikasi.test.js`, `test/caca-aksi-hpp-banyak.test.js`, `test/entity-stock.test.js` (HPP lintas gerai).

## DOC-IMPACT

Perbarui saat: kode penyebab baru ditambahkan di `src/accounting-pos-bridge.js`/`src/accounting-admin-bridge.js`,
alat untuk salah satu baris "Belum ada alat" dibuat, ambang audit HPP (`OUTLIER_FACTOR`, `DRIFT_FACTOR`) berubah,
atau bentuk respons dua endpoint baca berubah.
