-- Five module revisions that may run at the same time, because their declared
-- paths do not overlap. Shared files are owned by none of them: a change there
-- is a separate, serialised task, which is the honest form of the hold that used
-- to happen at push time.

INSERT OR IGNORE INTO agent_sessions (id, family, slot, session) VALUES ('hana1.1','hana',1,1);

INSERT OR IGNORE INTO agent_tasks
  (id, kind, module, title, objective, inputs, contract, done_when, forbidden, written_by, self_closing)
VALUES
('M-PENJUALAN','FEATURE','operasional','Penjualan — fakta penjualan harus lengkap sebelum dikirim',
 'Pastikan setiap penjualan yang di-commit mengirim business fact yang lengkap ke Accounting: metode pembayaran, baris barang beserta Jenis Barang, dan snapshot biaya per baris. Bila ada yang bisa hilang diam-diam, tutup lubangnya.',
 'src/cashier-sales-tracking.js; public/cashier-sales-orders.js; src/accounting-pos-bridge.js (baca saja, jangan ubah).',
 'POS mengirim fakta, tidak pernah menentukan akun atau baris jurnal. sale_items.product_id WAJIB menunjuk products di store_id yang sama. Snapshot biaya per baris adalah nilai saat transaksi terjadi, bukan harga bahan terbaru. Uang scaled INTEGER, dilarang REAL.',
 'npm test hijau; npm run check lolos; ada tes yang gagal bila perubahanmu dicabut.',
 'Jangan sentuh src/index.js, src/http.js, src/approval-queue.js, src/accounting-*.js, package.json, migrations/.',
 'hana1.1',1),

('M-PEMBELIAN','FEATURE','operasional','Pembelian — Harga Beli master tetap independen dari bukti pembelian',
 'Pastikan pembelian tidak menimpa Harga Beli master secara diam-diam, dan bukti pembelian tetap dapat ditelusuri ke barang serta supplier yang benar.',
 'src/cashier-purchase.js; src/admin-purchase-detail.js; public/cashier-procurement-ui.js; adr/ADR-024-master-purchase-price-and-transaction-cost-separation.md.',
 'Harga Beli master editable dan independen setelah bootstrap; pembelian tidak boleh menulisnya ulang otomatis. purchases.supplier_id WAJIB satu store dengan pembeliannya. Hanya barang purchasable + stock-tracked yang boleh dibeli.',
 'npm test hijau; npm run check lolos; ada tes yang membuktikan Harga Beli master tidak berubah setelah pembelian baru.',
 'Jangan sentuh src/index.js, src/http.js, src/approval-queue.js, src/accounting-*.js, package.json, migrations/.',
 'hana1.1',1),

('M-OPERASIONAL','FEATURE','operasional','Operasional — qty operasional bukan stock movement',
 'Pastikan kuantitas pada Pengeluaran/Operasional tetap metadata bisnis dan tidak pernah bocor menjadi pergerakan stok.',
 'src/cashier-operational-expense.js; src/operational-posting.js; KNOWN_PITFALLS.md bagian "Qty operasional bukan stock movement".',
 'expenses tidak boleh punya foreign key ke tabel interpretasi Accounting — ADR-029 baru saja mencabutnya, jangan dikembalikan. Qty operasional tidak menulis stock_movements maupun inventory_stock_balances.',
 'npm test hijau; npm run check lolos; ada tes yang membuktikan qty operasional tidak menghasilkan baris stock_movements.',
 'Jangan sentuh src/index.js, src/http.js, src/approval-queue.js, src/accounting-*.js, package.json, migrations/.',
 'hana1.1',1),

('M-PRODUKSI','FEATURE','produksi','Produksi — HPP tercatat kebal terhadap perubahan harga bahan',
 'Buktikan HPP produksi yang sudah tercatat tidak berubah ketika harga bahan diperbarui setelahnya. Bila belum benar, perbaiki.',
 'src/cashier-production.js; src/stock-production.js; src/manufacturing-master.js; src/admin-production-detail.js; public/admin-manufacturing.js; migrations/0021_exact_production_costing.sql.',
 'production_runs.recipe_id WAJIB menunjuk revisi resep tertentu; jangan pernah join ke manufacturing_recipes lewat produk saja, karena satu produk punya banyak revisi dan hasilnya ambigu. Recipe immutable per revisi. HPP adalah snapshot saat posting. Scaled INTEGER, dilarang REAL.',
 'npm test hijau; npm run check lolos; tes membuktikan HPP lama tidak bergeser satu unit pun setelah harga bahan diubah.',
 'Jangan sentuh src/index.js, src/http.js, src/approval-queue.js, src/accounting-*.js, src/admin-stock.js, package.json, migrations/.',
 'hana1.1',1),

('M-PENYESUAIAN','FEATURE','inventory-costing','Penyesuaian Stok — stale snapshot harus tetap menolak',
 'Pastikan penjagaan stale snapshot pada Penyesuaian Stok masih menolak pengajuan bila stok berubah setelah diajukan, dan alasannya terbaca oleh kasir.',
 'src/admin-stock.js; public/admin-stock.js; adr/ADR-020-audited-stock-adjustment-and-stale-snapshot-guard.md.',
 'ACC melakukan re-check stok terkini terhadap snapshot saat pengajuan; bila berbeda, tolak sebagai STOCK_ADJUSTMENT_STALE. Flow v1 hanya mengoreksi quantity — Average Cost dan HPP historis tidak ditulis ulang. Saldo negatif dipertahankan apa adanya.',
 'npm test hijau; npm run check lolos; tes membuktikan penolakan STOCK_ADJUSTMENT_STALE saat stok bergeser setelah pengajuan.',
 'Jangan sentuh src/index.js, src/http.js, src/approval-queue.js, src/accounting-*.js, src/stock-production.js, package.json, migrations/.',
 'hana1.1',1);

INSERT OR IGNORE INTO agent_task_paths (task_id, path_prefix) VALUES
('M-PENJUALAN','src/cashier-sales-tracking.js'),
('M-PENJUALAN','public/cashier-sales-orders.js'),
('M-PEMBELIAN','src/cashier-purchase.js'),
('M-PEMBELIAN','src/admin-purchase-detail.js'),
('M-PEMBELIAN','public/cashier-procurement-ui.js'),
('M-OPERASIONAL','src/cashier-operational-expense.js'),
('M-OPERASIONAL','src/operational-posting.js'),
('M-PRODUKSI','src/cashier-production.js'),
('M-PRODUKSI','src/stock-production.js'),
('M-PRODUKSI','src/manufacturing-master.js'),
('M-PRODUKSI','src/admin-production-detail.js'),
('M-PRODUKSI','public/admin-manufacturing.js'),
('M-PENYESUAIAN','src/admin-stock.js'),
('M-PENYESUAIAN','public/admin-stock.js');
