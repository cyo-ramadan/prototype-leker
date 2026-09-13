PRAGMA foreign_keys = ON;

-- Coin: bisa dikasih manual oleh Admin, atau (rencana) otomatis dari program
-- promosi tertentu. Dipakai buat main Roda Puter berhadiah -- 1 coin = 1 main
-- resmi. Pola tabelnya sengaja meniru customer_point_ledger: saldo dihitung
-- SUM(coins_delta), bukan kolom saldo yang di-cache, supaya tidak ada dua
-- sumber kebenaran yang bisa saling drift.
CREATE TABLE IF NOT EXISTS customer_coin_ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  share_group_id TEXT,
  source_store_id TEXT NOT NULL,
  coins_delta INTEGER NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('GRANT', 'SPEND', 'ADJUSTMENT')),
  reference_type TEXT NOT NULL DEFAULT '',
  reference_id TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (share_group_id) REFERENCES customer_share_groups(id),
  FOREIGN KEY (source_store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_customer_coin_ledger_customer_created
  ON customer_coin_ledger(customer_id, created_at DESC);

-- Satu grant per kejadian (ulang tahun tahun ini, atau pendaftaran member
-- tertentu) tidak boleh dobel -- notifikasi Admin mengecek baris ini lewat
-- reference_type+reference_id sebelum menampilkan tombol "Kasih Coin" sebagai
-- masih bisa diklik.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_coin_ledger_reference_once
  ON customer_coin_ledger(customer_id, reference_type, reference_id)
  WHERE reference_type <> '' AND reference_id <> '';

-- Tanggal lahir pelanggan -- kosong berarti belum diisi (banyak pelanggan
-- lama tidak akan pernah mengisi ini). Dipakai buat notifikasi ulang tahun
-- di panel Admin, bukan dipaksakan wajib.
ALTER TABLE customers ADD COLUMN birth_date TEXT NOT NULL DEFAULT '';
