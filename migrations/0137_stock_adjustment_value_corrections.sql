-- Koreksi Nilai Penyesuaian Stok (SO+/SO-) (Bos Cyo, 2026-10-05).
--
-- Kejadian Mandala 5 Okt 2026: pembelian salah ketik "Gula 2 g Rp36.000" melonjakkan HPP Gula
-- jadi Rp18.000/g, lalu SO+ 1.998 g dinilai dengan HPP rusak itu (Rp35.964.000) dan sudah
-- dijurnal sebagai pendapatan koreksi stok -> untung palsu ±Rp36 juta. Bos Cyo: perbaikannya
-- harus lewat jalur resmi program dengan jurnal pembalik, bukan jurnal manual.
--
-- Satu baris = satu koreksi nilai untuk satu penyesuaian stok yang sudah diposting.
-- Penyesuaian stok aslinya (approval_requests) dan jurnalnya TIDAK diubah (invariant #2):
-- koreksi adalah catatan baru, dan di gerai Akuntansi ia membawa jurnal penyesuaian sendiri
-- (selisih nilai, tanggal sama dengan SO aslinya). Laporan Untung Rugi gerai non-Akuntansi
-- membaca corrected_value_scaled sebagai pengganti snapshot.
--
-- Uang = integer skala 1.000.000 (invariant #1). Satu koreksi aktif per penyesuaian stok;
-- koreksi ulang tidak didukung (minta pembalik penuh dulu) supaya jejaknya tetap lurus.
-- entity_id ikut disimpan untuk arah SaaS (ADR-030).
CREATE TABLE IF NOT EXISTS stock_adjustment_value_corrections (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  entity_id TEXT,
  approval_request_id TEXT NOT NULL UNIQUE REFERENCES approval_requests(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL DEFAULT '',
  unit_symbol TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  business_date TEXT NOT NULL,
  original_unit_cost_scaled INTEGER NOT NULL CHECK (original_unit_cost_scaled >= 0),
  original_value_scaled INTEGER NOT NULL CHECK (original_value_scaled >= 0),
  corrected_unit_cost_scaled INTEGER NOT NULL CHECK (corrected_unit_cost_scaled >= 0),
  corrected_value_scaled INTEGER NOT NULL CHECK (corrected_value_scaled >= 0),
  delta_scaled INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 5),
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stock_adjustment_value_corrections_store_date
  ON stock_adjustment_value_corrections(store_id, business_date);
