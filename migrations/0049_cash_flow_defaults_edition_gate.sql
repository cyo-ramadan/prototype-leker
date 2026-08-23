PRAGMA foreign_keys = ON;

-- MAXI-CASH-FLOW-EDITION-GATE-20260823
--
-- Ditemukan dari audit "tabrakan" atas onboarding Galeh (migration 0048, store
-- pertama yang genuinely edition='LITE'). Migration 0045 sudah menggerbang
-- seeding Accounting lain (chart of account inti, product_kind mapping, dst)
-- ke edition='ACCOUNTING', dan komentarnya sendiri bilang: "Residual seed
-- triggers from 0024/0026/0028 intentionally remain outside this phase."
-- Trigger dari 0028 (trg_stores_cash_flow_defaults_after_insert) adalah salah
-- satu residual itu -- dia insert tanpa syarat untuk SETIAP store baru, jadi
-- saat store_ikan01 (LITE) dibuat di 0048, trigger lama tetap menjejalkan
-- chart_of_accounts/transaction_categories/journal_rules Arus Kas ke store
-- yang seharusnya tidak punya jejak Accounting sama sekali (CLAUDE.md
-- invariant #4: Operasional tidak boleh punya foreign key ke interpretasi
-- Accounting).
--
-- Fix dua bagian:
-- 1) Bersihkan baris yang sudah kadung ke-insert untuk store non-ACCOUNTING
--    (saat ini cuma store_ikan01, tapi kondisinya generic untuk store LITE/
--    FLEXIBLE lain di masa depan).
-- 2) Re-gate triggernya sendiri dengan pola yang sama seperti trigger lain
--    di 0045 (WHEN NEW.edition = 'ACCOUNTING'), supaya store baru ke depan
--    tidak kena isu yang sama lagi.

DELETE FROM journal_rules
WHERE store_id IN (SELECT id FROM stores WHERE edition != 'ACCOUNTING')
  AND id LIKE '%_cash_flow_%';

DELETE FROM transaction_categories
WHERE store_id IN (SELECT id FROM stores WHERE edition != 'ACCOUNTING')
  AND code IN ('cash_flow_in', 'cash_flow_out');

DELETE FROM chart_of_accounts
WHERE store_id IN (SELECT id FROM stores WHERE edition != 'ACCOUNTING')
  AND code IN ('4202', '6104');

-- Body trigger di bawah dipertahankan byte-for-byte dari 0028 untuk edisi
-- ACCOUNTING; satu-satunya perubahan adalah menambahkan WHEN clause.
DROP TRIGGER IF EXISTS trg_stores_cash_flow_defaults_after_insert;
CREATE TRIGGER trg_stores_cash_flow_defaults_after_insert
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
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
