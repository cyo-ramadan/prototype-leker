PRAGMA foreign_keys = ON;

-- ADR-046, Bos Cyo 2026-09-27: "dari awal uda konek akuntansi ... kita uda
-- tentuin setiap transaksi bikin jurnal ini dan itu ... untuk data2 baru aja,
-- data lama biarin tanpa akuntansi."
--
-- Migration ini TIDAK menjurnal transaksi lama apa pun. Isinya cuma
-- konfigurasi supaya transaksi BARU fitur admin (Bea Operasional, Pembayaran
-- Hutang/Piutang, Pembayaran Lainnya, gaji presensi, Uang Muka/Deposit)
-- punya akun dan aturan jurnal bawaan -- admin gerai tidak perlu mengatur
-- apa pun, tapi tetap bisa mengubahnya dari Setting Akuntansi.

-- 1. accounting_bridge_deliveries menerima producer 'ADMIN'. Tidak ada
--    trigger/FK lain yang menyebut tabel ini (dicek 2026-09-27), jadi rebuild
--    aman dari GOTCHA migration 0120.
CREATE TABLE accounting_bridge_deliveries_new (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  producer_module TEXT NOT NULL CHECK (producer_module IN ('POS', 'WAREHOUSE', 'ADMIN')),
  fact_type TEXT NOT NULL,
  fact_id TEXT NOT NULL,
  transaction_category_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'POSTED', 'NEEDS_CONFIGURATION', 'FAILED')),
  journal_id TEXT,
  failure_code TEXT NOT NULL DEFAULT '',
  failure_detail TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (journal_id) REFERENCES accounting_journal_headers(id) ON DELETE RESTRICT,
  UNIQUE (store_id, producer_module, fact_type, fact_id)
);

INSERT INTO accounting_bridge_deliveries_new (
  id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status, journal_id,
  failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
)
SELECT
  id, store_id, producer_module, fact_type, fact_id, transaction_category_code, status, journal_id,
  failure_code, failure_detail, attempts, last_attempt_at, created_at, updated_at
FROM accounting_bridge_deliveries;

DROP TABLE accounting_bridge_deliveries;
ALTER TABLE accounting_bridge_deliveries_new RENAME TO accounting_bridge_deliveries;

CREATE INDEX IF NOT EXISTS idx_accounting_bridge_delivery_status
  ON accounting_bridge_deliveries(store_id, status, updated_at DESC);

-- 2. Uang Muka/Deposit sekarang mencatat dibayar dari mana (Tunai/Bank/
--    Rekening Bersama) -- dibutuhkan jurnalnya (Dr Uang Muka / Cr akun cara
--    bayar) dan supaya Rekening Bersama benar-benar berkurang. Deposit lama
--    tetap '' (tidak dijurnal).
ALTER TABLE operational_receivables_payables ADD COLUMN funding_method TEXT NOT NULL DEFAULT ''
  CHECK (funding_method IN ('', 'KAS', 'BANK', 'REKBER'));
ALTER TABLE operational_receivables_payables ADD COLUMN funding_shared_account_id TEXT REFERENCES entity_shared_accounts(id);
ALTER TABLE operational_receivables_payables ADD COLUMN funding_shared_ledger_id TEXT REFERENCES entity_shared_account_ledger(id);

-- 3. Akun bawaan (gerai ACCOUNTING yang sudah ada). Akun yang sudah dibuat
--    admin sendiri dengan nama yang sama PERSIS dipakai ulang -- produksi
--    per 2026-09-27 sudah punya "Beban Sewa Lapak", "Hutang Sewa Lapak", dan
--    "Beban Dibayar Dimuka" buatan admin di 8 gerai KPM.
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1103', id, '1103', 'Rekening Bersama', 'ASSET', 'BANK'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_2102', id, '2102', 'Utang Gaji', 'LIABILITY', 'PAYABLE'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_2103', id, '2103', 'Utang Lain-lain', 'LIABILITY', 'PAYABLE'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || s.id || '_1401', s.id, '1401', 'Uang Muka / Deposit', 'ASSET', 'PREPAID'
FROM stores s
WHERE s.edition = 'ACCOUNTING'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts a
    WHERE a.store_id = s.id AND a.type = 'ASSET' AND a.is_active = 1
      AND lower(a.name) IN ('beban dibayar dimuka', 'uang muka', 'uang muka / deposit')
  );

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || s.id || '_6106', s.id, '6106', 'Beban Sewa Lapak', 'EXPENSE', 'OPERATING_EXPENSE'
FROM stores s
WHERE s.edition = 'ACCOUNTING'
  AND NOT EXISTS (
    SELECT 1 FROM chart_of_accounts a
    WHERE a.store_id = s.id AND a.type = 'EXPENSE' AND a.is_active = 1 AND lower(a.name) = 'beban sewa lapak'
  );

