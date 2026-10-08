-- ADR-054 (Bos Cyo, 2026-10-08): "setiap bikin tenant atau gerai baru wajib banget untuk konekin jurnal
-- wajibnya". Dua perlengkapan Akuntansi tidak ikut terpasang di gerai yang dibuat belakangan
-- (dibuktikan ke D1 produksi 2026-10-08, bukan dugaan):
--
-- 1. Akun 1202 Piutang Karyawan. Trigger trg_stores_employee_deposit_accounting_defaults_after_insert
--    (migration 0075) TIDAK ADA di sqlite_schema produksi, padahal ada di rantai migration. LAB01 dan
--    PARFUM01 (dibuat 2026-10-01 dan 2026-10-06) tidak punya akun 1202 -> setoran CS mereka akan
--    tertahan EMPLOYEE_DEPOSIT_ACCOUNTING_ACCOUNTS_MISSING. Invariant #7: migration lama tidak
--    ditulis ulang; trigger yang terbukti hilang dipasang ulang di sini dengan isi yang sama persis.
-- 2. Aturan jurnal Jenis Transaksi "operational" (Beban Kasir). Migration 0035 hanya mengisinya
--    sekali untuk gerai yang ada saat itu, tanpa trigger. KANTOR, LAB01, PARFUM01 tidak punya aturan
--    sama sekali -> Beban Kasir mereka akan tertahan di Setting Akuntansi.
--
-- Gerai baru sesudah ini dipasangi lewat src/gerai-jurnal-wajib.js (dipanggil sesudah gerai dibuat,
-- tidak bergantung urutan trigger). Semua langkah hanya mengisi yang belum ada: gerai yang aturannya
-- sudah dipasang akuntan (id apa pun) tidak disentuh.

DROP TRIGGER IF EXISTS trg_stores_employee_deposit_accounting_defaults_after_insert;
CREATE TRIGGER trg_stores_employee_deposit_accounting_defaults_after_insert
AFTER INSERT ON stores
WHEN NEW.edition = 'ACCOUNTING'
BEGIN
  INSERT OR IGNORE INTO chart_of_accounts (
    id, store_id, code, name, type, subtype, is_active
  ) VALUES (
    'coa_' || NEW.id || '_1202', NEW.id, '1202', 'Piutang Karyawan',
    'ASSET', 'RECEIVABLE', 1
  );
END;

INSERT OR IGNORE INTO chart_of_accounts (id, store_id, code, name, type, subtype, is_active)
SELECT 'coa_' || s.id || '_1202', s.id, '1202', 'Piutang Karyawan', 'ASSET', 'RECEIVABLE', 1
FROM stores s
WHERE s.edition = 'ACCOUNTING'
  AND NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.store_id = s.id AND c.code = '1202');

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, fixed_account_id, is_default, sort_order)
SELECT 'jrule_' || tc.store_id || '_operational_expense', tc.store_id, tc.id, 'Beban Operasional', 'DEBIT',
       'fixed_account', a.id, 1, 10
FROM transaction_categories tc
JOIN stores s ON s.id = tc.store_id AND s.edition = 'ACCOUNTING'
JOIN chart_of_accounts a ON a.store_id = tc.store_id AND a.code = '6101' AND a.is_active = 1
WHERE tc.code = 'operational'
  AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.transaction_category_id = tc.id AND r.side = 'DEBIT' AND r.is_active = 1);

INSERT OR IGNORE INTO journal_rules (id, store_id, transaction_category_id, label, side, source_type, is_default, sort_order)
SELECT 'jrule_' || tc.store_id || '_operational_payment', tc.store_id, tc.id, 'Pembayaran Operasional', 'CREDIT',
       'payment_method', 1, 20
FROM transaction_categories tc
JOIN stores s ON s.id = tc.store_id AND s.edition = 'ACCOUNTING'
WHERE tc.code = 'operational'
  AND NOT EXISTS (SELECT 1 FROM journal_rules r WHERE r.transaction_category_id = tc.id AND r.side = 'CREDIT' AND r.is_active = 1);
