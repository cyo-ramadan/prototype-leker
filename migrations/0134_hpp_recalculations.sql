-- Hitung Ulang HPP (Bos Cyo, 2026-10-02): "kalo leker itu harganya 2000 maka
-- bahannya 2000 adonan ... 1 adonan itu 1 rupiah ... bisa dibenerin pake
-- hitung ulang? kalo bisa jadikan itu fitur ... hanya berlaku untuk hpp."
--
-- Admin menetapkan harga per satuan yang benar untuk satu bahan sejak tanggal
-- tertentu. Sistem menghitung ulang biaya bahan itu pada produksi DADAKAN
-- (yang menempel ke penjualan) dan mencatat SELISIH HPP per baris penjualan.
-- Hanya HPP: jumlah stok, nominal pembelian, dan uang laci tidak disentuh.
-- Snapshot lama (sale_items.line_cogs, production_run_components) TIDAK
-- ditulis ulang -- koreksi berdiri sebagai catatan baru yang dijumlahkan oleh
-- laporan, dan Akuntansi menerima jurnal koreksi lewat jalur jembatan
-- (accounting_bridge_deliveries, fact HPP_KOREKSI). Tabel ini sengaja tidak
-- punya foreign key ke jurnal (invariant #4).
--
-- Nomor 0134: 0132/0133 sudah dipakai cabang skin yang migrasinya telah
-- jalan di produksi.
CREATE TABLE IF NOT EXISTS hpp_recalculations (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  component_product_id INTEGER NOT NULL REFERENCES products(id),
  component_product_name TEXT NOT NULL,
  unit_cost_scaled INTEGER NOT NULL CHECK (unit_cost_scaled >= 0),
  effective_from TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_average_cost_scaled INTEGER NOT NULL DEFAULT 0,
  line_count INTEGER NOT NULL DEFAULT 0,
  old_total_scaled INTEGER NOT NULL DEFAULT 0,
  new_total_scaled INTEGER NOT NULL DEFAULT 0,
  delta_total_scaled INTEGER NOT NULL DEFAULT 0,
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hpp_recalculations_store
  ON hpp_recalculations(store_id, created_at DESC);

CREATE TABLE IF NOT EXISTS hpp_recalculation_lines (
  id TEXT PRIMARY KEY,
  recalculation_id TEXT NOT NULL REFERENCES hpp_recalculations(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_date TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  sale_item_id TEXT NOT NULL,
  production_run_id TEXT NOT NULL REFERENCES production_runs(id),
  component_product_id INTEGER NOT NULL,
  component_kind_id TEXT,
  sold_kind_id TEXT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  old_cost_scaled INTEGER NOT NULL,
  new_cost_scaled INTEGER NOT NULL,
  delta_scaled INTEGER NOT NULL,
  UNIQUE (recalculation_id, sale_item_id)
);

CREATE INDEX IF NOT EXISTS idx_hpp_recalculation_lines_store_date
  ON hpp_recalculation_lines(store_id, business_date);
CREATE INDEX IF NOT EXISTS idx_hpp_recalculation_lines_run
  ON hpp_recalculation_lines(production_run_id, component_product_id);
CREATE INDEX IF NOT EXISTS idx_hpp_recalculation_lines_recalc_sale
  ON hpp_recalculation_lines(recalculation_id, sale_id);
