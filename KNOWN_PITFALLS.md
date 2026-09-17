# Known Pitfalls — Prototype Leker

## Recipe acuan tidak boleh menjadi transaksi produksi yang kaku

**Pitfall:** Jangan memperlakukan Recipe/BOM Master sebagai angka final yang wajib sama dengan real production, dan jangan menyimpan perubahan real production kembali ke Master Recipe.

Actual yield dan actual consumption dapat berbeda dari standar karena kondisi lapangan. Memaksa transaksi mengikuti Recipe akan membuat stok/HPP salah; menulis deviasi transaksi ke Recipe akan merusak master standar dan historical meaning.

**Correct pattern:**

- Recipe/BOM tetap immutable revision dan hanya menjadi template/acuan awal;
- Production Panel menyalin recipe ke form transaksi lalu output qty dan bahan aktual boleh diedit/add/remove;
- `production_run_components` menyimpan actual consumed components dan `production_runs.total_output_quantity` menyimpan actual output;
- HPP produksi dihitung server-side dari actual qty × exact scaled component cost snapshot;
- perubahan stok harus muncul sebagai `PRODUCTION_INPUT` dan `PRODUCTION_OUTPUT` pada canonical `stock_movements`;
- Product Kind transaksi disnapshot sebelum Accounting Bridge agar perubahan Master setelah posting tidak mengganti interpretasi historical production;
- Accounting hanya memindahkan nilai antar akun persediaan yang benar-benar berbeda. Jika bahan dan hasil memakai akun persediaan yang sama, jangan membuat Debit/Credit noise ke akun yang sama;
- Warehouse tidak memilih Account ID. Resolution tetap melalui `wh_production` + Product Kind mapping di Accounting Settings dan posting lewat Accounting module.

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

## Payment method aktif bukan berarti mapping Accounting siap

**Pitfall:** Jangan memakai `payment_methods.account_id` atau resolver Accounting untuk memutuskan apakah SALE/PURCHASE/EXPENSE boleh committed.

Identity, status aktif, dan default payment method adalah kebutuhan POS Core. Row aktif tanpa akun tetap valid untuk business fact. Account mapping hanya dibaca Accounting bridge setelah commit; mapping kosong wajib menghasilkan `NEEDS_PAYMENT_MAPPING` tanpa membatalkan transaksi operasional.

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

**Koreksi 2026-08-31 -- asumsi di atas (bullet ke-5) terbukti salah, dicek langsung
lewat evidence, bukan dugaan:** push ke branch fitur `claude/leker-prototype-usc6mf`
(bukan `main`) memicu Cloudflare Git Integration menjalankan **canonical deploy
penuh** (`db:migrations:apply` -> `db:schema:verify` -> `wrangler deploy`) langsung
ke worker production `prototype-leker-v2` dan D1 production yang sama, BUKAN ke
preview terisolasi. Buktinya: migration `0057` (baru ada di branch fitur, belum di
`main`, belum di-merge) muncul applied di `d1_migrations` production pada
`2026-08-31 03:06:36`, dan `workers_list` menunjukkan `prototype-leker-v2`
`modified_on` berubah 12 detik sesudahnya (`03:06:48`) -- persis urutan
migrate -> verify -> deploy, dipicu murni oleh `git push` ke branch fitur, tanpa
merge, tanpa PR approve. `wrangler.jsonc` cuma punya satu `d1_databases` binding
(tidak ada `preview_database_id` terpisah), jadi tidak ada isolasi preview sama
sekali di level D1 -- dan berdasarkan bukti ini, kemungkinan juga tidak ada
isolasi di level Worker.

**Implikasi buat siapa pun yang kerja di repo ini:** anggap SETIAP `git push` ke
branch mana pun -- bukan cuma merge ke `main` -- sebagai deploy production yang
sesungguhnya. Migration yang belum direview jangan pernah di-push kalau isinya
destruktif (DROP/ALTER/data yang tidak idempotent) sebelum benar-benar yakin,
karena tidak ada gerbang review yang menahannya sebelum ke production. Migration
additive+idempotent (pola `WHERE NOT EXISTS`) aman kalau ke-apply lebih awal dari
rencana, tapi migration yang mengubah struktur harus dianggap live sejak commit
pertama di-push, bukan sejak PR di-merge. Ini juga menjelaskan kenapa gejala
"migration sudah di-merge tapi belum ke database" (migration 0056, 2 hari
tertahan) dan "migration langsung ke database dari branch fitur" (migration
0057, hitungan detik) bisa terjadi di repo yang sama -- pipeline-nya memang
tidak konsisten/predictable, bukan cuma soal branch mana yang dipakai.

