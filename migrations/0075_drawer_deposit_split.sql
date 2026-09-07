PRAGMA foreign_keys = ON;

-- 2026-09-06, Bos Cyo: saat tutup laci, CS pisahkan berapa yang DITITIPKAN ke
-- laci (lanjut jadi modal buka laci shift berikutnya, PERSIS seperti
-- closing_amount hari ini) dari sisanya yang jadi SETORAN. Kolom baru ini
-- cuma menyimpan porsi setoran; opening_amount shift berikutnya dihitung di
-- src/cashier-drawer.js sebagai (closing_amount - deposit_amount), bukan lagi
-- closing_amount penuh.
--
-- Fakta piutangnya sendiri TIDAK disimpan di sini -- itu masuk ke
-- operational_receivables_payables (migration 0074, source_type
-- EMPLOYEE_DEPOSIT) yang memang sudah schema-ready untuk kasus ini, supaya
-- tidak ada tabel piutang kedua yang paralel.
ALTER TABLE cash_drawer_sessions ADD COLUMN deposit_amount INTEGER NOT NULL DEFAULT 0;

-- Piutang Karyawan memakai registry chart_of_accounts canonical. Hanya edition
-- ACCOUNTING yang menerima akun ini; LITE/FLEXIBLE tetap menyimpan fakta
-- operasional tanpa dependency ke ledger. Gagal tertutup jika code/id 1202
-- sudah dipakai untuk akun lain, supaya bridge tidak pernah salah posting.
CREATE TABLE employee_deposit_account_code_guard_0075 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO employee_deposit_account_code_guard_0075 (ok)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM stores s
  JOIN chart_of_accounts a ON a.store_id = s.id
  WHERE s.edition = 'ACCOUNTING'
    AND (
      (a.code = '1202' AND (
        a.id <> 'coa_' || s.id || '_1202'
        OR a.name <> 'Piutang Karyawan'
        OR a.type <> 'ASSET'
        OR COALESCE(a.subtype, '') <> 'RECEIVABLE'
      ))
      OR (a.id = 'coa_' || s.id || '_1202' AND (
        a.code <> '1202'
        OR a.name <> 'Piutang Karyawan'
        OR a.type <> 'ASSET'
        OR COALESCE(a.subtype, '') <> 'RECEIVABLE'
      ))
    )
) THEN 1 ELSE 0 END;
DROP TABLE employee_deposit_account_code_guard_0075;

INSERT OR IGNORE INTO chart_of_accounts (
  id, store_id, code, name, type, subtype, is_active
)
SELECT
  'coa_' || id || '_1202', id, '1202', 'Piutang Karyawan',
  'ASSET', 'RECEIVABLE', 1
FROM stores
WHERE edition = 'ACCOUNTING';

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
