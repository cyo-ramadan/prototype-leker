PRAGMA foreign_keys = ON;

-- ADR-047, Bos Cyo 2026-09-27: "aku pingin akun2 nya sinkron dulu, engga
-- custome per tenant dan gerai dulu ... akun2 yang saat ini ga konek otomatis
-- dengan sistem, yang disinyalir customize dari gerai tersebut mending dihapus
-- aja." Pengecualian: DERMO ("ada 2 owner yang kerjasama ... kusus gerai itu
-- biarkan bisa custom dulu").
--
-- Migration ini HANYA konfigurasi -- tidak menulis satu baris jurnal pun
-- (invariant #2 dan #4: posting milik Accounting lewat postAccountingJournal).
-- Akun custom yang masih bersaldo dibiarkan aktif; saldonya dipindah oleh
-- tombol "Samakan ke Akun Standar" (src/accounting-standardize.js), yang
-- memposting jurnal pemindahan lalu menutup akunnya.
--
-- "Akun custom" = kode ACC-xxxxxx, yaitu akun buatan admin lewat
-- createAccountingAccount. Kode ACC yang sama berarti akun BERBEDA di tiap
-- gerai (Beji ACC-000006 = Hutang Gaji Elma, Genengan ACC-000006 = Hutang Gaji
-- Uswatun), jadi pemetaan ke akun standar memakai NAMA + TIPE, bukan kode.

-- 1. Saklar per gerai. 0 = akun standar saja (default, termasuk gerai baru).
ALTER TABLE stores ADD COLUMN custom_accounts_allowed INTEGER NOT NULL DEFAULT 0
  CHECK (custom_accounts_allowed IN (0, 1));

UPDATE stores SET custom_accounts_allowed = 1 WHERE code = 'DERMO';

-- 2. Peta nama akun custom -> akun standar. Dipakai migration ini dan tombol
--    "Samakan ke Akun Standar". Pola LIKE atas lower(name); tipe akun sumber
--    dan tujuan wajib sama. Nama yang tidak ada di sini tidak disentuh.
CREATE TABLE IF NOT EXISTS accounting_standard_account_aliases (
  name_pattern TEXT NOT NULL,
  account_type TEXT NOT NULL,
  target_code TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (name_pattern, account_type)
);

INSERT OR IGNORE INTO accounting_standard_account_aliases (name_pattern, account_type, target_code, note) VALUES
  ('piutang poci malang', 'ASSET', '1103', 'Uang lewat rekening pusat = Rekening Bersama'),
  ('beban dibayar dimuka', 'ASSET', '1401', 'Uang Muka / Deposit'),
  ('uang muka', 'ASSET', '1401', 'Uang Muka / Deposit'),
  ('hutang gaji %', 'LIABILITY', '2102', 'Hutang gaji per orang -> Utang Gaji; rincian per orang di Laporan Hutang Piutang'),
  ('hutang sewa lapak', 'LIABILITY', '2101', 'Sama dengan aturan bawaan ADR-046'),
  ('hutang kepada suplier poci', 'LIABILITY', '2101', 'Utang Usaha'),
  ('hutang hari leker', 'LIABILITY', '2103', 'Utang Lain-lain'),
  ('beban sewa lapak', 'EXPENSE', '6106', 'Beban Sewa Lapak');

-- 3. Akun standar yang belum ada. 0123 sengaja tidak membuat 1401/6106 di
--    gerai yang sudah punya akun admin bernama sama; sekarang akun admin itu
--    diganti, jadi akun standarnya harus ada.
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_1401', id, '1401', 'Uang Muka / Deposit', 'ASSET', 'PREPAID'
FROM stores WHERE edition = 'ACCOUNTING' AND custom_accounts_allowed = 0;

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype)
SELECT 'coa_' || id || '_6106', id, '6106', 'Beban Sewa Lapak', 'EXPENSE', 'OPERATING_EXPENSE'
FROM stores WHERE edition = 'ACCOUNTING' AND custom_accounts_allowed = 0;

-- 4. Arahkan semua rujukan (aturan jurnal, cara bayar, kategori barang,
--    pilihan) dari akun custom ke akun standar hasil peta nama. Aturan dan
--    cara bayar yang nonaktif ikut diarahkan supaya akun custom bisa ditutup.
UPDATE journal_rules
SET fixed_account_id = (
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = journal_rules.fixed_account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1),
    updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND EXISTS (
      SELECT 1 FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = journal_rules.fixed_account_id AND cur.code LIKE 'ACC-%');

UPDATE payment_methods
SET account_id = (
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = payment_methods.account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1),
    updated_at = CURRENT_TIMESTAMP
