# Known Pitfalls — Prototype Leker

## Periodic cashier polling

**Pitfall:** Jangan menjalankan polling periodik untuk queue order dan status laci pada prototype ini.

Polling beberapa detik sekali dari setiap tab kasir membuat request Worker/D1 bertambah terus walaupun tidak ada perubahan. Membuka lebih dari satu tab menggandakan traffic tersebut dan dapat memperburuk error quota/network tanpa memberi nilai operasional yang sebanding.

**Current strategy:**

- Dashboard kasir memuat menu, order, dan status laci saat dibuka.
- Tidak ada periodic `setInterval` refresh yang aktif.
- Kasir mempunyai tombol **Refresh Pesanan** untuk refresh manual.
- Order dan status laci direfresh ketika tab kembali visible atau window kembali focus.
- Action kasir yang mengubah state tetap memperbarui state terkait setelah request selesai.
- Error network/quota tidak boleh dianggap sebagai session expiry. Session hanya dilepas pada response auth yang benar-benar menyatakan session tidak valid.

Jika realtime otomatis dibutuhkan nanti, gunakan mekanisme push yang disetujui dan diuji, misalnya WebSocket/SSE, bukan mengembalikan polling rapat tanpa impact assessment.

## Recipe bukan HPP final

**Pitfall:** Jangan menghitung HPP manufaktur hanya dari recipe aktif dikali `products.purchase_price` terbaru.

Cara itu merusak historical costing karena harga bahan dapat berubah setelah produksi terjadi, recipe dapat mempunyai revision baru, dan actual consumption/yield dapat berbeda dari standar recipe.

**Current strategy:**

- Recipe/BOM disimpan sebagai immutable revision.
- Production snapshots exact scaled component cost and production-run HPP when posting.
- Inventory/Costing memiliki ownership valuation.
- Accounting memiliki ownership journal interpretation dan financial statements.

## HPP tidak boleh kembali ke REAL/FLOAT

**Pitfall:** Jangan menyimpan atau menghitung authoritative Average Cost, Harga Beli Terakhir, sale COGS, production HPP, atau journal amount baru menggunakan SQLite `REAL`, JavaScript floating-point sebagai source of truth, atau SQL `* 1.0`.

**Current strategy:**

- current exact cost and Accounting journal scale = `1,000,000` units per rupiah;
- authoritative new cost/journal fields are scaled INTEGER;
- Accounting accepts maximum 6 fractional decimal places and rounds half-up at digit 7;
- UI/API converts scaled values only for presentation;
- legacy production REAL fields from migration 0017 are history fallback only dan new writers leave them NULL.

## Saldo negatif bukan jurnal tidak balance

**Pitfall:** Jangan mengubah saldo akun negatif menjadi positif memakai `abs()` hanya supaya UI terlihat rapi, dan jangan menganggap saldo negatif otomatis berarti jurnal invalid.

**Current strategy:**

- journal-line amount tetap positif dengan sisi `DEBIT`/`CREDIT` explicit;
- integrity posting = total Debit dan total Credit balance sesuai policy;
- General Ledger / Rugi Laba / Neraca mempertahankan sign saldo akun;
- investigasi saldo negatif dilakukan sebagai business/accounting review, bukan disamarkan oleh formatter.

## Toleransi Penyesuaian bukan karpet error

**Pitfall:** Jangan memakai akun `Penyesuaian` untuk membuat semua jurnal yang salah menjadi balance.

**Current strategy:**

- hanya command non-manual yang explicit meminta `AUTO_EQUITY_UP_TO_100_RUPIAH` yang boleh auto-adjust;
- maximum difference = `Rp100.000000`;
- difference lebih besar harus fail closed;
- manual journal wajib balance exact;
- line otomatis ditandai system-generated dan masuk dedicated Equity `Penyesuaian`, bukan akun Modal utama.

## Stok minus tidak boleh diam-diam diserap HPP baru

**Pitfall:** Kalau balance stok sudah negatif karena anomaly/history, jangan menganggap purchase baru otomatis memperbaiki integritas costing.

Current purchase logic mempunyai compatibility behavior saat stok `<= 0` yang dapat memakai unit cost pembelian terbaru sebagai baseline Average Cost. Policy store-level yang direncanakan akan dapat memblok purchase ketika current stock `< 0` supaya anomaly diperbaiki dulu.

**Guard:** jangan mengaktifkan policy blok tersebut sebelum Penyesuaian Stok write flow tersedia. Kalau tidak, item minus dapat terkunci: purchase ditolak tetapi user tidak punya approved path untuk mengoreksi saldo.

