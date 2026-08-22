PRAGMA foreign_keys = ON;

-- MAXI-BUSINESS-SETTINGS-BOUNDARY-20260819
--
-- Existing stores and callers that omit the column keep the full Accounting
-- behavior. LITE/FLEXIBLE stores keep POS-owned payment identities while the
-- three targeted Accounting couplings are gated. Residual seed triggers from
-- 0024/0026/0028 intentionally remain outside this phase.
ALTER TABLE stores ADD COLUMN edition TEXT NOT NULL DEFAULT 'ACCOUNTING'
  CHECK (edition IN ('LITE', 'FLEXIBLE', 'ACCOUNTING'));

-- The original 0022 trigger is preserved byte-for-byte in its body for the
-- ACCOUNTING edition. Only its entry condition changes.
DROP TRIGGER IF EXISTS trg_stores_seed_accounting_settings_defaults;
CREATE TRIGGER trg_stores_seed_accounting_settings_defaults
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1101', NEW.id, '1101', 'Kas', 'ASSET', 'CASH');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1102', NEW.id, '1102', 'Bank', 'ASSET', 'BANK');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1201', NEW.id, '1201', 'Piutang Usaha', 'ASSET', 'RECEIVABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1301', NEW.id, '1301', 'Persediaan Bahan', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1302', NEW.id, '1302', 'Persediaan Bahan Setengah Jadi', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_1303', NEW.id, '1303', 'Persediaan Barang Jadi', 'ASSET', 'INVENTORY');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_2101', NEW.id, '2101', 'Utang Usaha', 'LIABILITY', 'PAYABLE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_3101', NEW.id, '3101', 'Modal', 'EQUITY', 'CAPITAL');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_3201', NEW.id, '3201', 'Laba Ditahan', 'EQUITY', 'RETAINED_EARNINGS');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_4101', NEW.id, '4101', 'Penjualan', 'REVENUE', 'SALES');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, review_required) VALUES ('coa_' || NEW.id || '_4201', NEW.id, '4201', 'Pendapatan Koreksi Stok', 'REVENUE', 'INVENTORY_ADJUSTMENT', 1);
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_5101', NEW.id, '5101', 'Harga Pokok Penjualan', 'EXPENSE', 'COGS');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6101', NEW.id, '6101', 'Beban Operasional', 'EXPENSE', 'OPERATING_EXPENSE');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype) VALUES ('coa_' || NEW.id || '_6102', NEW.id, '6102', 'Beban Gaji', 'EXPENSE', 'PAYROLL');
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, review_required) VALUES ('coa_' || NEW.id || '_6103', NEW.id, '6103', 'Beban Susut Persediaan', 'EXPENSE', 'INVENTORY_ADJUSTMENT', 1);

  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_cash', NEW.id, 'CASH', 'Cash / Kas', 'coa_' || NEW.id || '_1101');
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_bank', NEW.id, 'BANK', 'Bank / Transfer', 'coa_' || NEW.id || '_1102');
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id) VALUES ('payment_' || NEW.id || '_payable', NEW.id, 'PAYABLE', 'Hutang / Utang Usaha', 'coa_' || NEW.id || '_2101');

  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_sale', NEW.id, 'sale', 'Penjualan', 1, 1, 'Penjualan barang kepada customer.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_purchase_material', NEW.id, 'purchase_material', 'Pembelian Bahan', 1, 1, 'Pembelian barang/bahan dari supplier.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_operational', NEW.id, 'operational', 'Operasional', 1, 0, 'Pengeluaran operasional.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_payroll', NEW.id, 'payroll', 'Gaji', 1, 0, 'Pembayaran gaji.');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description) VALUES ('txcat_' || NEW.id || '_deposit', NEW.id, 'deposit', 'Setoran', 1, 0, 'Setoran kas/bank.');

  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_transfer', NEW.id, 'wh_transfer', 'Transfer Antar Gudang', 0, 1, 'Perpindahan persediaan antar gudang.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_opname', NEW.id, 'wh_opname', 'Stock Opname', 0, 1, 'Penyesuaian selisih stock opname.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_production', NEW.id, 'wh_production', 'Pemakaian Produksi / BOM', 0, 1, 'Perpindahan nilai persediaan input ke output produksi.', 'WAREHOUSE');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_wh_return', NEW.id, 'wh_return', 'Retur Gudang', 0, 1, 'Retur gudang; detail arah retur perlu direview.', 'WAREHOUSE');

  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_transfer_dr', NEW.id, 'txcat_' || NEW.id || '_wh_transfer', 'Persediaan gudang tujuan', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_transfer_cr', NEW.id, 'txcat_' || NEW.id || '_wh_transfer', 'Persediaan gudang asal', 'CREDIT', 'item_category_inventory', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_gain_dr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok bertambah · Persediaan', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_gain_cr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok bertambah · Pendapatan Koreksi Stok', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_4201', 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_loss_dr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok berkurang · Beban Susut Persediaan', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6103', 30);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_opname_loss_cr', NEW.id, 'txcat_' || NEW.id || '_wh_opname', 'Jika stok berkurang · Persediaan', 'CREDIT', 'item_category_inventory', 40);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_production_dr', NEW.id, 'txcat_' || NEW.id || '_wh_production', 'Persediaan hasil produksi', 'DEBIT', 'item_category_inventory', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_wh_production_cr', NEW.id, 'txcat_' || NEW.id || '_wh_production', 'Persediaan bahan / BOM', 'CREDIT', 'item_category_inventory', 20);