WHERE store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND EXISTS (
      SELECT 1 FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = payment_methods.account_id AND cur.code LIKE 'ACC-%');

-- Cara bayar "Piutang Poci Malang" (dulu ke 1201 Piutang Usaha) adalah uang
-- lewat rekening pusat = Rekening Bersama (Bos Cyo 2026-09-27: "piutang
-- malang itu sebenernya rekber").
UPDATE payment_methods
SET account_id = (SELECT a.id FROM chart_of_accounts a WHERE a.store_id = payment_methods.store_id AND a.code = '1103' AND a.is_active = 1),
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'PIUTANG_POCI_MALANG'
  AND store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND EXISTS (SELECT 1 FROM chart_of_accounts a WHERE a.store_id = payment_methods.store_id AND a.code = '1103' AND a.is_active = 1);

UPDATE item_categories
SET inventory_account_id = COALESCE((
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = item_categories.inventory_account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1), inventory_account_id),
    cogs_account_id = COALESCE((
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = item_categories.cogs_account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1), cogs_account_id),
    revenue_account_id = COALESCE((
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = item_categories.revenue_account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1), revenue_account_id)
WHERE store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0);

UPDATE accounting_choice_options
SET account_id = (
      SELECT std.id FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = accounting_choice_options.account_id AND cur.code LIKE 'ACC-%'
      ORDER BY length(m.name_pattern) DESC LIMIT 1)
WHERE store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND EXISTS (
      SELECT 1 FROM chart_of_accounts cur
      JOIN accounting_standard_account_aliases m ON m.account_type = cur.type AND lower(cur.name) LIKE m.name_pattern
      JOIN chart_of_accounts std ON std.store_id = cur.store_id AND std.code = m.target_code AND std.is_active = 1
      WHERE cur.id = accounting_choice_options.account_id AND cur.code LIKE 'ACC-%');

-- 5. Akun custom yang tidak pernah dipakai sama sekali (tanpa baris jurnal,
--    tanpa rujukan) dihapus.
DELETE FROM chart_of_accounts
WHERE code LIKE 'ACC-%'
  AND store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND NOT EXISTS (SELECT 1 FROM accounting_journal_lines l WHERE l.account_id = chart_of_accounts.id)
  AND NOT EXISTS (SELECT 1 FROM payment_methods p WHERE p.account_id = chart_of_accounts.id)
  AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.fixed_account_id = chart_of_accounts.id)
  AND NOT EXISTS (SELECT 1 FROM item_categories c WHERE chart_of_accounts.id IN (c.inventory_account_id, c.cogs_account_id, c.revenue_account_id))
  AND NOT EXISTS (SELECT 1 FROM accounting_choice_options o WHERE o.account_id = chart_of_accounts.id);

-- 6. Akun custom yang punya riwayat jurnal tapi saldonya sudah nol ditutup
--    (tidak bisa dihapus: baris jurnal posted immutable dan merujuknya).
UPDATE chart_of_accounts
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE code LIKE 'ACC-%'
  AND is_active = 1
  AND store_id IN (SELECT id FROM stores WHERE custom_accounts_allowed = 0)
  AND COALESCE((SELECT SUM(CASE WHEN l.side = 'DEBIT' THEN l.amount_scaled ELSE -l.amount_scaled END)
                FROM accounting_journal_lines l WHERE l.account_id = chart_of_accounts.id), 0) = 0
  AND NOT EXISTS (SELECT 1 FROM payment_methods p WHERE p.account_id = chart_of_accounts.id AND p.is_active = 1)
  AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.fixed_account_id = chart_of_accounts.id AND r.is_active = 1)
  AND NOT EXISTS (SELECT 1 FROM item_categories c WHERE c.is_active = 1 AND chart_of_accounts.id IN (c.inventory_account_id, c.cogs_account_id, c.revenue_account_id))
  AND NOT EXISTS (SELECT 1 FROM accounting_choice_options o WHERE o.account_id = chart_of_accounts.id AND o.is_active = 1);

-- 7. Kunci: gerai standar tidak bisa punya akun custom baru. Server menolak
--    lebih dulu dengan pesan yang jelas (createAccountingAccount); trigger ini
--    penjaga terakhir kalau ada jalur tulis lain.
CREATE TRIGGER IF NOT EXISTS trg_chart_of_accounts_standard_lock
BEFORE INSERT ON chart_of_accounts
WHEN NEW.code LIKE 'ACC-%'
  AND COALESCE((SELECT custom_accounts_allowed FROM stores WHERE id = NEW.store_id), 0) = 0
BEGIN
  SELECT RAISE(ABORT, 'CUSTOM_ACCOUNTS_LOCKED');
END;
