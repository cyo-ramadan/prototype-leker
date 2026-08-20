# ADR-037 — Modul Manufaktur: satu tempat HPP dibentuk, wajib ada, POS cuma nyambung

Status: PROPOSED — arah disetujui Bos Cyo 2026-08-20, detail implementasi belum ditulis.
Date: 2026-08-20
Change ID: `MAXI-MANUFACTURE-COSTING-AUTHORITY-20260820`
Dikerjakan oleh: `hana1.1` — arsitektur, atas usulan Bos Cyo

## 1. Context — dua temuan berbeda, satu jawaban

**Temuan pertama**, dari audit Karen 2026-08-18 (issue #88, task papan `T-0818-04`):
`products.average_cost` adalah **satu baris yang ditimpa**, ditulis dari enam tempat
berbeda (`cashier-purchase.js`, `cashier-sales-tracking.js`, `stock-production.js`,
`admin-purchase-detail.js`, `product-master.js`, `transaction-correction-executor.js`).
Kalau angkanya salah, tidak ada yang bisa menjawab *kapan* dan *karena fakta apa*. Hana
setuju arahnya — HPP authority dipusatkan, jadi satu domain Inventory/Costing — tapi
ADR-nya belum sempat ditulis. Issue itu masih terbuka, sengaja tidak ditutup dengan janji
baru (lihat komentar 2026-08-20 di sana).

**Temuan kedua**, dari usulan Bos Cyo 2026-08-20 (`POS_MODULE_INDEPENDENCE.md`,
`WAREHOUSE_POS_LINKAGE_MAP.md`): supaya POS bisa berdiri sendiri, "cara HPP dibentuk"
perlu jadi modulnya sendiri — **Manufaktur** — yang wajib nempel di setiap turunan POS
(beda dari Accounting/Warehouse yang boleh dicabut), fokusnya cuma satu: menjawab "berapa
HPP barang ini", dengan cara yang bisa beda-beda per gerai (beli-langsung buat retail,
resep/rata-rata buat yang butuh, dan mode lain di masa depan — Bos Cyo mencontohkan
dropship, HPP langsung sama dengan harga beli).

Dua temuan ini **jawabannya sama**: HPP butuh satu domain otoritatif, bukan enam
penulis lepas. ADR ini menutup `T-0818-04` sekaligus menulis rancangan Manufaktur.

## 2. Decision

### 2.1 Manufaktur menyerap Produksi, bukan berdiri di sampingnya

Bos Cyo eksplisit: "nyerap aja". Mesin resep/BOM yang sudah ada
(`manufacturing_recipes`, `stock-production.js`, `warehouse-production.js`, `ADR-035`)
**menjadi inti Manufaktur**, bukan sistem kedua yang berjalan paralel. Fitur "Produksi"
yang kasir pencet hari ini — masak bahan jadi barang jadi — jadi **satu mode pemakaian**
Manufaktur, bukan modul terpisah. `ADR-035` tidak dibatalkan; logikanya (recipe
immutable, HPP snapshot dari kuantitas aktual, net-based inventory-account transfer)
tetap berlaku persis, cuma **posisinya** yang pindah ke dalam batas modul Manufaktur.

### 2.2 Cara pindahnya — angkat organnya, jaga pembuluh darahnya

Metafora Bos Cyo, ditulis jadi aturan kerja: HPP/costing yang sekarang nempel **di
dalam** kode POS (bukan dipanggil dari luar) diangkat keluar satu-satu, tapi jalur
datanya tidak boleh putus di tengah jalan — sisa yang tertinggal di sisi POS jadi
**konektor tipis** (satu pemanggilan fungsi/HTTP), bukan logikanya sendiri. Ini **pola
yang sama** yang sudah terbukti jalan buat Accounting (`ADR-034` §2: dispatch
post-commit, satu titik panggil, resolver tidak berubah) — bedanya Manufaktur wajib
selalu dipanggil, Accounting boleh tidak.

Titik yang harus diangkat, sudah dipetakan `WAREHOUSE_POS_LINKAGE_MAP.md`:

| Organ yang diangkat | Sekarang di mana | Konektor yang tersisa |
|---|---|---|
| Hitung HPP baris jualan | SQL inline di `cashier-sales-tracking.js` (`buildSaleStatements`, baca `p.average_cost` langsung) | Panggil Manufaktur, minta HPP buat baris itu |
| Rata-rata biaya pembelian | SQL inline di `cashier-purchase.js` (rumus moving average ditulis langsung di query) | Panggil Manufaktur, kirim data pembelian, terima HPP baru |
| Pengurangan stok + HPP produksi manual | `stock-production.js` (`prepareSaleStockProduction`), `warehouse-production.js` (`prepareManualProductionV2`) | Panggil Manufaktur buat bagian HPP-nya; bagian kuantitas stok tetap topik terpisah (§2.3) |

**Tidak dikerjakan sekaligus.** "Pelan-pelan" — tiap organ diangkat sebagai perubahan
sendiri, diuji sendiri, tanpa menunggu semuanya pindah baru boleh deploy. Sama disiplin
yang sudah dipakai `ADR-033`/`ADR-034`/`ADR-036`: satu PR, satu potongan, hijau sendiri.

### 2.3 Manufaktur (wajib) ≠ Warehouse kuantitas stok (opsional) — dua sumbu, bukan satu

`ADR-036` sebelumnya menganggap Warehouse satu saklar. Ternyata Warehouse itu dua hal
yang kebetulan nempel jadi satu: **menghitung HPP** (Manufaktur, ADR ini, wajib) dan
**melacak sisa kuantitas** (`stock_movements`/`inventory_stock_balances`, tetap opsional,
tetap dibahas `ADR-036`).