-- 4. Jenis Transaksi admin (tampil & bisa diubah di Setting Akuntansi).
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_admin_gaji', id, 'admin_gaji', 'Gaji Karyawan', 0, 0,
       'Gaji dari presensi dan Bea Gaji: Beban Gaji bertambah, Utang Gaji bertambah. Pelunasannya mengurangi akun Utang di sini.'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_admin_bea_lapak', id, 'admin_bea_lapak', 'Bea Lapak', 1, 0,
       'Bea Lapak dari Bea Operasional/Pembayaran Lainnya. Kredit ke Utang kalau belum dibayar; kalau langsung dibayar, Kredit ke akun cara bayarnya.'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_admin_bea_lainnya', id, 'admin_bea_lainnya', 'Bea Lainnya', 1, 0,
       'Bea Lainnya dari Bea Operasional/Pembayaran Lainnya. Kredit ke Utang kalau belum dibayar; kalau langsung dibayar, Kredit ke akun cara bayarnya.'
FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description)
SELECT 'txcat_' || id || '_admin_uang_muka', id, 'admin_uang_muka', 'Uang Muka / Deposit', 1, 0,
       'Uang dibayar duluan (token listrik, saldo iklan, DP bahan baku) -- bukan Beban sampai direalisasikan.'
FROM stores WHERE edition = 'ACCOUNTING';

-- 5. Aturan jurnalnya. Akun dicari lewat kode/nama di gerai itu sendiri,
--    bukan id tebakan -- aturan tidak dipasang kalau akunnya tidak ada.
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || s.id || '_admin_gaji_dr', s.id, c.id, 'Beban Gaji', 'DEBIT', 'fixed_account', a.id, 10
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_gaji'
JOIN chart_of_accounts a ON a.store_id = s.id AND a.code = '6102'
WHERE s.edition = 'ACCOUNTING';

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || s.id || '_admin_gaji_cr', s.id, c.id, 'Utang Gaji', 'CREDIT', 'fixed_account', a.id, 20
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_gaji'
JOIN chart_of_accounts a ON a.store_id = s.id AND a.code = '2102'
WHERE s.edition = 'ACCOUNTING';

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || sid || '_admin_bea_lapak_dr', sid, cid, 'Beban Sewa Lapak', 'DEBIT', 'fixed_account', aid, 10
FROM (
  SELECT s.id AS sid, c.id AS cid, COALESCE(
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.type = 'EXPENSE' AND a.is_active = 1 AND lower(a.name) = 'beban sewa lapak' ORDER BY a.code LIMIT 1),
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.code = '6106')
  ) AS aid
  FROM stores s
  JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_bea_lapak'
  WHERE s.edition = 'ACCOUNTING'
)
WHERE aid IS NOT NULL;

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || sid || '_admin_bea_lapak_cr', sid, cid, 'Utang Lapak (kalau belum dibayar)', 'CREDIT', 'fixed_account', aid, 20
FROM (
  SELECT s.id AS sid, c.id AS cid, COALESCE(
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.type = 'LIABILITY' AND a.is_active = 1 AND lower(a.name) = 'hutang sewa lapak' ORDER BY a.code LIMIT 1),
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.code = '2101')
  ) AS aid
  FROM stores s
  JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_bea_lapak'
  WHERE s.edition = 'ACCOUNTING'
)
WHERE aid IS NOT NULL;

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || s.id || '_admin_bea_lainnya_dr', s.id, c.id, 'Beban Lainnya', 'DEBIT', 'fixed_account', a.id, 10
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_bea_lainnya'
JOIN chart_of_accounts a ON a.store_id = s.id AND a.code = '6104'
WHERE s.edition = 'ACCOUNTING';

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || s.id || '_admin_bea_lainnya_cr', s.id, c.id, 'Utang Lain-lain (kalau belum dibayar)', 'CREDIT', 'fixed_account', a.id, 20
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_bea_lainnya'
JOIN chart_of_accounts a ON a.store_id = s.id AND a.code = '2103'
WHERE s.edition = 'ACCOUNTING';

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order)
SELECT 'jrule_' || sid || '_admin_uang_muka_dr', sid, cid, 'Uang Muka / Deposit', 'DEBIT', 'fixed_account', aid, 10
FROM (
  SELECT s.id AS sid, c.id AS cid, COALESCE(
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.type = 'ASSET' AND a.is_active = 1
       AND lower(a.name) IN ('beban dibayar dimuka', 'uang muka', 'uang muka / deposit') ORDER BY a.code LIMIT 1),
    (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = s.id AND a.code = '1401')
  ) AS aid
  FROM stores s
  JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_uang_muka'
  WHERE s.edition = 'ACCOUNTING'
)
WHERE aid IS NOT NULL;

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || s.id || '_admin_uang_muka_cr', s.id, c.id, 'Dibayar dari (sesuai cara bayar)', 'CREDIT', 'payment_method', 20
FROM stores s
JOIN transaction_categories c ON c.store_id = s.id AND c.code = 'admin_uang_muka'
WHERE s.edition = 'ACCOUNTING';

