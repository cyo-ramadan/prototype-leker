-- Real backlog from the 2026-08-18 audit, written as board tasks.
--
-- These exist so work continues when Hana does not. Writing tasks one at a time
-- on demand rebuilds the dependency the board exists to remove.
--
-- Note what is NOT here: no source code. The objective and the contract say what
-- must be true; how to make it true is the implementer's job. And no task asks an
-- agent to decide accounting or inventory policy — those are Bos Cyo's.

INSERT OR IGNORE INTO agent_sessions (id, family, slot, session) VALUES ('hana1.1', 'hana', 1, 1);

-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing, mutates_production)
VALUES (
  'T-2026-0818-01', 'MIGRATION', 'accounting-settings',
  'Gerai baru lahir tanpa rule Penjualan',
  'Setiap gerai baru saat ini tidak bisa memposting Penjualan sama sekali, karena tidak ada yang membuatkan journal_rules untuk kategori sale. Di produksi rule itu pernah dibuat manual dan tidak pernah masuk migration, sehingga store_002 dan store_ab5c6dd4 masih kosong sampai hari ini. Buat migration yang menyemai rule sale default untuk setiap gerai yang belum punya.',
  'migrations/0019_product_costing_and_kinds.sql; src/accounting-pos-bridge.js (resolvePosFactToJournalCommand); ACCOUNTING_POSTING_COVERAGE_AUDIT_20260818.md Finding 4 dan Finding 7; jalankan test/accounting-settings-readiness.test.js untuk melihat bentuk yang dianggap siap.',
  'Empat kaki, tidak kurang: DEBIT source_type=payment_method, CREDIT item_category_revenue, DEBIT item_category_cogs, CREDIT item_category_inventory. journal_rules.transaction_category_id WAJIB menunjuk transaction_categories yang store_id-nya sama; jangan pernah join kategori lintas gerai. Migration harus idempotent: gerai yang sudah punya rule sale tidak boleh digandakan. Rule dibuat non-aktif jika akun tujuannya belum ada, jangan menebak akun.',
  'npm test hijau; migration apply bersih di SQLite kosong; setelah apply, setiap store di tabel stores punya >=1 rule DEBIT dan >=1 rule CREDIT untuk kategori sale; tidak ada rule ganda bila migration dijalankan dua kali.',
  'Jangan menyentuh chart_of_accounts. Jangan membuat akun. Jangan mengubah rule sale store_001 yang sudah ada.',
  'hana1.1', 1, 0
);

-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing, mutates_production)
VALUES (
  'T-2026-0818-02', 'MIGRATION', 'identity-tenancy',
  'ADR-030 langkah 3 — entity_id di tabel ledger',
  'Hari ini semua tabel ledger dan operasional hanya berlabuh ke store_id, sehingga isolasi yang ada mengamankan gerai dari gerai, bukan pelanggan MAXI dari pelanggan MAXI. Tambahkan entity_id berdampingan dengan store_id, terisi dari entity milik store tersebut. Aditif; tidak ada kolom lama yang berubah arti dan tidak ada pembacaan yang dipindah pada task ini.',
  'adr/ADR-030-multi-entity-tenancy-and-accounting-consolidation.md; migrations/0039_tenancy_and_consolidation_foundation.sql; test/tenancy-foundation.test.js.',
  'entity_id diisi dari stores.entity_id milik baris tersebut, bukan ditebak. Tabel ledger TIDAK BOLEH menerima tenant_id atau consolidation_group_id — keduanya berpindah saat dua pelanggan merge, dan posted journal immutable, jadi identitas yang bisa berpindah tidak boleh menempel di ledger. store_id tetap ada dan tetap berarti gerai. Migration gagal, bukan diam, bila ada baris yang tidak dapat entity.',
  'npm test hijau; setiap baris di accounting_journal_headers, accounting_journal_lines, sales, purchases, expenses punya entity_id tidak NULL setelah apply; tes baru membuktikan tidak ada tabel ledger yang punya kolom tenant_id atau consolidation_group_id.',
  'Jangan mengubah kode pembacaan/penulisan apa pun pada task ini — itu langkah 4. Jangan menghapus store_id.',
  'hana1.1', 1, 0
);

