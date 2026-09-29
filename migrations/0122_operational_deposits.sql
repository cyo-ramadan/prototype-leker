PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-26: "kalo misal dibikin beli deposit gitu apa ribet?" --
-- bayar duluan (token listrik, saldo iklan, DP bahan baku) belum tentu
-- langsung jadi Beban semua. Sisa yang belum kepakai/belum diterima tetap
-- nilai yang KITA pegang, bukan Beban, sampai direalisasikan.
--
-- Pola: src/operational-deposits.js membuat baris di
-- operational_receivables_payables (migration 0074/0120/0121) dengan
-- source_type baru (DEPOSIT_LISTRIK/IKLAN/BAHAN_BAKU/LAINNYA), balance_type
-- RECEIVABLE -- nilai yang kita pegang, ditarik belakangan lewat mekanisme
-- pembayaran yang sama dipakai Hutang (addOperationalPayment tidak peduli
-- arah PAYABLE/RECEIVABLE). Realisasinya numpang di dua tombol yang sudah
-- ada: "Pembayaran Lainnya" (listrik/iklan, admin ketik manual berapa yang
-- kepakai) dan cara bayar "Deposit" di form Pembelian kasir (bahan baku,
-- otomatis sebesar barang yang benar-benar diterima) -- TIDAK ada tombol
-- baru untuk pembayarannya, cuma satu tombol baru untuk MEMBUATNYA.
--
-- GOTCHA (migration 0120): ALTER TABLE ... RENAME menulis ulang body setiap
-- trigger DI TABEL LAIN yang menyebut nama tabel ini, dan gagal "no such
-- table" kalau dilakukan sementara tabelnya baru saja di-drop lalu
-- di-rename balik. Ketiga trigger di operational_receivable_payable_payments
-- wajib di-drop dulu SEBELUM drop+rename, baru dibuat ulang sesudahnya.
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
    'BEA_LAINNYA',
    'DEPOSIT_LISTRIK',
    'DEPOSIT_IKLAN',
    'DEPOSIT_BAHAN_BAKU',
    'DEPOSIT_LAINNYA'
  )),
  balance_type                TEXT NOT NULL CHECK (balance_type IN ('RECEIVABLE', 'PAYABLE')),
  source_id                   TEXT NOT NULL,
  counterparty_id             TEXT,
  counterparty_name_snapshot  TEXT NOT NULL,
  description                 TEXT NOT NULL DEFAULT '',
  original_amount             INTEGER NOT NULL CHECK (original_amount > 0),
  transaction_date            TEXT NOT NULL,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  counterparty_type           TEXT NOT NULL DEFAULT 'OTHER' CHECK (counterparty_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id),
  CHECK (
    (source_type IN ('SALE_RECEIVABLE', 'EMPLOYEE_DEPOSIT', 'DEPOSIT_LISTRIK', 'DEPOSIT_IKLAN', 'DEPOSIT_BAHAN_BAKU', 'DEPOSIT_LAINNYA') AND balance_type = 'RECEIVABLE')
    OR
    (source_type IN ('PURCHASE_PAYABLE', 'COST_PAYABLE', 'BEA_LAPAK', 'BEA_LAINNYA') AND balance_type = 'PAYABLE')
  )
);

INSERT INTO operational_receivables_payables_new (
  id, store_id, entity_id, source_type, balance_type, source_id,
  counterparty_id, counterparty_name_snapshot, description, original_amount,
  transaction_date, created_at, counterparty_type
)
SELECT
  id, store_id, entity_id, source_type, balance_type, source_id,
  counterparty_id, counterparty_name_snapshot, description, original_amount,
  transaction_date, created_at, counterparty_type
FROM operational_receivables_payables;

DROP TABLE operational_receivables_payables;
ALTER TABLE operational_receivables_payables_new RENAME TO operational_receivables_payables;