Ownership policy tetap Inventory/Costing, walaupun toggle boleh surfaced dari shared Settings UI.

## Qty operasional bukan stock movement

**Pitfall:** Jangan menganggap `expenses.quantity` sebagai inventory consumption hanya karena user mengisi Qty pada Pengeluaran Operasional.

Qty tersebut adalah customer-behaviour metadata. Inventory moves only through an explicit inventory-owned movement contract. Jika suatu operasional memang memakai barang stok, link ke inventory must be an explicit future flow rather than inferred from description or quantity.

## Transaction explorer bukan source of truth

**Pitfall:** Jangan menulis ulang transaksi melalui Admin Transaction Explorer atau menjadikannya ledger kedua.

Explorer hanya read model dengan `sourceReference`. Perubahan transaksi tetap harus lewat module pemilik business fact. Detail jurnal juga tidak boleh dipindahkan ke Admin.

## Journal Rules bukan journal-generation engine

**Pitfall:** Status `Lengkap` pada `transaction_categories` tidak berarti transaksi boleh langsung dibuatkan jurnal.

`Lengkap` hanya membuktikan ada minimal satu Debit dan satu Kredit aktif. Posting masih wajib resolve payment method aktual, Jenis Barang transaksi, amount, direction/subtype, period, tenant/store context, idempotency, dan contract Accounting. Jangan membuat fallback account ketika source rule tidak bisa di-resolve.

## Warehouse tidak boleh punya mapping akun tandingan

**Pitfall:** Jangan membuat `warehouse_account_mapping`, account dropdown di Warehouse Settings, atau hardcoded akun di kode Warehouse.

Warehouse mendaftarkan financially-relevant transaction types ke `transaction_categories` milik Accounting Settings. Akun/rule kemudian dikonfigurasi dari Module A. Ini mencegah dua source of truth yang bisa menghasilkan interpretasi jurnal berbeda.

## Stock Opname tidak boleh menjalankan semua default rules

**Pitfall:** `wh_opname` memiliki labeled gain dan loss rows. Future journal engine tidak boleh mengeksekusi keempat row sekaligus.

Signed stock adjustment harus menentukan branch gain atau loss secara explicit. `4201 Pendapatan Koreksi Stok` dan `6103 Beban Susut Persediaan` juga tetap berstatus `review_required` sampai pemilik bisnis menyetujui penggunaannya.

## Retur harus fail-closed sampai arah transaksi jelas

**Pitfall:** Jangan menggunakan satu jurnal default untuk semua `wh_return`.

Customer return, supplier return, dan internal return dapat mempunyai arah inventory/settlement berbeda. `wh_return` sengaja terdaftar tanpa journal rule sampai subtype/direction disepakati.

## Legacy pair mapping tidak boleh hidup kembali

**Pitfall:** Jangan menghidupkan kembali `accounting_account_refs` + `transaction_accounting_mappings` sebagai engine paralel terhadap `chart_of_accounts` + `journal_rules`.

Compatibility endpoint pair-mapping sudah dipensiunkan. Semua konfigurasi baru memakai `MAXI_ACCOUNTING_SETTINGS_V1`, sedangkan `transaction_accounting_snapshots` hanya menyimpan readiness evidence dan tidak berisi pasangan debit/kredit palsu.

## Parallel Chart of Accounts tidak boleh lahir dari out-of-band schema

**Pitfall:** Jangan membuat, menerapkan, atau mempertahankan tabel account registry paralel di luar canonical repository migration flow. Untuk Prototype Leker, `chart_of_accounts` adalah satu-satunya tabel definisi Chart of Accounts yang aktif.

Pada audit 2026-08-17, live D1 mempunyai `accounting_accounts`, `accounting_dimensions`, `accounting_opening_balances`, dan `accounting_transaction_mappings`, sementara current `main` tidak mempunyai migration atau active code path yang memakai empat tabel tersebut. Definisi schema yang sama ditemukan di unmerged PR #3 commit `65b3faa0b130f9ecbbf21b9a592f9dcf376f8cec`, file `migrations/0012_pos_integration_foundation.sql`. Handoff 2026-08-13 sudah menandai PR #3 sebagai stale overlapping Accounting architecture dan melarang merge wholesale.

**Root cause:** schema live menerima artifact dari jalur di luar canonical `main` migration flow. Repository history tidak membuktikan command/operator yang menjalankan perubahan itu, jadi jangan mengarang provenance lebih jauh dari evidence tersebut.

