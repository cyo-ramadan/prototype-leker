PRAGMA foreign_keys = ON;

-- Cache Laporan Net Profit harian per gerai -- Bos Cyo, 2026-09-17: laporan
-- Rugi Laba harus bisa keluar TANPA Accounting aktif (POS berdiri sendiri,
-- lihat POS_MODULE_INDEPENDENCE.md), dihitung langsung dari business fact
-- kasir (sales/sale_items/expenses/other_income), dan tidak boleh berat
-- kalau dibuka berulang -- hari yang sudah lewat dihitung SEKALI lalu
-- disimpan di sini, tidak pernah dihitung ulang (transaksi lama tidak
-- boleh diedit diam-diam, jadi angkanya memang tidak akan berubah lagi).
-- Hari ini (business date == hari ini) SENGAJA TIDAK PERNAH masuk tabel
-- ini -- selalu dihitung live karena transaksinya masih berjalan.
--
-- Ini murni CACHE/derived data, bukan sumber kebenaran -- source of truth
-- tetap sales/sale_items/expenses/other_income. Aman di-TRUNCATE dan
-- dibangun ulang kapan saja tanpa kehilangan data apa pun.
--
-- Formula (disepakati eksplisit dengan Bos Cyo, JANGAN diubah tanpa
-- persetujuan -- ini kebijakan bisnis, bukan detail teknis):
--   Gross Profit = Pendapatan Lain + Penjualan - HPP
--   Net Profit   = Gross Profit - Beban Operasional +/- Penyesuaian Stok
-- Penyesuaian Stok (approval_requests purpose STOCK_ADJUSTMENT, posted):
-- stok berkurang (direction OUT) = kehilangan = mengurangi Net Profit;
-- stok bertambah (direction IN) = temuan lebih = menambah Net Profit.
-- Nilainya dari totalCostSnapshotScaled yang sudah disnapshot di
-- payload_json saat approval dibuat (src/operational-posting.js) --
-- BUKAN Beban Operasional biasa, sengaja kolom terpisah supaya kelihatan
-- jelas kontribusinya, bukan disembunyikan di angka Beban.
--
-- Pembelian Bahan (tabel purchases) dan perubahan nilai Aset (tabel
-- asset_ledger_entries, approval_requests requestType ASSET) SENGAJA
-- TIDAK PERNAH ikut dalam formula ini sama sekali -- keduanya sudah
-- tercatat di tabel/ledger terpisah dari Pengeluaran Operasional dan
-- Penyesuaian Stok, jadi otomatis kepisah tanpa perlu aturan tambahan.
--
-- Kalau nanti ada fitur/tombol baru yang debit-nya dianalisis sebagai
-- Beban (mis. "Beban Sewa", "Beban Penyusutan"), namanya harus dimulai
-- "Beban"/"Bea" (aturan Bos Cyo) DAN wajib didaftarkan eksplisit di
-- BEBAN_SOURCES (src/net-profit-report.js) -- penamaan itu penanda buat
-- manusia, pendaftaran di kode itu yang benar-benar dibaca laporan ini.
CREATE TABLE IF NOT EXISTS store_daily_profit_snapshot (
  store_id TEXT NOT NULL,
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  revenue INTEGER NOT NULL,
  other_income INTEGER NOT NULL,
  hpp INTEGER NOT NULL,
  expense INTEGER NOT NULL,
  stock_adjustment_net INTEGER NOT NULL DEFAULT 0,
  net_profit INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (store_id, business_date),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_store_daily_profit_snapshot_date
  ON store_daily_profit_snapshot(business_date, store_id);