CREATE INDEX IF NOT EXISTS idx_operational_rp_store_created
  ON operational_receivables_payables(store_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_entity_created
  ON operational_receivables_payables(entity_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_store_source
  ON operational_receivables_payables(store_id, source_type, source_id);

-- Tiga trigger ini dipulihkan PERSIS SAMA seperti sebelumnya -- korban tak
-- berdosa dari rebuild di atas (lihat GOTCHA), bukan perubahan perilaku.
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

-- admin_payments (migration 0121) belum punya baris produksi (dibuktikan
-- 2026-09-26 sebelum migration ini ditulis) -- aman di-rebuild untuk
-- melebarkan payment_method dan menambah deposit_id. Tidak ada trigger lain
-- yang menyebut nama tabel ini, jadi tidak kena GOTCHA di atas.
CREATE TABLE admin_payments_new (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  entity_id TEXT REFERENCES entities(id),
  kind TEXT NOT NULL CHECK (kind IN ('HUTANG', 'LAINNYA')),
  hutang_account TEXT NOT NULL DEFAULT '',
  counterparty_type TEXT NOT NULL DEFAULT 'OTHER' CHECK (counterparty_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
  counterparty_id TEXT,
  counterparty_name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('KAS', 'BANK', 'REKBER', 'DEPOSIT')),
  shared_account_id TEXT REFERENCES entity_shared_accounts(id),
  shared_ledger_id TEXT REFERENCES entity_shared_account_ledger(id),
  deposit_id TEXT REFERENCES operational_receivables_payables(id),
  expense_id TEXT REFERENCES admin_operational_expenses(id),
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  note TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by_role TEXT NOT NULL DEFAULT '',
  voided_by_id TEXT NOT NULL DEFAULT '',
  void_reason TEXT NOT NULL DEFAULT '',
  void_shared_ledger_id TEXT REFERENCES entity_shared_account_ledger(id),
  CHECK ((payment_method = 'REKBER') = (shared_account_id IS NOT NULL)),
  CHECK ((payment_method = 'DEPOSIT') = (deposit_id IS NOT NULL)),
  CHECK (kind <> 'LAINNYA' OR expense_id IS NOT NULL),
  CHECK (kind <> 'HUTANG' OR hutang_account <> '')
);

INSERT INTO admin_payments_new SELECT
  id, store_id, entity_id, kind, hutang_account, counterparty_type, counterparty_id, counterparty_name,
  amount, payment_method, shared_account_id, shared_ledger_id, NULL, expense_id, business_date, note,
  created_by_role, created_by_id, created_at, voided_at, voided_by_role, voided_by_id, void_reason, void_shared_ledger_id
FROM admin_payments;

DROP TABLE admin_payments;
ALTER TABLE admin_payments_new RENAME TO admin_payments;

CREATE INDEX IF NOT EXISTS idx_admin_payments_store_date ON admin_payments(store_id, business_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_payments_counterparty ON admin_payments(store_id, counterparty_type, counterparty_id);

CREATE TRIGGER IF NOT EXISTS trg_admin_payments_shared_account_scope
BEFORE INSERT ON admin_payments
WHEN NEW.shared_account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entity_shared_accounts sa
    JOIN stores s ON s.entity_id = sa.entity_id
    WHERE sa.id = NEW.shared_account_id AND s.id = NEW.store_id
  )
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_PAYMENT_SHARED_ACCOUNT_SCOPE_MISMATCH');
END;

CREATE TRIGGER IF NOT EXISTS trg_admin_payments_core_immutable
BEFORE UPDATE OF store_id, entity_id, kind, hutang_account, counterparty_type, counterparty_id, counterparty_name,
  amount, payment_method, shared_account_id, shared_ledger_id, deposit_id, expense_id, business_date, created_at
ON admin_payments
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_PAYMENT_CORE_FIELDS_IMMUTABLE');
END;

-- Pembelian kasir yang dibayar dari Deposit (bahan baku) -- lihat
-- src/cashier-purchase.js. Nullable, tidak menyentuh baris lama.
ALTER TABLE purchases ADD COLUMN deposit_id TEXT REFERENCES operational_receivables_payables(id);