-- 6. Gerai ACCOUNTING yang lahir sesudah ini dapat paket yang sama. Akun
--    dasar yang juga ditanam trigger 0045/0028 ikut ditanam di sini dengan
--    id & isi identik (INSERT OR IGNORE) -- urutan eksekusi trigger AFTER
--    INSERT ON stores tidak dijamin, jadi trigger ini tidak boleh bergantung
--    pada trigger lain sudah jalan duluan.
CREATE TRIGGER IF NOT EXISTS trg_stores_seed_admin_accounting_defaults
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1102', NEW.id, '1102', 'Bank', 'ASSET', 'BANK');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1103', NEW.id, '1103', 'Rekening Bersama', 'ASSET', 'BANK');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1401', NEW.id, '1401', 'Uang Muka / Deposit', 'ASSET', 'PREPAID');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_2101', NEW.id, '2101', 'Utang Usaha', 'LIABILITY', 'PAYABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_2102', NEW.id, '2102', 'Utang Gaji', 'LIABILITY', 'PAYABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_2103', NEW.id, '2103', 'Utang Lain-lain', 'LIABILITY', 'PAYABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6102', NEW.id, '6102', 'Beban Gaji', 'EXPENSE', 'PAYROLL');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active) VALUES ('coa_' || NEW.id || '_6104', NEW.id, '6104', 'Beban Lainnya', 'EXPENSE', 'OTHER_EXPENSE', 1);
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6106', NEW.id, '6106', 'Beban Sewa Lapak', 'EXPENSE', 'OPERATING_EXPENSE');

  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_admin_gaji', NEW.id, 'admin_gaji', 'Gaji Karyawan', 0, 0, 'Gaji dari presensi dan Bea Gaji: Beban Gaji bertambah, Utang Gaji bertambah. Pelunasannya mengurangi akun Utang di sini.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_admin_bea_lapak', NEW.id, 'admin_bea_lapak', 'Bea Lapak', 1, 0, 'Bea Lapak dari Bea Operasional/Pembayaran Lainnya. Kredit ke Utang kalau belum dibayar; kalau langsung dibayar, Kredit ke akun cara bayarnya.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_admin_bea_lainnya', NEW.id, 'admin_bea_lainnya', 'Bea Lainnya', 1, 0, 'Bea Lainnya dari Bea Operasional/Pembayaran Lainnya. Kredit ke Utang kalau belum dibayar; kalau langsung dibayar, Kredit ke akun cara bayarnya.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_admin_uang_muka', NEW.id, 'admin_uang_muka', 'Uang Muka / Deposit', 1, 0, 'Uang dibayar duluan (token listrik, saldo iklan, DP bahan baku) -- bukan Beban sampai direalisasikan.');

  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_gaji_dr', NEW.id, 'txcat_' || NEW.id || '_admin_gaji', 'Beban Gaji', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6102', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_gaji_cr', NEW.id, 'txcat_' || NEW.id || '_admin_gaji', 'Utang Gaji', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_2102', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_bea_lapak_dr', NEW.id, 'txcat_' || NEW.id || '_admin_bea_lapak', 'Beban Sewa Lapak', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6106', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_bea_lapak_cr', NEW.id, 'txcat_' || NEW.id || '_admin_bea_lapak', 'Utang Lapak (kalau belum dibayar)', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_2101', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_bea_lainnya_dr', NEW.id, 'txcat_' || NEW.id || '_admin_bea_lainnya', 'Beban Lainnya', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6104', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_bea_lainnya_cr', NEW.id, 'txcat_' || NEW.id || '_admin_bea_lainnya', 'Utang Lain-lain (kalau belum dibayar)', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_2103', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_admin_uang_muka_dr', NEW.id, 'txcat_' || NEW.id || '_admin_uang_muka', 'Uang Muka / Deposit', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_1401', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_admin_uang_muka_cr', NEW.id, 'txcat_' || NEW.id || '_admin_uang_muka', 'Dibayar dari (sesuai cara bayar)', 'CREDIT', 'payment_method', 20);

  UPDATE payment_methods SET account_id = 'coa_' || NEW.id || '_1102', updated_at = CURRENT_TIMESTAMP
  WHERE store_id = NEW.id AND code = 'NON_CASH' AND account_id IS NULL;