**Prohibited regression behavior:**

- jangan menjalankan migration/file schema dari unmerged/stale branch ke live D1;
- jangan membuat `accounting_accounts` atau tabel lain yang mendefinisikan ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE sebagai registry kedua;
- jangan membuat duplicate account/mapping engine untuk mengejar compatibility cepat;
- jangan drop artifact finansial tanpa pre-drop snapshot dan recovery point.

**Correct pattern:**

- `chart_of_accounts` tetap sole canonical COA registry;
- `journal_rules` dan active Accounting Settings contract mengatur mapping/configuration;
- `accounting_journal_lines.account_id` tetap menuju `chart_of_accounts`;
- migration `0037_accounting_schema_reconciliation.sql` membackup row orphan sebelum drop dan mencatat row count;
- `scripts/verify-remote-schema.mjs` harus fail closed bila exact orphan names atau second five-type COA table muncul lagi;
- semua production schema change harus melalui PR + versioned migration tied to `main` dan canonical deployment road.

Audit evidence lengkap ada di `ACCOUNTING_SCHEMA_RECONCILIATION_AUDIT_20260817.md`.

## Operasional tidak boleh memiliki foreign key ke interpretasi Accounting

**Pitfall:** Jangan menyimpan `journalRuleId`, Account ID, atau Accounting mapping identity sebagai foreign key/authority di tabel business application seperti `expenses` atau master Operasional.

**Root cause:** Operasional pernah menyimpan `expenses.accounting_component_rule_id -> journal_rules(id)` dan Cost Master menyimpan dependency yang sama melalui `cost_types.accounting_component_rule_id`. Walaupun jurnal akhirnya tetap diposting oleh Accounting POS Bridge, schema Operasional sudah membawa keputusan interpretasi Accounting ke domain yang salah.

**Prohibited regression behavior:**

- tidak ada tabel business application yang boleh foreign-key langsung ke `journal_rules`, `chart_of_accounts`, `accounting_account_refs`, atau `transaction_accounting_mappings`;
- handler Operasional tidak boleh menerima `journalRuleId`, Account ID, pasangan Debit/Credit, atau fallback account sebagai business input;
- Cost Master/Jenis Biaya tidak boleh menjadi proxy untuk memilih rule/account Accounting;
- jangan membuat resolver/outbox paralel hanya untuk menghindari boundary check.

**Correct pattern:**

- Operasional menyimpan business fact miliknya: jenis/konteks biaya, amount, Qty metadata, payment method, dan business event `EXPENSE`;
- transaksi memakai current canonical shared post-commit Accounting Bridge lane yang juga dipakai SALE/PURCHASE;
- Bridge membaca `transaction_categories`, `journal_rules`, payment mapping, dan Setting Akuntansi lain untuk interpretasi jurnal;
- `transaction_accounting_snapshots` tetap readiness/configuration evidence, bukan pasangan akun tandingan;
- konfigurasi Accounting yang ambigu harus fail closed; Operasional tidak boleh memecahkan ambiguity dengan memilih rule Accounting.

Migration `0038_operational_accounting_boundary.sql` menghapus direct FK tersebut dan menyimpan legacy selector hanya sebagai recovery evidence.

## Migration ledger tidak membuktikan schema object lengkap

**Pitfall:** Jangan menganggap row pada tabel migration D1 otomatis membuktikan semua table/index/trigger yang pernah didefinisikan migration tersebut masih ada di remote database.

Insiden deployment Accounting 2026-08-13 membuktikan remote D1 dapat mempunyai migration ledger yang menyatakan `0018` sudah applied sementara dua compatibility table dari migration itu tidak ada. Migration `0023` kemudian gagal saat mencoba mengubah object yang hilang.

**Current recovery discipline:**

- ketika remote migration gagal karena missing/shape-mismatched object, inspect `d1 migrations list`, `sqlite_schema`, dan `PRAGMA table_info(...)` sebelum mengubah source migration;
- jangan rewrite migration yang sudah pernah dianggap applied hanya untuk membuat deploy hijau;
- capture D1 Time Travel checkpoint atau approved backup sebelum production repair;
- repair hanya object yang terbukti hilang menggunakan definisi authoritative dari migration/versioned contract yang bersangkutan;
- buat repair idempotent dan scoped, lalu resume canonical repository migration chain;
- setelah recovery, restore normal repository-owned deploy command dan buktikan fresh Git Integration deploy berhasil tanpa recovery script;
- temporary diagnostic assets/script harus dihapus dan live smoke harus membuktikan asset tersebut tidak lagi public.

