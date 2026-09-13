PRAGMA foreign_keys = ON;

-- Coin bisa dibelanjakan berkali-kali untuk Roda Puter (beda dari spin resmi
-- 1x-seumur-hidup di roda_puter_official_spins yang tetap ada, tidak
-- disentuh). Setiap spin pakai Coin sungguhan menghasilkan Voucher
-- sungguhan lewat prepareVoucherInstanceDistribution() yang sama dipakai
-- spin resmi -- satu jalur pembuatan Voucher, bukan dua.
--
-- voucher_instances.distributed_by_cashier_id tetap NOT NULL + FK ke
-- cashiers (tidak diubah): coin-spin dari customer sendiri (tanpa kasir
-- login) diatribusikan ke kasir aktif gerai itu yang dipilih di kode
-- (src/roda-puter.js), BUKAN baris kasir baru buatan -- sempat dicoba
-- bikin baris "Self Service" tapi itu bikin 16 file test lain yang query
-- "cashiers WHERE store_id = ? ORDER BY id LIMIT 1" tanpa filter is_active
-- salah pilih baris itu. Menambah baris baru ke tabel cashiers ternyata
-- beresiko sistemik; reuse kasir aktif yang sudah ada jauh lebih aman.
CREATE TABLE IF NOT EXISTS roda_puter_coin_spins (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  reward_id TEXT NOT NULL,
  voucher_instance_id TEXT NOT NULL UNIQUE,
  coins_spent INTEGER NOT NULL CHECK (coins_spent > 0),
  random_basis_points INTEGER NOT NULL,
  spun_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (campaign_id) REFERENCES roda_puter_campaigns(id),
  FOREIGN KEY (reward_id) REFERENCES roda_puter_rewards(id),
  FOREIGN KEY (voucher_instance_id) REFERENCES voucher_instances(id)
);
CREATE INDEX IF NOT EXISTS idx_roda_puter_coin_spins_customer
  ON roda_puter_coin_spins(customer_id, spun_at DESC);

-- Saldo Coin tidak boleh minus. Dicek di kode sebelum spend, tapi trigger
-- ini pagar terakhir di level DB kalau ada race condition dua request
-- spend bersamaan pas saldo tinggal 1.
CREATE TRIGGER IF NOT EXISTS trg_customer_coin_ledger_no_negative_balance
AFTER INSERT ON customer_coin_ledger
WHEN (SELECT COALESCE(SUM(coins_delta), 0) FROM customer_coin_ledger WHERE customer_id = NEW.customer_id) < 0
BEGIN
  SELECT RAISE(ABORT, 'COIN_BALANCE_NEGATIVE');
END;
