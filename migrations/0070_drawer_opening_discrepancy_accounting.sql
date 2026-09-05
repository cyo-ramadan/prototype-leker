PRAGMA foreign_keys = ON;

-- 2026-09-04, Bos Cyo: kalau saldo awal laci (dientry manual, lihat migration
-- 0069) tidak sama dengan saldo akhir laci sebelumnya di gerai itu, ACC atas
-- permit-nya di Approval Queue sekarang harus langsung memposting jurnal --
-- bukan cuma flag pasif seperti sebelumnya (migration ini menggantikan
-- keputusan "tidak posting apa pun" yang sempat dikirim sebelumnya hari ini).
--
-- Dua kategori Jenis Transaksi baru, mengikuti pola persis cash_flow_in/out
-- (migration 0028/0049) -- gerbang edition='ACCOUNTING' saja, konsisten
-- dengan "kalau gerai tidak pakai modul Akuntansi, ini tetap cuma flag":
--
-- drawer_shortage (saldo kurang / "uang hilang"): Debit akun lawan (Beban
--   Uang Hilang), Credit Kas. Cuma kaki Kas (payment_method) yang di-seed --
--   kaki fixed_account SENGAJA tidak ikut di-seed di sini. journal_rules
--   punya CHECK constraint eksplisit: baris source_type='fixed_account'
--   WAJIB punya fixed_account_id terisi (tidak boleh "placeholder kosong"
--   menunggu diisi belakangan) -- jadi kategori ini genuinely belum
--   tersambung (bakal keluar NEEDS_MAPPING) sampai Owner bikin akun "Beban
--   Uang Hilang" DAN rule-nya sekaligus lewat Setting Akuntansi yang sudah
--   ada, persis seperti keputusan "configurable per gerai" yang diminta.
-- drawer_surplus (saldo lebih / "uang lebih"): Debit Kas, Credit akun lawan.
--   Bos Cyo eksplisit minta pakai "kode awal akun Pendapatan Lainnya" --
--   akun itu SUDAH ada (coa_<store>_4202, dipakai juga sebagai default
--   cash_flow_in sejak migration 0028), jadi kedua kaki di-pre-seed
--   langsung, siap pakai tanpa perlu setup Owner dulu.
--
-- Kedua arah tetap PR akuntan sebelum tutup bulan: default account di sini
-- cuma titik awal, bukan klasifikasi final -- reklasifikasi ke akun yang
-- tepat (mis. siapa yang menanggung) tetap lewat jurnal manual yang sudah
-- ada di Accounting Workspace, bukan sesuatu yang dibangun di migration ini.
--
-- coa_<store>_4202 di-INSERT OR IGNORE lagi di sini (persis definisi yang
-- sama dengan trigger cash_flow 0049) dengan sengaja, bukan diasumsikan
-- sudah ada dari trigger lain. Dibuktikan langsung: trigger AFTER INSERT ON
-- stores yang lebih dari satu untuk event yang sama TIDAK bisa diandalkan
-- urutan eksekusinya (trg_stores_drawer_discrepancy_defaults_after_insert
-- sempat jalan sebelum trg_stores_cash_flow_defaults_after_insert sempat
-- membuat baris coa_..._4202 miliknya sendiri, bikin RAISE(ABORT)
-- JOURNAL_RULE_SCOPE_MISMATCH dari trg_journal_rule_scope_insert, dan itu
-- me-rollback SELURUH INSERT INTO stores termasuk efek trigger lain).
-- INSERT OR IGNORE di sini membuat trigger ini self-sufficient terlepas
-- dari urutan trigger lain jalan duluan atau belakangan.

INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module)
SELECT 'txcat_' || id || '_drawer_shortage', id, 'drawer_shortage', 'Selisih Saldo Awal Laci (Kurang)', 1, 0, 1, 'Debit akun lawan (Beban Uang Hilang, belum dikonfigurasi); Credit Kas.', 'ACCOUNTING' FROM stores WHERE edition = 'ACCOUNTING';
INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module)
SELECT 'txcat_' || id || '_drawer_surplus', id, 'drawer_surplus', 'Selisih Saldo Awal Laci (Lebih)', 1, 0, 1, 'Debit Kas; Credit akun lawan (Pendapatan Lainnya).', 'ACCOUNTING' FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || id || '_drawer_shortage_cash', id, 'txcat_' || id || '_drawer_shortage', 'Kas / saldo awal laci', 'CREDIT', 'payment_method', 10 FROM stores WHERE edition = 'ACCOUNTING';

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || id || '_4202', id, '4202', 'Pendapatan Lainnya', 'REVENUE', 'OTHER_INCOME', 1 FROM stores WHERE edition = 'ACCOUNTING';
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order)
SELECT 'jrule_' || id || '_drawer_surplus_cash', id, 'txcat_' || id || '_drawer_surplus', 'Kas / saldo awal laci', 'DEBIT', 'payment_method', 10 FROM stores WHERE edition = 'ACCOUNTING';
INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
SELECT 'jrule_' || id || '_drawer_surplus_other_income', id, 'txcat_' || id || '_drawer_surplus', 'Pendapatan Lainnya', 'CREDIT', 'fixed_account', 'coa_' || id || '_4202', 1, 20 FROM stores WHERE edition = 'ACCOUNTING';

DROP TRIGGER IF EXISTS trg_stores_drawer_discrepancy_defaults_after_insert;
CREATE TRIGGER trg_stores_drawer_discrepancy_defaults_after_insert
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
BEGIN
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_drawer_shortage', NEW.id, 'drawer_shortage', 'Selisih Saldo Awal Laci (Kurang)', 1, 0, 1, 'Debit akun lawan (Beban Uang Hilang, belum dikonfigurasi); Credit Kas.', 'ACCOUNTING');
  INSERT OR IGNORE INTO transaction_categories (id, store_id, code, name, involves_payment, involves_item_category, is_active, description, registered_by_module) VALUES ('txcat_' || NEW.id || '_drawer_surplus', NEW.id, 'drawer_surplus', 'Selisih Saldo Awal Laci (Lebih)', 1, 0, 1, 'Debit Kas; Credit akun lawan (Pendapatan Lainnya).', 'ACCOUNTING');
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_drawer_shortage_cash', NEW.id, 'txcat_' || NEW.id || '_drawer_shortage', 'Kas / saldo awal laci', 'CREDIT', 'payment_method', 10);
  INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active) VALUES ('coa_' || NEW.id || '_4202', NEW.id, '4202', 'Pendapatan Lainnya', 'REVENUE', 'OTHER_INCOME', 1);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, sort_order) VALUES ('jrule_' || NEW.id || '_drawer_surplus_cash', NEW.id, 'txcat_' || NEW.id || '_drawer_surplus', 'Kas / saldo awal laci', 'DEBIT', 'payment_method', 10);
  INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order) VALUES ('jrule_' || NEW.id || '_drawer_surplus_other_income', NEW.id, 'txcat_' || NEW.id || '_drawer_surplus', 'Pendapatan Lainnya', 'CREDIT', 'fixed_account', 'coa_' || NEW.id || '_4202', 1, 20);
END;