## Preview Worker tidak membuktikan remote D1 siap

**Pitfall:** Successful Worker preview/source build bukan bukti bahwa migration baru sudah applied ke remote D1. Code baru dapat memanggil table yang belum ada dan baru meledak sebagai runtime 500 ketika user membuka fitur.

**Current strategy:**

- schema-changing production release harus menjalankan `db:migrations:apply` lalu `db:schema:verify` sebelum `wrangler deploy`;
- verifier membaca remote `sqlite_schema` dan fail closed bila required object belum ada;
- semua `npx` pada deploy road dibuat explicit non-interactive;
- remote schema verifier punya bounded runtime dan gagal sebelum Worker promotion jika Wrangler/D1 tidak merespons;
- branch preview dengan migration baru dianggap code-preview saja kecuali dedicated preview D1 dengan matching schema memang disediakan;
- jangan membuat ad-hoc table production dari request handler atau rewrite migration history untuk menyelamatkan preview.

Recovery dan deployment checklist lengkap ada di `RUNBOOK.md`.

## Accounting tetap owner posting jurnal

## Dialog transaksi jangan melakukan fetch berantai atau ganda

**Pitfall:** membuka Beli Bahan dengan fetch barang lalu supplier secara serial, kemudian editor meminta barang lagi, membuat dialog terasa lebih lambat daripada Operasional.

Fetch independen harus paralel, hasilnya dibagi melalui cache satu sesi, dan boleh diprefetch setelah workspace kasir siap. Gunakan PIMASATU untuk input satu-per-satu; jangan membuat slot keranjang kosong.

## D1 default bootstrap tidak boleh overlap dengan editor reads

**Pitfall:** Jangan menjalankan helper yang dapat menulis default reference dalam `Promise.all` yang sama dengan query snapshot editor.

Selesaikan bootstrap/default write terlebih dahulu, kemudian jalankan independent read queries secara paralel. Overlap batch write + read pada request yang sama dapat membuat endpoint gabungan gagal walaupun endpoint reference individual tetap sehat.

## Accounting tetap owner posting jurnal

Prototype Leker boleh menyimpan Settings dan business facts. POS/Warehouse tidak boleh menulis langsung ke database Accounting atau membuat General Ledger tandingan. Dalam local composition host, semua journal write tetap wajib melalui Accounting posting entry point yang sama.

## `store_id` bukan batas tenant

**Pitfall:** Jangan memperlakukan `store_id` sebagai batas isolasi pelanggan MAXI, dan jangan menambahkan tabel ledger baru tanpa memikirkan pemilik bukunya.

`store_id` adalah **gerai** — scope operasional. Dalam arah SaaS multi-tenant, pemilik buku adalah **Entity (Badan Usaha)** dan pelanggan yang berlangganan adalah **Tenant**; keduanya belum ada di schema. Query yang hanya memfilter `store_id` aman selama Leker masih satu pelanggan, tetapi tidak memenuhi Constitution S3 begitu pelanggan kedua masuk.

**Current strategy:**

- Baris ledger (journal, stock movement, stock balance, valuation) akan berlabuh ke `entity_id`, **tidak** ke `tenant_id` atau `group_id`. Posted journal immutable, jadi identitas yang bisa berpindah saat merge tidak boleh menempel di sana.
- Tenant dan consolidation group adalah relasi bertanggal yang di-resolve saat baca, bukan kolom yang didenormalisasi.
- Tabel ledger baru yang dibuat sekarang tanpa mempertimbangkan `entity_id` menjadi utang migrasi begitu tenant kedua ada.

Detail dan tahapan migrasinya di `adr/ADR-030-multi-entity-tenancy-and-accounting-consolidation.md`.

## Status `Lengkap` tanpa konsumen adalah janji palsu

**Pitfall:** Jangan menandai sebuah Jenis Transaksi `Lengkap` hanya karena rule Debit/Kredit-nya terisi, kalau tidak ada satu pun modul yang memposting melaluinya.

Enam Jenis Transaksi hari ini ada di Setting Akuntansi tanpa konsumen posting: `wh_opname`, `wh_production`, `wh_transfer`, `wh_return`, `deposit`, `payroll`. Tiga yang pertama bahkan sudah punya rule aktif yang dikonfigurasi admin. Admin melihat `Lengkap`, wajar menyimpulkan Stock Opname menghasilkan jurnal, dan jurnal itu tidak pernah terbit — tanpa error, tanpa jejak, karena tidak pernah ada yang mencoba.

