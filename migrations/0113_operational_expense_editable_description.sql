PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-21: "harusnya kan itu milih dari master biaya ya dengan
-- cara search, tapi bikin itu editable untuk nama qty dan harganya... kalo
-- yang dipilih kemudian di edit misalkan jadi biaya tarikan sampah, maka
-- defaultnya nama 2 nya jadi biaya lainnya. intinya nama yang ga ada di
-- master biaya menjadi biaya lainnya."
--
-- Pengeluaran Operasional sekarang punya dua kolom terpisah per baris:
-- "Kategori Biaya" (tetap wajib dipilih lewat search dari Master Biaya,
-- dipakai laporan) dan "Keterangan Biaya" (teks bebas, default sama dengan
-- nama Kategori, kasir boleh timpa). Begitu Keterangan diketik beda dari
-- Kategori yang lagi kepilih, UI (public/cashier-payment-methods.js)
-- otomatis memindahkan Kategori efektifnya ke "Biaya Lainnya" -- kategori
-- catch-all yang WAJIB selalu ada per gerai supaya kasir tidak pernah macet
-- gara-gara belum ada Master yang cocok. Pola "auto-seed row + trigger utk
-- gerai baru" ini meniru coa_..._4202/_6104 "Pendapatan Lainnya"/"Beban
-- Lainnya" (migrations 0028/0049/0070), bukan pola baru.

INSERT OR IGNORE INTO cost_types (id, store_id, code, name)
SELECT 'cost_type_' || id || '_lainnya', id, 'LAINNYA', 'Lainnya' FROM stores;

INSERT OR IGNORE INTO cost_masters (id, store_id, name, contact, outgoing_amount, incoming_amount, cost_type_id, cost_group)
SELECT 'cost_' || id || '_lainnya', id, 'Biaya Lainnya', '', 0, 0, 'cost_type_' || id || '_lainnya', 'Lainnya' FROM stores;

CREATE TRIGGER trg_cost_master_lainnya_default_seed
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO cost_types (id, store_id, code, name)
  VALUES ('cost_type_' || NEW.id || '_lainnya', NEW.id, 'LAINNYA', 'Lainnya');
  INSERT OR IGNORE INTO cost_masters (id, store_id, name, contact, outgoing_amount, incoming_amount, cost_type_id, cost_group)
  VALUES ('cost_' || NEW.id || '_lainnya', NEW.id, 'Biaya Lainnya', '', 0, 0, 'cost_type_' || NEW.id || '_lainnya', 'Lainnya');
END;

-- Sebelum ini, expenses.description SELALU = cost_masters.name persis
-- (dipaksa server, tidak ada jejak lain ke Master-nya sama sekali). Sekarang
-- description boleh beda dari nama Kategori, jadi Kategori yang sesungguhnya
-- dipilih perlu kolom sendiri supaya tetap bisa dilacak/dilaporkan --
-- nullable karena baris lama dan jalur legacy single-description (yang
-- tidak lewat Master Biaya sama sekali, lihat handleCashierOperationalExpenseApi)
-- tidak punya dan tidak butuh nilai ini.
ALTER TABLE expenses ADD COLUMN cost_master_id TEXT REFERENCES cost_masters(id);