Keduanya **tidak sepenuhnya independen** — perlu jujur di sini, bukan disederhanakan:
mode "resep/rata-rata" Manufaktur butuh angka kuantitas dari Warehouse sebagai input
rumus moving average. Tapi mode paling dasar Manufaktur — **HPP langsung dari harga
beli, tanpa rata-rata** — tidak butuh kuantitas apa pun. Itu yang membuat Manufaktur bisa
wajib-ada-tapi-ringan: default-nya jalan tanpa Warehouse sama sekali, dan jadi lebih
kaya (rata-rata biaya, snapshot produksi) begitu Warehouse hadir.

`ADR-036` perlu direvisi mengikuti pembagian ini — tugasnya menyempit jadi murni soal
kuantitas stok, bukan lagi membawa HPP.

### 2.4 Mode bisa nambah tanpa ubah kode POS

Pola `source_type` di `journal_rules` (`ADR-033`) dipakai ulang: Manufaktur punya
semacam "mode resolusi HPP" per gerai — `DIRECT_FROM_PURCHASE` (retail, default),
`RECIPE_WEIGHTED_AVERAGE` (butuh Warehouse), dan slot buat mode berikutnya (Bos Cyo
mencontohkan dropship: HPP baris jualan = harga beli baris itu sendiri, tanpa
rata-rata). Mode baru berarti nambah satu cabang di dalam Manufaktur — bukan mengubah
`cashier-sales-tracking.js`/`cashier-purchase.js` lagi, karena keduanya sudah jadi
konektor tipis sejak §2.2.

### 2.5 Invariant HPP snapshot — dikonfirmasi Bos Cyo, berlaku di dua tempat

> "dalam data penjualan HPP itu snapshot, bahkan di data jurnal juga. ketika HPP
> berubah, di data transaksi waktu tanggal sebelumnya gak berubah, perubahan HPP
> ngefek pada transaksi sesudahnya saja."

Ini bukan aturan baru — persis `ADR-031`/`ADR-035` (HPP produksi = snapshot kuantitas
aktual saat posting, reversal menyalin bukan resolve ulang) — ADR ini menegaskan
berlaku di **kedua** tempat: baris `sale_items`/`production_run_components` **dan**
baris `accounting_journal_lines`. Manufaktur tidak boleh dirancang sebagai fungsi yang
dipanggil ulang tiap kali laporan dibuka — hasilnya ditulis sekali saat posting, dibaca
apa adanya sesudah itu.

Konsekuensinya ke bentuk data: kalau `average_cost` yang sekarang (satu baris ditimpa)
diganti jadi ledger append-only seperti usul Karen di #88 — itu **memperkuat** invariant
ini, bukan mengubahnya. Ledger menjelaskan *kenapa* HPP hari ini segini; snapshot di
`sale_items`/jurnal tetap yang menentukan angka transaksi lama.

## 3. Consequences

- `T-0818-04` dan issue #88 **ditutup**, menunjuk ke ADR ini sebagai jawabannya.
- `ADR-036` perlu direvisi: lingkupnya menyempit ke kuantitas stok saja, HPP pindah ke
  ADR ini.
- `ADR-035` tidak berubah isinya, cuma posisi organisasinya — logikanya jadi bagian dari
  Manufaktur, bukan modul Warehouse yang berdiri sendiri.
- Fitur Produksi yang kasir pakai hari ini **tidak berubah perilaku** selama migrasi —
  yang berubah cuma di file mana logikanya hidup.

## 4. Open — milik Bos Cyo, sebelum implementasi mulai

1. **Bentuk `average_cost`** — tetap satu baris ditimpa (lebih sederhana, resiko sama
   seperti sekarang), atau sekalian jadi ledger append-only (usul Karen di #88, lebih
   besar kerjaannya tapi nutup masalah jejak sekaligus)? Bisa dua fase terpisah — bentuk
   modul Manufaktur dulu, ledger menyusul — supaya tidak digabung jadi satu perubahan
   raksasa.
2. **Nama file/struktur baru** — `src/manufacture-costing.js` (atau nama lain) sebagai
   titik masuk tunggal, menggantikan pemanggilan langsung ke `stock-production.js`?
   Detail teknis, tidak menentukan arah, tapi perlu disepakati sebelum implementer
   (Karen/dkk) mulai supaya tidak dua nama berbeda untuk hal yang sama.
3. **Urutan kerja** — ADR ini duluan (karena `ADR-036` bergantung ke revisinya), atau
   paralel dengan sisa `ADR-034`/`ADR-036` seperti prinsip yang sudah disepakati
   (`CLAUDE.md` — task boleh paralel kalau barrier-nya aman)?

## 5. Related

- `ADR-031` — HPP produksi = snapshot, reversal menyalin
- `ADR-032` — semantik Inventory → Accounting
- `ADR-034` — pola gating satu titik panggil, dipakai ulang di §2.2
- `ADR-035` — mesin eksekusi Produksi yang diserap, tidak diubah isinya
- `ADR-036` — direvisi menyempit ke kuantitas stok, lihat §2.3
- `ADR-033` — pola mode/pilihan yang bisa nambah tanpa ubah kode pemanggil, dipakai ulang §2.4
- `POS_MODULE_INDEPENDENCE.md`, `WAREHOUSE_POS_LINKAGE_MAP.md` — peta dan visi yang jadi latar ADR ini
- Issue #88, task papan `T-0818-04` — ditutup oleh ADR ini

## DOC-IMPACT

**REQUIRED** — `ADR-036` perlu ditandai direvisi (bukan ditulis ulang) menunjuk ke ADR
ini. `POS_MODULE_INDEPENDENCE.md` tabel status dan peta modul diperbarui.
