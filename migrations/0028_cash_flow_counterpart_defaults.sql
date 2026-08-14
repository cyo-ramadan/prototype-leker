ALTER TABLE journal_rules ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_rules_one_default
  ON journal_rules(store_id, transaction_category_id)
  WHERE is_active = 1 AND source_type = 'fixed_account' AND is_default = 1;

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || id || '_4202', id, '4202', 'Pendapatan Lainnya', 'REVENUE', 'OTHER_INCOME', 1 FROM stores;
INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || id || '_6104', id, '6104', 'Beban Lainnya', 'EXPENSE', 'OTHER_EXPENSE', 1 FROM stores;

INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module)
SELECT 'txcat_' || id || '_cash_flow_in', id, 'cash_flow_in', 'Arus Kas Masuk', 1, 0, 1, 'Debit kas; Credit akun lawan pilihan.', 'ACCOUNTING' FROM stores;
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module)
SELECT 'txcat_' || id || '_cash_flow_out', id, 'cash_flow_out', 'Arus Kas Keluar', 1, 0, 1, 'Debit akun lawan pilihan; Credit kas.', 'ACCOUNTING' FROM stores;

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || id || '_cash_flow_in_cash', id, 'txcat_' || id || '_cash_flow_in', 'Kas / settlement masuk', 'DEBIT', 'payment_method', 10 FROM stores;
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
SELECT 'jrule_' || id || '_cash_flow_in_other_income', id, 'txcat_' || id || '_cash_flow_in', 'Pendapatan Lainnya', 'CREDIT', 'fixed_account', 'coa_' || id || '_4202', 1, 20 FROM stores;
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
SELECT 'jrule_' || id || '_cash_flow_out_other_expense', id, 'txcat_' || id || '_cash_flow_out', 'Beban Lainnya', 'DEBIT', 'fixed_account', 'coa_' || id || '_6104', 1, 10 FROM stores;
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || id || '_cash_flow_out_cash', id, 'txcat_' || id || '_cash_flow_out', 'Kas / settlement keluar', 'CREDIT', 'payment_method', 20 FROM stores;

CREATE TRIGGER IF NOT EXISTS trg_stores_cash_flow_defaults_after_insert
AFTER INSERT ON stores
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active) VALUES ('coa_' || NEW.id || '_4202', NEW.id, '4202', 'Pendapatan Lainnya', 'REVENUE', 'OTHER_INCOME', 1);
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active) VALUES ('coa_' || NEW.id || '_6104', NEW.id, '6104', 'Beban Lainnya', 'EXPENSE', 'OTHER_EXPENSE', 1);
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_cash_flow_in', NEW.id, 'cash_flow_in', 'Arus Kas Masuk', 1, 0, 1, 'Debit kas; Credit akun lawan pilihan.', 'ACCOUNTING');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_cash_flow_out', NEW.id, 'cash_flow_out', 'Arus Kas Keluar', 1, 0, 1, 'Debit akun lawan pilihan; Credit kas.', 'ACCOUNTING');
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_cash_flow_in_cash', NEW.id, 'txcat_' || NEW.id || '_cash_flow_in', 'Kas / settlement masuk', 'DEBIT', 'payment_method', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order) VALUES ('jrule_' || NEW.id || '_cash_flow_in_other_income', NEW.id, 'txcat_' || NEW.id || '_cash_flow_in', 'Pendapatan Lainnya', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_4202', 1, 20);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order) VALUES ('jrule_' || NEW.id || '_cash_flow_out_other_expense', NEW.id, 'txcat_' || NEW.id || '_cash_flow_out', 'Beban Lainnya', 'DEBIT', 'fixed_account', 'coa_' || NEW.id || '_6104', 1, 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_cash_flow_out_cash', NEW.id, 'txcat_' || NEW.id || '_cash_flow_out', 'Kas / settlement keluar', 'CREDIT', 'payment_method', 20);
END;
