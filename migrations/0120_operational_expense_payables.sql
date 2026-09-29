PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-26: "lapak juga lewat hutang dulu aja ... jadi nanti
-- pembayaran2 by admin tinggal bayar2 hutang aja". Bea Lapak dan Bea Lainnya
-- sekarang bisa membentuk Hutang lewat operational_receivables_payables
-- (migration 0074) -- modul hutang-piutang generik yang SUDAH ADA dan sudah
-- dipakai untuk piutang setoran laci (EMPLOYEE_DEPOSIT, src/employee-deposit-
-- settlement.js). Pola ekstensinya sama: modul baru (src/operational-expense-
-- payables.js) INSERT langsung ke tabel ini dengan source_type barunya
-- sendiri, lalu pakai ulang addOperationalPayment/getOperationalReceivablePayable/
-- listOperationalReceivablesPayables yang sudah ada untuk siklus pembayarannya.
--
-- Bea Gaji SENGAJA TIDAK ikut lewat sini -- bentuknya beda: gaji numpuk
-- otomatis berkali-kali sehari dari presensi (payroll_ledger_entries,
-- migration 0116, ACCRUAL), sedangkan modul di tabel ini bentuknya "satu
-- baris = satu tagihan, dilunasi bertahap" (original_amount tetap, dicicil
-- lewat operational_receivable_payable_payments) -- cocok untuk tagihan Lapak/
-- Lainnya yang dicatat manual sesekali, tidak cocok untuk akrual per-shift.
-- Dijelaskan ke Bos Cyo di sesi yang sama, lihat KNOWN_ISSUES.md.
--
-- SQLite tidak bisa ALTER CHECK constraint, jadi tabel di-rebuild -- pola
-- yang sama dengan migration 0116 (admin_operational_expenses_new).
--
-- GOTCHA (ditemukan langsung menjalankan migration ini): ALTER TABLE ...
-- RENAME menulis ulang body setiap trigger DI TABEL LAIN yang menyebut nama
-- tabel ini di dalam SELECT-nya, dan proses tulis-ulang itu gagal dengan
-- "no such table" kalau dilakukan sementara tabelnya baru saja di-drop lalu
-- di-rename balik. Tiga trigger di operational_receivable_payable_payments
-- (migration 0074) menyebut operational_receivables_payables di body-nya --
-- SEMUANYA wajib di-drop dulu SEBELUM drop+rename tabel ini, baru dibuat
-- ulang sesudahnya. Jangan cuma drop trigger yang mau diubah isinya.
DROP TRIGGER IF EXISTS trg_operational_rp_payment_scope_insert;
DROP TRIGGER IF EXISTS trg_employee_deposit_payment_insert_guard;
DROP TRIGGER IF EXISTS trg_employee_deposit_payment_update_guard;

CREATE TABLE operational_receivables_payables_new (
  id                          TEXT PRIMARY KEY,
  store_id                    TEXT NOT NULL,
  entity_id                   TEXT NOT NULL,
  source_type                 TEXT NOT NULL CHECK (source_type IN (
    'SALE_RECEIVABLE',
    'PURCHASE_PAYABLE',
    'COST_PAYABLE',
    'EMPLOYEE_DEPOSIT',
    'BEA_LAPAK',
    'BEA_LAINNYA'
  )),
  balance_type                TEXT NOT NULL CHECK (balance_type IN ('RECEIVABLE', 'PAYABLE')),
  source_id                   TEXT NOT NULL,
  counterparty_id             TEXT,
  counterparty_name_snapshot  TEXT NOT NULL,
  description                 TEXT NOT NULL DEFAULT '',
  original_amount             INTEGER NOT NULL CHECK (original_amount > 0),
  transaction_date            TEXT NOT NULL,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  CHECK (
    (source_type IN ('SALE_RECEIVABLE', 'EMPLOYEE_DEPOSIT') AND balance_type = 'RECEIVABLE')
    OR
    (source_type IN ('PURCHASE_PAYABLE', 'COST_PAYABLE', 'BEA_LAPAK', 'BEA_LAINNYA') AND balance_type = 'PAYABLE')
  )
);

INSERT INTO operational_receivables_payables_new (
  id, store_id, entity_id, source_type, balance_type, source_id,
  counterparty_id, counterparty_name_snapshot, description, original_amount,
  transaction_date, created_at
)
SELECT
  id, store_id, entity_id, source_type, balance_type, source_id,
  counterparty_id, counterparty_name_snapshot, description, original_amount,
  transaction_date, created_at
FROM operational_receivables_payables;

DROP TABLE operational_receivables_payables;
ALTER TABLE operational_receivables_payables_new RENAME TO operational_receivables_payables;

CREATE INDEX IF NOT EXISTS idx_operational_rp_store_created
  ON operational_receivables_payables(store_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_entity_created
  ON operational_receivables_payables(entity_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_store_source
  ON operational_receivables_payables(store_id, source_type, source_id);

-- Dua trigger EMPLOYEE_DEPOSIT ini dipulihkan PERSIS SAMA seperti migration
-- 0074 -- tidak ada perubahan perilaku, cuma korban tak berdosa dari rebuild
-- tabel di atas (lihat GOTCHA).
CREATE TRIGGER trg_employee_deposit_payment_insert_guard
BEFORE INSERT ON operational_receivable_payable_payments
WHEN NEW.store_id = 'store_ikan01'
 AND EXISTS (
   SELECT 1 FROM operational_receivables_payables r
   WHERE r.id = NEW.receivable_payable_id
     AND r.source_type = 'EMPLOYEE_DEPOSIT'
 )
 AND (
   trim(NEW.proof_reference) = ''
   OR (NEW.approval_status = 'approved'
       AND (trim(NEW.reviewed_by) = '' OR NEW.reviewed_at IS NULL))
 )
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_DEPOSIT_PAYMENT_REQUIRES_APPROVAL');
END;

CREATE TRIGGER trg_employee_deposit_payment_update_guard
BEFORE UPDATE OF approval_status, reviewed_by, reviewed_at
ON operational_receivable_payable_payments
WHEN NEW.store_id = 'store_ikan01'
 AND NEW.approval_status = 'approved'
 AND EXISTS (
   SELECT 1 FROM operational_receivables_payables r
   WHERE r.id = NEW.receivable_payable_id
     AND r.source_type = 'EMPLOYEE_DEPOSIT'
 )
 AND (trim(NEW.reviewed_by) = '' OR NEW.reviewed_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'EMPLOYEE_DEPOSIT_PAYMENT_REQUIRES_APPROVAL');
END;

-- Guard scope pembayaran (migration 0074) cuma menyala untuk
-- store_id = 'store_ikan01' -- itu aman selama tabelnya cuma dipakai Ikan.
-- Sekarang gerai Leker biasa ikut pakai tabel ini (BEA_LAPAK/BEA_LAINNYA),
-- jadi guard-nya WAJIB berlaku ke semua store, bukan cuma Ikan -- kalau
-- tidak, pembayaran gerai Leker bisa nyasar ke baris hutang gerai lain tanpa
-- ketahuan. Ini SATU-SATUNYA perubahan perilaku di migration ini.
CREATE TRIGGER trg_operational_rp_payment_scope_insert
BEFORE INSERT ON operational_receivable_payable_payments
WHEN NOT EXISTS (
   SELECT 1
   FROM operational_receivables_payables r
   WHERE r.id = NEW.receivable_payable_id
     AND r.store_id = NEW.store_id
     AND r.entity_id = NEW.entity_id
 )
BEGIN
  SELECT RAISE(ABORT, 'OPERATIONAL_PAYMENT_SCOPE_MISMATCH');
END;