END;

-- POS Core defaults for editions without Accounting. These rows deliberately
-- have no account mapping and therefore remain valid operational inputs.
CREATE TRIGGER trg_stores_seed_pos_payment_methods_defaults
AFTER INSERT ON stores
WHEN NEW.edition IN ('LITE', 'FLEXIBLE')
BEGIN
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
  VALUES ('payment_' || NEW.id || '_cash', NEW.id, 'CASH', 'Cash / Kas', NULL);
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
  VALUES ('payment_' || NEW.id || '_bank', NEW.id, 'BANK', 'Bank / Transfer', NULL);
  INSERT OR IGNORE INTO payment_methods (id, store_id, code, name, account_id)
  VALUES ('payment_' || NEW.id || '_payable', NEW.id, 'PAYABLE', 'Hutang / Utang Usaha', NULL);
END;

DROP TRIGGER IF EXISTS trg_product_kinds_seed_accounting_mapping;
CREATE TRIGGER trg_product_kinds_seed_accounting_mapping
AFTER INSERT ON product_kinds
WHEN EXISTS (
  SELECT 1
  FROM stores s
  WHERE s.id = NEW.store_id
    AND s.edition = 'ACCOUNTING'
)
BEGIN
  INSERT OR IGNORE INTO item_categories (
    id, store_id, product_kind_id, name,
    inventory_account_id, cogs_account_id, revenue_account_id, is_active
  ) VALUES (
    'itemcat_' || NEW.id, NEW.store_id, NEW.id, NEW.name,
    'coa_' || NEW.store_id || '_1301',
    'coa_' || NEW.store_id || '_5101',
    'coa_' || NEW.store_id || '_4101', 1
  );
END;

DROP TRIGGER IF EXISTS trg_payment_methods_cash_default_after_insert;
CREATE TRIGGER trg_payment_methods_cash_default_after_insert
AFTER INSERT ON payment_methods
WHEN NEW.code = 'CASH'
BEGIN
  UPDATE payment_methods SET is_default = CASE WHEN id = NEW.id THEN 1 ELSE 0 END
  WHERE store_id = NEW.store_id;

  INSERT OR IGNORE INTO payment_methods (
    id, store_id, code, name, account_id, is_active, is_default
  )
  SELECT
    'payment_' || NEW.store_id || '_receivable_offset',
    NEW.store_id,
    'RECEIVABLE_OFFSET',
    'Kompensasi Piutang (review)',
    'coa_' || NEW.store_id || '_1201',
    0,
    0
  WHERE EXISTS (
    SELECT 1
    FROM stores s
    WHERE s.id = NEW.store_id
      AND s.edition = 'ACCOUNTING'
  );
END;