Recovery dan deployment checklist lengkap ada di `RUNBOOK.md`.

**Koreksi kedua, 2026-09-17 -- separuh kesimpulan koreksi di atas ternyata salah,
dan baru ketahuan karena sehari penuh kerjaan numpuk tanpa pernah sampai user.**
22 commit (migration 0095 s/d 0100, plus semua kode Kode Barang/Master Entity,
Laporan Net Profit, Bea Operasional) di-push ke branch fitur
`subkategori-dermo-dan-edit-modal` selama ~2 hari. Dicek langsung ke dua sumber
primer: `d1_migrations` di D1 production menunjukkan seluruhnya SUDAH applied
(migration 0100 jam 15:06), tapi `workers_get_worker_code` (kode Worker
`prototype-leker-v2` yang SUNGGUHAN melayani request, dibaca langsung dari
Cloudflare API, bukan dari dashboard/preview) masih persis versi PR #294 --
merge terakhir ke `main`, 2026-09-16 -- tidak ada satu pun dari 22 commit itu
yang ikut. Bos Cyo yang menyadari duluan lewat gejala ("kok karyawan jadi ga
ada"), bukan dari monitoring apa pun.

Jadi klaim koreksi 2026-08-31 di atas cuma benar untuk **migration D1**
(`db:migrations:apply` -- memang tidak branch-aware, tetap applied ke D1
production dari branch mana pun, ini bagian yang TIDAK berubah dan tetap
berbahaya persis seperti sebelumnya). Yang salah adalah menyamaratakannya dengan
**kode Worker** (`wrangler deploy`): itu baru benar-benar melayani request
sesudah masuk `main` lewat merge, bukan pada saat push ke branch fitur. `workers_list`
`modified_on` yang berubah beberapa detik sesudah migration applied (bukti asli
koreksi 2026-08-31) ternyata BUKAN bukti kode baru ter-deploy -- kemungkinan
besar itu Cloudflare membuat *build/preview* untuk branch itu (mengubah metadata
worker) tanpa mempromosikannya jadi versi yang dilayani `workers.dev`. Tidak ada
tool di sini yang bisa melihat langsung dashboard "Workers Builds" atau
deployment/version history-nya untuk memastikan mekanismenya persis apa --
kesimpulan ini murni dari membandingkan isi kode yang benar-benar dilayani
terhadap riwayat commit, dua kali (2026-08-31 dan 2026-09-17), bukan dari
membaca dokumentasi Cloudflare.

**Implikasi yang benar sekarang:** migration destruktif/belum yakin tetap tidak
boleh di-push ke branch mana pun (masih applied ke D1 production yang sama,
sama seperti sebelumnya) -- itu bagian dari koreksi 2026-08-31 yang tetap
berlaku. Tapi kode aplikasi (apa pun yang membaca tabel migration itu) **tidak
hidup untuk user sampai branch-nya masuk `main`** -- jangan pernah
menyimpulkan/melaporkan "sudah bisa dicoba" hanya dari push berhasil + migration
applied. Bukti "sudah live" tetap tiga langkah di `RUNBOOK.md`/`jalur-akses-leker`
(migration applied + `modified_on` berubah + cek fungsional) TAPI langkah
ketiganya (cek fungsional, atau baca `workers_get_worker_code` langsung) yang
paling menentukan -- dua langkah pertama sudah terbukti bisa lolos padahal
kodenya belum live. Kerjaan yang selesai dan lulus test wajib digabung ke `main`
sebelum dilaporkan siap dicoba, bukan cukup di-push ke branch fitur.

## Login Admin Gerai yang "muter-muter" berulang -- riwayat lengkap, bukan tebak ulang tiap kali

**Pitfall:** gejala "login admin_pendem berhasil tapi halamannya muter-muter/blank" muncul
**empat kali terpisah** (27, 28 Agustus x2, dan 31 Agustus 2026). Tiga laporan pertama ditangani
sebagai insiden baru masing-masing, dan jawaban di papan Workboard untuk laporan kedua
(`isu_d6825a14`) berhenti di perbaikan **pertama** (PR #165) padahal perbaikan yang benar-benar
menutup gejalanya baru datang lewat PR #167 sesudahnya -- jawabannya tidak pernah diperbarui.
Akibatnya laporan ketiga (`isu_a85819b5`, dibuka beberapa jam sesudah laporan kedua "dijawab")
pada dasarnya mengulang investigasi yang sama dari nol. Ini persis kegagalan yang dicegah
`hana-cara-kerja` §5 (temuan wajib mendarat di dokumen) -- ditulis di sini sekarang karena
sebelumnya tidak pernah benar-benar ditulis permanen.

**Dua akar masalah yang sudah dikonfirmasi dan diperbaiki (kode ini masih berlaku, sudah dicek
2026-08-31 -- tidak ter-revert):**

1. **Handler login dobel** (PR #162) dan **halaman tidak mengingat gerai terakhir customer**
   (PR #163) -- perbaikan awal, tidak cukup sendirian.
2. **Deteksi "ini halaman admin" dari bentuk URL** (PR #165, `public/staff-entry-guard.js`) --
   alamat `/branch-admin` (tanpa prefix `/s/:code`, tidak berakhiran `/admin`) tidak dikenali
   sebagai halaman admin oleh regex lama, jadi (a) pengunjung tanpa sesi bisa lolos ke shell
   Admin, dan (b) `store-context.js` jatuh ke gerai default `G001` alih-alih Pendem.
3. **Fallback ke sesi Admin sendiri saat entry point tanpa `/s/:code`** (PR #167,
   `public/store-context.js` + `public/staff-entry-guard.js` + `public/branch-admin.html`) --
   kedua file kunci sekarang membaca deklarasi eksplisit `window.LEKER_PAGE_CONTEXT === 'admin'`
   (ditulis di `<head>` sebelum guard/script lain jalan) alih-alih menebak dari URL, dan
   `store-context.js` mengecek `sessionStorage.lekerAdminStoreCode` (gerai sesi Admin yang sedang
   login) sebelum jatuh ke default. Ini yang akhirnya menutup laporan kedua dan ketiga
   (`resolution_text: "sudah bisa login"`, 2026-08-29).

**Jalur login yang benar sekarang** (`public/auth-entry-split.js` -> `POST
/api/auth/staff-login` -> `src/unified-login.js`): sesudah login sukses, `lekerAdminStoreCode`
di-set ke `sessionStorage` **sebelum** redirect ke `/s/<CODE>/admin` (bukan ke `/branch-admin`
polos) -- jalur ini sudah dua lapis aman (prefix URL benar + fallback sesi). Yang **belum**
tercakup lapisan ini: bookmark/shortcut lama yang tersimpan langsung ke `/branch-admin` polos
dari sebelum PR #167, dipakai tanpa lewat halaman login depan.

**Status 2026-08-31: gejala sama muncul LAGI, sesudah dua perbaikan di atas terbukti masih
live di kode (dicek langsung, bukan diasumsikan) dan sesudah backend login terbukti berhasil
(baris baru di `store_admin_sessions` untuk `admin_pendem`, valid, dibuat tepat saat gejala
dilaporkan). Ini BELUM tuntas didiagnosis** -- dugaan kuat tapi belum terverifikasi: cache
browser/PWA lama di perangkat kantor (HTML `branch-admin.html` sendiri tidak punya cache-bust
seperti file JS-nya), atau bookmark lama ke `/branch-admin` polos.

**Kalau gejala ini muncul lagi, sebelum menebak dari nol:**
1. Baca bagian ini dulu -- jangan re-diagnose dari nol seperti tiga laporan sebelumnya.
2. Verifikasi kode di atas masih live (`git show origin/main:public/staff-entry-guard.js` dkk),
   bukan ter-revert.
3. Verifikasi backend: `SELECT ... FROM store_admin_sessions JOIN store_admins ...` -- kalau ada
   sesi valid baru dibuat, backend-nya sehat, masalahnya di klien (cache/bookmark), bukan server.
4. Minta URL PERSIS yang dipakai (bare `/branch-admin` vs `/s/PENDEM/admin`) dan minta coba
   tutup browser total (bukan cuma refresh) atau buang bookmark lama, ganti login dari halaman
   depan.
5. Kalau semua itu sudah dan gejalanya tetap ada -- itu baru benar-benar akar masalah baru,
   bukan pengulangan yang tiga sebelumnya. Tulis temuannya di sini, bukan cuma di balasan
   Workboard yang akan tertutup dan terlupakan lagi.

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

## D1 membatasi compound SELECT ke 5 term -- lolos di `node:sqlite`, meledak diam-diam di production

**Pitfall:** Jangan menulis satu `UNION ALL` chain (termasuk di dalam satu CTE) dengan lebih dari 5 cabang SELECT dan mengira test lokal membuktikan query itu jalan.

Cloudflare D1 menegakkan `SQLITE_LIMIT_COMPOUND_SELECT` yang jauh lebih kecil dari default SQLite (500) -- **persis 5 term per compound-select node**. `src/admin-transactions.js`'s query gabungan Penjualan/Pembelian/Operasional/Pendapatan Lain/Approval Request/Produksi punya 6 cabang dalam satu `UNION ALL` -- dibuktikan langsung ke production D1 (`too many terms in compound SELECT: SQLITE_ERROR`), bukan cuma dugaan. Query itu selalu gagal total di production (Data Transaksi kosong sama sekali, baik di Admin maupun mirror-nya di Kasir) sejak pertama ditulis, tapi **tidak ada satu pun test yang gagal** karena harness test lokal memakai `node:sqlite` (limit compound-select-nya jauh di atas 5) -- gap ini baru ketahuan 2026-09-03 lewat laporan langsung Bos Cyo, bukan lewat test suite.

**Perbaikannya bukan mengurangi fitur, tapi memecah compound-select-nya**: bungkus tiap kelompok ≤5 cabang jadi CTE terpisah, lalu gabungkan CTE-CTE itu dengan satu `UNION ALL` lagi di level luar (itu sendiri sebuah compound-select node baru yang hitungannya independen). `WITH a AS (x UNION ALL y UNION ALL z), b AS (...) SELECT * FROM a UNION ALL SELECT * FROM b` sudah dibuktikan jalan di production D1 meski totalnya 6+ cabang.

Kalau menambah cabang baru ke query gabungan manapun di masa depan (bukan cuma yang ini), hitung dulu berapa cabang dalam SATU compound-select node sebelum menulisnya, dan **buktikan ke D1 langsung** (via query tool) sebelum menganggap `npm test` hijau cukup sebagai bukti.

## ACC lalu eksekusi dua statement terpisah -- disconnect di tengah bikin permit nyangkut selamanya

**Pitfall:** Jangan menulis alur "tandai approved" lalu "jalankan efek + tandai selesai" sebagai dua write terpisah dalam satu request handler dan menganggap keduanya pasti jalan berurutan sampai selesai.

`src/transaction-void-permits.js`'s ACC handler untuk Permit Hapus Transaksi menulis `approval_status = 'approved'` dulu (satu `UPDATE`), baru setelah itu memanggil `executeTransactionCorrection()` (query + `db.batch()` sendiri) dan menulis `execution_status` di `UPDATE` terpisah lagi setelahnya. Kalau koneksi Admin putus (jaringan HP, tab ditutup, dsb) tepat di antara dua write itu, Cloudflare Workers bisa menghentikan eksekusi request sebelum sampai ke write kedua -- **dibuktikan langsung di production**: 6 permit (2026-09-01/04) nyangkut persis di `approval_status='approved'` + `execution_status='NOT_ATTEMPTED'` dengan `execution_code`/`execution_detail` kosong (bukan `HOLD`/`FAILED` yang punya kode jelas), dan endpoint PATCH-nya sendiri menolak memproses ulang permit yang statusnya sudah bukan `pending_approval` -- jadi permit itu macet permanen, kelihatan "sudah di-ACC" padahal efeknya belum pernah benar-benar jalan.

**Perbaikannya bukan membungkus dua write itu jadi satu batch** (executor-nya butuh membaca hasil query sebelum tahu statement apa yang mau ditulis, jadi tidak bisa dijadikan satu `db.batch()` calls di awal) **tapi membuat langkah eksekusinya sendiri retry-safe**, lalu sediakan jalur retry eksplisit. Karena operational correction (`executeSaleCorrection`/`executePurchaseCorrection`/`executeExpenseCorrection`) sudah punya guard `voided_at IS NULL` dan Accounting reversal sudah punya `idempotencyKey`, mengulang seluruh `executeTransactionCorrection()` untuk permit yang sudah `approved` itu aman -- tidak akan menerapkan dobel. `decision: 'RETRY_EXECUTION'` di endpoint yang sama sengaja dibuka untuk permit `approved` yang `execution_status`-nya belum `EXECUTED`, dengan tombol "🔁 Retry Eksekusi" di panel Admin.

Kalau menulis alur "keputusan lalu efek" yang mirip di masa depan (approval apa pun yang memanggil executor multi-langkah setelah menulis status keputusan), cek dulu: apakah proses efeknya sendiri aman diulang kalau setengah jalan macet? Kalau tidak, itu utang yang sama persis dengan yang barusan ditemukan di sini.

## Navigasi in-app antar halaman staf dianggap "tab kompetitor" oleh guard satu-tab, padahal itu diri sendiri

**Pitfall:** Guard "satu tab aktif per akun staf" (`public/staff-tab-lock.js`, jalan di cashier.html/staff.html/admin.html/owner.html/branch-admin.html/entity-admin.html) memakai lease di `localStorage` dengan window aktif 15 detik, dan cuma menganggap lease lama itu "diri sendiri, bukan tab lain" kalau ada `lekerStaffHandoffId` yang cocok di `sessionStorage`. Sebelum perbaikan ini, `lekerStaffHandoffId` **cuma diisi sekali, di halaman login** (`public/auth-entry-split.js`) -- navigasi in-app biasa (klik link "Portal Staf" dari Kasir, atau tombol "← Kasir" dari Portal Staf) tidak pernah mengisinya lagi.

**Dibuktikan di production (2026-09-15):** kasir Laili klik "Portal Staf" dan langsung ter-logout paksa. Awalnya diduga karena kasir lain (Zahra) yang kebetulan lagi testing Portal Staf juga di HP lain di jam yang berdekatan -- **terbukti salah** setelah dicek `cashier_sessions` produksi: dua akun itu benar-benar beda baris, session per kasir terisolasi penuh di server, tidak ada mekanisme yang membuat aktivitas satu kasir menyentuh sesi kasir lain. Akar sebenarnya murni client-side dan device-local: di HP, `beforeunload` tidak selalu sempat membersihkan lease halaman lama sebelum halaman baru mengecek (bfcache/suspend, bukan unload penuh) -- lease lama masih kelihatan "aktif" dalam window 15 detik itu, dan halaman baru mengira dirinya kompetitor lalu memblokir diri sendiri.

**Perbaikannya:** setiap link/tombol yang melakukan navigasi in-app antar halaman staf (bukan logout, bukan login baru) wajib memanggil `window.lekerPrepareStaffHandoff()` -- fungsi yang diexport `staff-tab-lock.js` sendiri -- tepat sebelum `location.assign`/navigasi berjalan, supaya halaman tujuan mengenali dirinya sebagai handoff sah dan tidak memblokir. Kalau menambah halaman staf baru yang saling link-in-app dengan halaman staf lain yang sudah ada, cek dulu: apakah link/tombol perpindahannya sudah manggil `lekerPrepareStaffHandoff()`? Kalau belum, itu logout palsu yang menunggu ditemukan lagi.

## Laporan Net Profit tidak otomatis ikut fitur Beban baru -- harus didaftarkan manual

**Pitfall:** Jangan menganggap `src/net-profit-report.js` (Laporan Net Profit harian, panel Entity Admin) otomatis membaca Beban dari fitur/tabel apa pun yang baru dibuat. Modul ini sengaja hardcode daftar sumber Beban (`BEBAN_SOURCES` di file yang sama, per 2026-09-17 isinya dua: `expenses`/Pengeluaran Kasir dan `admin_operational_expenses`/Bea Operasional Admin), bukan menyimpulkan sendiri dari skema.

**Dibuktikan lewat proses desainnya sendiri, bukan dugaan**: laporan ini awalnya cuma menghitung Penjualan/HPP/Pengeluaran/Pendapatan Lain, lalu Bos Cyo (2026-09-17) langsung menemukan dua lubang begitu laporan pertama jadi -- Penyesuaian Stok (kehilangan/temuan stok, nilainya sudah ada di `approval_requests.payload_json`, tapi tidak pernah dibaca laporan) dan potensi Beban yang nanti dicatat lewat Admin (bukan Kasir) untuk kebutuhan seperti "Beban Lapak"/"Beban Gaji" yang belum dibangun. Penyesuaian Stok sudah ditambahkan. Beban dari Admin waktu itu **belum ada fiturnya sama sekali** (dicek langsung: `expenses` cuma bisa ditulis lewat `requireCashier` + `requireDrawerOwner`, tidak ada jalur Admin/`requireManagement` yang menulis ke situ) -- dan ramalannya terbukti persis: fiturnya dibangun hari yang sama juga (Bea Gaji/Lapak/Lainnya, migration 0100), dengan tabel sendiri `admin_operational_expenses`, bukan menumpang `expenses`. Alasannya struktural: `expenses` mewajibkan `drawer_session_id` + `cashier_id` NOT NULL, jadi memaksakannya bikin laci kasir kelihatan kurang uang padahal yang bayar Admin. Tabel itu juga punya `business_date` sendiri (Admin boleh mundur, bayar gaji tanggal 5 untuk periode bulan lalu), sehingga selain didaftarkan ke `BEBAN_SOURCES` ia juga harus membuang cache tanggal yang dibebani lewat `invalidateDailyProfitSnapshot()` -- tanpa itu, bea yang dicatat mundur ke hari yang sudah ditutup-buku hilang senyap dari laporan.

**Konsekuensinya ke depan:** begitu ada fitur baru yang mencatat pengeluaran uang keluar dari Admin (Beban Lapak, Beban Gaji, dan sejenisnya) -- kalau fitur itu menulis ke tabel `expenses` yang sama, laporan otomatis ikut benar tanpa perlu diubah. **Kalau fitur itu punya tabel/mekanisme sendiri** (kemungkinan besar, karena "Beban Gaji" butuh field terstruktur beda dari `expenses` yang cuma description+amount), laporan ini **TIDAK akan tahu** sampai tabelnya didaftarkan manual ke `BEBAN_SOURCES` dan query baru ditambahkan di `computeFactsForDates()`. Gagal mendaftarkan berarti Net Profit diam-diam kelihatan lebih besar dari aslinya (Beban yang sungguhan tidak ikut kepotong) -- tidak ada error, tidak ada test yang gagal, cuma angka yang salah.

Kalau membangun fitur pencatatan Beban baru apa pun (dari Admin maupun Kasir), cek dulu: apakah tabelnya sudah terdaftar di `BEBAN_SOURCES`/`computeFactsForDates()` `src/net-profit-report.js`? Kalau belum, itu Beban yang akan hilang senyap dari Laporan Net Profit.

## `?store=` mengunci pemanggil, tapi parameter daftar gerai di query string tidak ikut terkunci

**Pitfall:** Jangan menganggap endpoint `/api/admin/*` otomatis aman lintas gerai cuma karena `requireManagement()` sudah dipanggil. Gate itu mengunci **satu** hal: `?store=` harus cocok dengan gerai si Admin (`adminStoreMatchesRequest`). Parameter LAIN yang juga menyebut gerai -- misal `stores=KANTOR,PENDEM` di Laporan Net Profit -- jalur terpisah yang tidak ikut kecek di sana sama sekali.

**Dibuktikan waktu memasang Laporan Untung Rugi ke panel Admin Gerai (2026-09-17)**: handler `/api/admin/reports/net-profit` awalnya cuma memvalidasi `stores=` terhadap **entity** pemanggil, karena waktu dibuat satu-satunya pemakainya panel Entity Admin (yang memang berwenang se-entity). Begitu endpoint yang sama dipakai panel Admin Gerai, Admin gerai A tinggal menukar satu parameter -- `?store=A&stores=B` -- untuk membaca untung-rugi gerai B: `?store=` tetap cocok jadi gate lolos, dan `stores=B` lolos karena B memang satu entity. Tidak ada error, tidak ada test merah; cuma data gerai lain yang terbuka. Melanggar invariant CLAUDE.md #5.

**Aturannya:** setiap parameter yang menyebut gerai -- bukan cuma `?store=` -- wajib divalidasi terhadap kewenangan pemanggil, bukan cuma terhadap entity. Owner dan Entity Admin boleh se-entity; Admin Gerai dan Legacy PIN hanya gerainya sendiri. Kalau menambah endpoint baru yang menerima daftar gerai, tulis testnya dari sisi Admin Gerai (bukan cuma Owner) -- test yang cuma memakai token Owner akan hijau sekalipun pagarnya tidak ada.

## DOC-IMPACT

**REQUIRED** — Jenis Transaksi terdaftar tidak membuktikan rule-nya terpasang, `wh_transfer`/`wh_production` dilarang menyentuh Pendapatan/Beban, status `Lengkap` tanpa konsumen posting adalah janji palsu, `store_id` tidak boleh diperlakukan sebagai batas tenant, Production Panel memperlakukan Recipe sebagai template immutable dengan actual execution snapshot, refresh kasir tetap event-driven, costing/journal memakai exact scaled integer snapshots, saldo negatif dipertahankan sebagai signed balance, auto Penyesuaian dibatasi policy, operational Qty tidak bocor menjadi stock movement, Accounting Settings tetap configuration-only, Warehouse tidak memiliki duplicate mapping, `chart_of_accounts` tetap sole canonical COA registry, out-of-band schema dilarang, business-application tables tidak boleh FK langsung ke Accounting interpretation tables, stock-integrity policy tetap milik Inventory/Costing, production D1 recovery harus memverifikasi schema object, schema-changing Worker deployment harus membuktikan remote D1 readiness sebelum promotion, **push ke branch fitur mana pun harus diperlakukan sebagai deploy production yang sesungguhnya** (tidak ada isolasi preview D1/Worker yang terbukti, lihat koreksi 2026-08-31 di "Preview Worker tidak membuktikan remote D1 siap"), **laporan "login Admin Gerai muter-muter" wajib dibaca dari riwayat lengkapnya dulu** sebelum re-diagnose dari nol (lihat "Login Admin Gerai yang 'muter-muter' berulang"), dan **compound SELECT di D1 dibatasi 5 term** -- test lokal `node:sqlite` tidak menegakkan limit ini sama sekali, jadi query gabungan >5 cabang bisa hijau di `npm test` tapi gagal total di production (lihat "D1 membatasi compound SELECT ke 5 term"), **alur "keputusan lalu eksekusi" yang ditulis sebagai dua write terpisah harus retry-safe** karena disconnect di tengah bisa bikin state nyangkut permanen tanpa error yang jelas (lihat "ACC lalu eksekusi dua statement terpisah"), dan **setiap navigasi in-app baru antar halaman staf wajib memanggil `lekerPrepareStaffHandoff()`** sebelum pindah halaman, atau guard satu-tab bisa memblokir diri sendiri dan terlihat seperti logout misterius (lihat "Navigasi in-app antar halaman staf dianggap 'tab kompetitor'"), dan **fitur Beban baru (dari Admin maupun Kasir) wajib didaftarkan manual ke `BEBAN_SOURCES`/`computeFactsForDates()` di `src/net-profit-report.js`** atau Laporan Net Profit akan diam-diam kelihatan lebih untung dari aslinya tanpa error apa pun (lihat "Laporan Net Profit tidak otomatis ikut fitur Beban baru"), dan **setiap parameter query yang menyebut gerai wajib divalidasi terhadap kewenangan pemanggil, bukan cuma `?store=`** -- gate `requireManagement()` hanya mengunci `?store=`, sehingga parameter daftar gerai seperti `stores=` bisa jadi jalur baca lintas gerai yang lolos tanpa error (lihat "`?store=` mengunci pemanggil, tapi parameter daftar gerai di query string tidak ikut terkunci"). dan **migration D1 dan kode Worker punya "kapan live"-nya beda** -- migration applied ke D1 production dari push ke branch mana pun (tidak branch-aware, tetap berbahaya), tapi kode Worker baru benar-benar melayani user sesudah branch-nya masuk `main`, jadi "push berhasil + migration applied" TIDAK boleh disimpulkan sebagai "sudah bisa dicoba user" (lihat koreksi 2026-09-17 di "Preview Worker tidak membuktikan remote D1 siap").
