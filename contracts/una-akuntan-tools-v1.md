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

Per gerai, **tanpa fan-out** (berat). Di lingkup entity, panggil gerai satu per satu.

### Tulis (`src/caca-aksi-akuntan.js` + yang sudah ada)

| Alat | Lingkup | Melakukan | Endpoint yang dipakai |
|---|---|---|---|
| `sinkron_akuntansi` | gerai/entity | Mengirim semua yang belum berjurnal (tombol Sinkron) | `POST /api/admin/accounting/bridge/sync` |
| `samakan_aturan_jurnal` | entity | Melengkapi aturan jurnal sebuah kategori dengan menyalin dari gerai yang beres (hanya menambah/mengaktifkan) | `POST/PATCH /api/admin/settings/accounting/journal-rules` |
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
   - `alat: null` → catat dan laporkan (lihat "Belum ada alat").
3. **HPP**: baca `audit_hpp` (`from` = awal September, atau yang Bos Cyo sebut).
   - Terapkan `corrections` **berurutan dari `order` 1** lewat `hitung_ulang_hpp` (pratinjau → "Ya"). Bahan baku dulu, olahan sesudahnya: harga olahan dihitung dari harga bahan yang sudah benar. Setelah bahan dikoreksi, **baca ulang audit** sebelum olahan, karena usulan olahan ikut berubah.
   - `needsConfirmation: true` (usulan dari gerai lain / bahan belum pasti) → **tanyakan ke Bos Cyo dulu**, jangan langsung diterapkan.
   - `needsPrice` → tanyakan harga yang benar; jangan mengarang.
   - Koreksi mengubah laba harian yang sudah dilaporkan: sebutkan itu di ringkasan.
4. **`sinkron_akuntansi`** (jurnal koreksi HPP dan transaksi mandek ikut terposting).
5. **Verifikasi**: `jembatan_masalah.summary.owing = 0` dan `hppCorrectionsWaiting = 0`; `audit_hpp.corrections` kosong (sisa hanya `needsPrice`/`typeIssues` yang sudah dilaporkan); bandingkan `laba_rugi` (dari jurnal) sebelum/sesudah dan laporkan selisihnya dengan angka.

## Belum ada alat (laporkan, jangan menebak)

| Gejala | Kenapa | Jalan manusia |
|---|---|---|
| `NEEDS_PRODUCT_KIND` | Tidak ada alat pasang Jenis Barang ke barang | Master Barang |
| `NEEDS_ITEM_CATEGORY_MAPPING` / `*_INVENTORY_MAPPING` | Tidak ada alat isi akun Persediaan/HPP per Jenis Barang | Setting Akuntansi > Kategori Barang |
| `typeIssues` TIPE/SATUAN (bahan bertipe Barang Jadi; satuan beda dari gerai lain) | Ganti tipe/satuan memengaruhi stok; butuh konfirmasi manusia | Master Barang (Ganti Satuan, dengan konfirmasi) |
| Stok opname / selisih stok | Sengaja belum berjurnal: akun untung/rugi selisih stok menunggu keputusan Bos Cyo (`KNOWN_ISSUES`) | — |
| Selisih uang laci saat tutup | Sengaja di luar sistem; akuntan jurnal manual | `buat_jurnal` bila diminta |
| Jumlah stok yang salah catat (qty dalam kemasan) | Audit HPP hanya memperbaiki harga | Opname / Penyesuaian Stok |

## Batas yang sengaja

- Tidak ada alat yang menghapus atau mengedit jurnal posted, aturan jurnal, atau transaksi.
- `samakan_aturan_jurnal` menolak menyalin aturan yang memakai pilihan akun (choice group) dan menolak menebak akun yang tidak ada di gerai tujuan.
- `hitung_ulang_hpp` menerapkan satu harga benar sejak tanggal tertentu (bukan harga per hari). Kalau harga bahan sungguh berubah di tengah periode, mulai tanggal koreksi perlu dipilih dengan sadar.
- Angka uji produksi 2026-10-03 (audit di data asli, hanya baca): MANDALA Air Mineral → Rp0,4375/ml (sama dengan hitungan manual `KOREKSI-HPP-2026-10-02.md`); GENENGAN Gula → ±Rp18,97/g; DERMO Adonan Leker → **berhenti dan bertanya** (bukti saling bertentangan).

## Pengujian

`test/accounting-bridge-issues.test.js`, `test/hpp-audit.test.js`, `test/caca-aksi-akuntan.test.js`.

## DOC-IMPACT

Perbarui saat: kode penyebab baru ditambahkan di `src/accounting-pos-bridge.js`/`src/accounting-admin-bridge.js`,
alat untuk salah satu baris "Belum ada alat" dibuat, ambang audit HPP (`OUTLIER_FACTOR`, `DRIFT_FACTOR`) berubah,
atau bentuk respons dua endpoint baca berubah.