**Current strategy:**

- konsumen posting yang sebenarnya hanya `src/accounting-pos-bridge.js` (`sale`, `purchase_material`, `operational`) dan `src/accounting-cash-flow-bridge.js` (`cash_flow_in`, `cash_flow_out`);
- `src/accounting-reference.js` hanya registry, bukan poster — jangan dihitung sebagai konsumen;
- Jenis Transaksi tanpa konsumen ditandai *belum tersambung*, bukan `Lengkap`;
- membuat lane posting baru untuk `wh_*` berarti memutuskan semantik Inventory → Accounting, dan itu milik Bos Cyo (Constitution R2).

Lihat `adr/ADR-031`.

## Transfer dan produksi tidak boleh menyentuh Pendapatan atau Beban

**Pitfall:** Jangan mengizinkan rule `wh_transfer` atau `wh_production` memakai akun bertipe `REVENUE` atau `EXPENSE`.

`wh_production` memindahkan nilai antar sub-akun Persediaan sesuai jenis bahan — kedua kaki Aset, tidak ada kekayaan bertambah atau berkurang. `wh_transfer` berpindah di wilayah kas, piutang, dan hutang — kedua kaki Aset atau Liabilitas.

Memindahkan uang antar rekening yang tercatat sebagai pendapatan akan **menggelembungkan omzet tanpa satu pun penjualan terjadi**, dan tidak ada tes yang gagal karenanya: jurnalnya tetap balance. Itu sebabnya larangan ini ditegakkan pada tipe akun saat rule disimpan, bukan diserahkan pada kehati-hatian saat memposting.

Keputusan Bos Cyo 2026-08-19, lihat `adr/ADR-032`.

## Seed migration memasang rule untuk semua Jenis Transaksi kecuali `sale`

**Pitfall:** Jangan berasumsi Jenis Transaksi yang terdaftar di Setting Akuntansi sudah punya rule.

`trg_stores_seed_accounting_settings_defaults` (migration `0022`) mendaftarkan `sale` sebagai
Jenis Transaksi untuk tiap gerai baru dan memasang rule untuk `wh_transfer`, `wh_opname`, dan
`wh_production`. Migration `0029` menambahkan rule `purchase_material`, `0035` menambahkan
`operational`, `0028` menambahkan `cash_flow_*`. **Tidak satu pun memasang rule untuk `sale`.**

Akibatnya setiap gerai — termasuk deployment yang benar-benar baru — lahir dengan Penjualan
terdaftar tetapi tidak bisa memposting apa pun. Rule `sale` G001 di produksi dibuat manual
tanggal 16 Agustus 2026; G002 tidak pernah dibuat, dan dua penjualannya menganggur sejak
11 Agustus. Tidak ada tes yang gagal karenanya: kategorinya ada, resolvernya benar
gagal-tertutup, dan yang hilang justru datanya.

**Current strategy:**

- migration `0040` memasang rule `sale` untuk gerai yang sudah ada **dan** trigger
  `trg_sale_category_rules_after_insert` supaya gerai berikutnya ikut terkonfigurasi;
- lane posting baru wajib memasang rule-nya lewat trigger `AFTER INSERT ON
  transaction_categories`, mengikuti idiom `trg_purchase_category_rules_after_insert`, bukan
  lewat INSERT satu kali yang hanya menambal gerai hari ini;
- `test/sale-posting-config.test.js` menahan bentuk ini: tanpa `0040`, tidak satu gerai pun
  di database baru bisa memposting penjualan.

## DOC-IMPACT

**REQUIRED** — Jenis Transaksi terdaftar tidak membuktikan rule-nya terpasang, `wh_transfer`/`wh_production` dilarang menyentuh Pendapatan/Beban, status `Lengkap` tanpa konsumen posting adalah janji palsu, `store_id` tidak boleh diperlakukan sebagai batas tenant, refresh kasir tetap event-driven, costing/journal memakai exact scaled integer snapshots, saldo negatif dipertahankan sebagai signed balance, auto Penyesuaian dibatasi policy, operational Qty tidak bocor menjadi stock movement, Accounting Settings tetap configuration-only, Warehouse tidak memiliki duplicate mapping, `chart_of_accounts` tetap sole canonical COA registry, out-of-band schema dilarang, business-application tables tidak boleh FK langsung ke Accounting interpretation tables, stock-integrity policy tetap milik Inventory/Costing, production D1 recovery harus memverifikasi schema object, dan schema-changing Worker deployment harus membuktikan remote D1 readiness sebelum promotion.