-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing, mutates_production)
VALUES (
  'T-2026-0818-03', 'DEBUG', 'accounting',
  'Backlog POS tidak boleh sunyi di gerai mana pun',
  'Panel Accounting kini menampilkan jumlah fakta yang belum masuk jurnal, tetapi angka itu belum pernah diuji untuk gerai yang sama sekali tidak punya baris pengiriman — kasus store_002, yang penjualannya mendahului migration 0025. Buktikan angkanya benar untuk kasus itu, atau perbaiki bila tidak.',
  'src/accounting-pos-bridge.js (UNSYNCED_POS_FACTS_SQL, countUnsyncedPosFacts); test/accounting-bridge-backlog.test.js; ACCOUNTING_POSTING_COVERAGE_AUDIT_20260818.md Finding 3 dan Finding 6.',
  'Backlog dihitung dari tabel fakta (sales, purchases, expenses), tidak pernah dari accounting_bridge_deliveries — fakta yang lahir sebelum ledger pengiriman tidak punya baris di sana sama sekali. Fakta yang voided_at IS NOT NULL tidak pernah masuk hitungan dan tidak pernah diposting ulang.',
  'Tes baru membangun gerai dengan fakta tanpa baris pengiriman dan membuktikan jumlahnya tepat; tes membuktikan fakta ter-void tidak ikut terhitung; npm test hijau.',
  'Jangan mengubah endpoint sync. Jangan menjalankan rekonsiliasi ke database produksi.',
  'hana1.1', 1, 0
);

-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing, mutates_production)
VALUES (
  'T-2026-0818-04', 'FEATURE', 'produksi',
  'Snapshot biaya produksi tidak boleh ikut berubah saat harga bahan berubah',
  'Pastikan HPP produksi yang sudah tercatat tetap utuh ketika harga beli bahan diperbarui setelahnya. Bila sudah benar, tinggalkan bukti berupa tes; bila belum, perbaiki.',
  'src/cashier-production.js; src/stock-production.js; migrations/0021_exact_production_costing.sql; KNOWN_PITFALLS.md bagian "Recipe bukan HPP final".',
  'Recipe adalah revisi immutable. HPP produksi diambil sebagai snapshot saat posting, bukan dihitung ulang dari products.purchase_price terbaru. production_runs.recipe_id WAJIB menunjuk revisi resep tertentu; jangan pernah join ke manufacturing_recipes lewat produk saja, karena satu produk bisa punya banyak revisi dan hasilnya ambigu. Semua nilai uang scaled INTEGER; dilarang REAL, dilarang float JS sebagai sumber kebenaran.',
  'Tes membuktikan: produksi diposting, harga bahan lalu diubah, HPP produksi lama tidak berubah satu unit pun; npm test hijau; npm run check lolos.',
  'Jangan menyentuh modul Accounting. Jangan memutuskan metode persediaan perpetual atau periodic — itu keputusan Bos Cyo.',
  'hana1.1', 1, 0
);

-- ---------------------------------------------------------------------------
-- Waits for Bos Cyo, not for Hana. Re-posting historical facts changes the books,
-- and Constitution §5 reserves production data mutation for the owner.
INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing, mutates_production)
VALUES (
  'T-2026-0818-05', 'AUDIT', 'accounting',
  'Jalankan rekonsiliasi untuk delapan penjualan yang belum masuk buku',
  'Delapan penjualan operasional belum pernah menghasilkan jurnal. Setelah rule sale tersedia di setiap gerai dan Jenis Barang terisi, jalankan rekonsiliasi yang sudah ada dan laporkan hasil per fakta.',
  'POST /api/admin/accounting/bridge/sync; src/accounting-reconciliation-guard.js; ACCOUNTING_POSTING_COVERAGE_AUDIT_20260818.md Finding 1.',
  'Rekonsiliasi bersifat idempotent; fakta yang sudah POSTED tidak boleh menghasilkan jurnal kedua. Fakta ter-void dilewati dengan status SKIPPED_VOIDED, bukan diposting.',
  'Setiap penjualan aktif punya jurnal, atau punya failure_code yang menjelaskan mengapa tidak; laporan memuat hasil per fakta.',
  'Tidak boleh dijalankan sebelum Bos Cyo memberi otoritas eksplisit. Jangan mengubah jurnal yang sudah posted — koreksi lewat reversal.',
  'hana1.1', 0, 1
);