END;

-- 7. "Non Tunai (Legacy)" masih dipakai kasir tiap hari tapi tidak pernah
--    ditautkan ke akun -- penyebab NEEDS_PAYMENT_MAPPING (39 penjualan di
--    Beji/Genengan/Dermo/Pendem per 2026-09-27). Default ke Bank; admin
--    tetap bisa mengubahnya. Transaksi lama yang sudah nyangkut TIDAK
--    diposting otomatis oleh migration ini.
UPDATE payment_methods
SET account_id = (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = payment_methods.store_id AND a.code = '1102' AND a.is_active = 1),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'NON_CASH'
  AND account_id IS NULL
  AND store_id IN (SELECT id FROM stores WHERE edition = 'ACCOUNTING')
  AND EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.store_id = payment_methods.store_id AND a.code = '1102' AND a.is_active = 1);

CREATE TRIGGER IF NOT EXISTS trg_payment_methods_non_cash_default_account
AFTER INSERT ON payment_methods
WHEN NEW.code = 'NON_CASH' AND NEW.account_id IS NULL
  AND EXISTS (SELECT 1 FROM stores s WHERE s.id = NEW.store_id AND s.edition = 'ACCOUNTING')
  AND EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.store_id = NEW.store_id AND a.code = '1102' AND a.is_active = 1)
BEGIN
  UPDATE payment_methods
  SET account_id = (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = NEW.store_id AND a.code = '1102' AND a.is_active = 1)
  WHERE id = NEW.id;
END;

-- 8. Barang aktif tanpa Jenis Barang (11 barang di produksi per 2026-09-27,
--    dibuat 12-24 Sep lewat "Tambah barang") -- penyebab NEEDS_PRODUCT_KIND.
--    Ini data MASTER, bukan transaksi: dipasangi Jenis Barang yang kodenya
--    sama dengan Tipe Barang-nya (FINISHED_GOOD/RAW_MATERIAL/SEMI_FINISHED),
--    kalau tidak ada pakai Bahan Baku. Penjualan/pembelian lama yang sudah
--    nyangkut tetap menyimpan snapshot lamanya -- tidak ikut terjurnal.
UPDATE products
SET product_kind_id = COALESCE(
  (SELECT k.id FROM product_kinds k
     JOIN item_types t ON t.id = products.item_type_id AND t.store_id = products.store_id
   WHERE k.store_id = products.store_id AND k.code = t.code AND k.is_active = 1
   ORDER BY k.id LIMIT 1),
  (SELECT k.id FROM product_kinds k
   WHERE k.store_id = products.store_id AND k.code = 'RAW_MATERIAL' AND k.is_active = 1
   ORDER BY k.id LIMIT 1)
)
WHERE product_kind_id IS NULL;

-- Barang baru dari jalur mana pun (termasuk form lama) yang lahir tanpa
-- Jenis Barang langsung dipasangi default yang sama.
CREATE TRIGGER IF NOT EXISTS trg_products_default_product_kind
AFTER INSERT ON products
WHEN NEW.product_kind_id IS NULL
BEGIN
  UPDATE products
  SET product_kind_id = COALESCE(
    (SELECT k.id FROM product_kinds k
       JOIN item_types t ON t.id = NEW.item_type_id AND t.store_id = NEW.store_id
     WHERE k.store_id = NEW.store_id AND k.code = t.code AND k.is_active = 1
     ORDER BY k.id LIMIT 1),
    (SELECT k.id FROM product_kinds k
     WHERE k.store_id = NEW.store_id AND k.code = 'RAW_MATERIAL' AND k.is_active = 1
     ORDER BY k.id LIMIT 1)
  )
  WHERE id = NEW.id AND product_kind_id IS NULL;
END;
