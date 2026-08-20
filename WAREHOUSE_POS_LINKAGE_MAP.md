# Peta keterhubungan Warehouse (stok/HPP) ke POS

Dikerjakan oleh: Hana, atas permintaan Bos Cyo 2026-08-20 — audit lanjutan dari `ADR-036`
§3, sebelum implementasi pemisahan Warehouse dimulai. Referensi teknis, bukan keputusan —
untuk keputusan arah baca `POS_MODULE_INDEPENDENCE.md` dan `ADR-036`.

## Peringatan lebih dulu: dua "Warehouse" yang beda, satu nama

Ada **dua fitur berbeda** yang sama-sama dipanggil "Warehouse" di kode:

1. **Warehouse = lokasi gudang** (`warehouses`, `warehouse_access`,
   `warehouse_stock_opname_settings`) — fitur multi-lokasi/multi-cabang. **Bukan** yang
   dimaksud di sini.
2. **Warehouse = pelacakan stok & HPP** (`average_cost`, `stock_movements`, dst.) — **ini**
   yang dimaksud sepanjang dokumen ini dan `ADR-036`.

Beberapa layar bahkan literally menulis kata **"Warehouse"** buat merujuk ke yang nomor 2
(dialog Produksi kasir, dialog Penyesuaian Stok) — jadi campur aduknya bukan cuma di kode,
di UI juga. Kalau ke depan mau dipisah beneran, ini juga alasan buat ganti istilah di UI
supaya gak membingungkan pas dua-duanya sama-sama ada.

## Ringkasan buat Bos Cyo

Dari 15+ file yang nyentuh data stok/HPP, sebagian besar itu cuma layar **laporan** (Admin
lihat data stok, lihat detail transaksi) — itu aman, gampang, tinggal disembunyikan kalau
Warehouse dimatikan.

Yang beneran susah ada **empat titik**, karena mereka nyatu langsung ke proses kasir
menyimpan transaksi, bukan sekadar nampilin data belakangan:

1. **Jualan (Sale)** — tiap barang yang laku, sistem langsung itung HPP-nya dari data stok
   di baris yang sama dengan nyimpen penjualannya. Kalau Warehouse dimatikan tanpa
   penggantinya, HPP-nya jadi kosong/nol.
2. **Pengurangan stok pas jualan** — sistem juga langsung ngecek & ngurangin stok pas
   barang laku, dan **bisa nolak transaksi** ("stok tidak cukup") kalau stoknya gak
   cukup. Ini yang paling riskan — kalau Warehouse mati tapi bagian ini gak ikut
   dimatikan, transaksi kasir bisa ketolak padahal harusnya gak perlu ngecek stok sama
   sekali.
3. **Beli Bahan (Purchase)** — ternyata dialog belinya **cuma nampilin barang yang
   memang di-declare "dilacak stoknya"**. Kalau Warehouse dimatikan (declare-nya jadi
   nol), dialog Beli Bahan bakal keliatan **kosong** — bukan pindah ke mode "catat
   sebagai beban langsung", tapi beneran gak ada barang yang bisa dibeli. Ini bug diam-diam
   yang bakal muncul kalau gak sengaja ditangani.
4. **Produksi** — seluruh fitur Produksi di kasir (hitung bahan jadi barang jadi) memang
   dirancang di atas data stok & HPP. Tanpa Warehouse, fitur ini kehilangan alasan untuk
   ada — bukan tinggal disembunyikan, tapi definisi fiturnya sendiri perlu dipikir ulang.

Tiga dialog di kasir (Produksi, Beli Bahan, Penyesuaian Stok) juga eksplisit nulis kata
"Warehouse" di teks UI-nya sendiri — jadi begitu Warehouse dimatikan, tiga tombol/dialog
ini yang pertama harus disembunyikan dari kasir.

## Peta lengkap — file per file

### Jalur kasir langsung (berhenti/berubah kalau Warehouse dicabut tanpa pengganti)

| File | Nyentuh apa | Kenapa riskan |
|---|---|---|
| `src/cashier-sales-tracking.js` | Nulis HPP tiap baris jualan langsung dari `average_cost`; manggil modul pengurangan stok | **Paling sentral.** Ini titik utama yang perlu dirancang ulang. |
| `src/stock-production.js` | Ngurangin/nambah stok tiap ada jualan barang yang dilacak; bisa nolak transaksi kalau stok gak cukup | Mesin pengurangan stok — dipanggil di request yang sama dengan nyimpen jualan |
| `src/cashier-purchase.js` | Dialog Beli Bahan cuma nampilin barang yang di-declare dilacak stoknya; nulis rata-rata harga | Kalau declare-nya nol, dialog Beli Bahan keliatan kosong total |
| `src/warehouse-production.js` | Mesin hitung stok & HPP produksi manual | Fitur Produksi gak punya arti tanpa ini |
| `src/accounting-pos-bridge.js` + `accounting-pos-bridge-response.js` | Baca HPP buat bikin baris jurnal Akuntansi | Sudah gagal-tertutup dengan benar (nolak posting kalau HPP kosong) — ini **sudah aman**, gak perlu diperbaiki |
| `src/operational-posting.js` + `src/approval-queue.js` | Proses persetujuan Penyesuaian Stok | Seluruh jenis pengajuan ini gak ada gunanya tanpa Warehouse |

### Layar Admin/laporan (aman, tinggal disembunyikan)

`src/product-master.js`, `src/product-policy.js`, `src/admin-stock.js`,
`src/admin-production-detail.js`, `src/admin-purchase-detail.js`,
`src/admin-transaction-detail.js`, `src/debugger-control-plane.js` — semuanya cuma
**baca** data buat ditampilkan, gak ada yang nge-block proses apa pun. Kalau Warehouse
mati, layar-layar ini tinggal nampilin kosong/nol, bukan error.

`src/transaction-correction-executor.js` beda sendiri — dia bagian dari alur pembatalan
transaksi (void/koreksi), bukan transaksi baru. Sama riskannya kayak kelompok pertama,
tapi cuma kepakai kalau ada yang membatalkan transaksi lama.

### Tiga dialog kasir yang eksplisit nulis "Warehouse" di layarnya

- `public/cashier-stock-adjustment-pilatu.js` — dialog Penyesuaian Stok
- `public/cashier-production-v2.js` — dialog Produksi
- `public/cashier-procurement-ui.js` — dialog Beli Bahan

## Daftar tabel/kolom yang beneran kepakai

| Tabel | Kolom |
|---|---|
| `products` | `average_cost`, `stock_tracking_enabled`, `cost_updated_at`, `last_purchase_price`, `last_purchase_at` |
| `stock_movements` | semua kolom |
| `inventory_stock_balances` | `quantity`, `updated_at` |
| `inventory_ledger_entries` | semua kolom |
| `sale_items` | `line_cogs`, `unit_cost_snapshot` |
| `purchase_items` | `unit_cost`, `average_cost_before`, `average_cost_after` |
| `production_runs` | `hpp_total`, `hpp_per_unit`, dan versi scaled-nya |
| `production_run_components` | `unit_cost_snapshot`, `total_cost_snapshot`, dan versi scaled-nya |

## DOC-IMPACT

Perbarui kalau ada file baru yang mulai menyentuh tabel/kolom di atas, atau kalau
pemisahan Warehouse (`ADR-036`) mulai diimplementasikan — tandai tiap file di atas yang
sudah selesai digating.
