PRAGMA foreign_keys = ON;

-- Piutang/hutang Operasional berdiri sendiri dari Accounting. Baris sumber
-- menyimpan nominal authoritative sebagai scaled INTEGER; saldo selalu dihitung
-- dari nominal sumber dikurangi payment history berstatus approved.
CREATE TABLE IF NOT EXISTS operational_receivables_payables (
  id                          TEXT PRIMARY KEY,
  store_id                    TEXT NOT NULL,
  entity_id                   TEXT NOT NULL,
  source_type                 TEXT NOT NULL CHECK (source_type IN (
    'SALE_RECEIVABLE',
    'PURCHASE_PAYABLE',
    'COST_PAYABLE',
    'EMPLOYEE_DEPOSIT'
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
    (source_type IN ('PURCHASE_PAYABLE', 'COST_PAYABLE') AND balance_type = 'PAYABLE')
  )
);

CREATE INDEX IF NOT EXISTS idx_operational_rp_store_created
  ON operational_receivables_payables(store_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_entity_created
  ON operational_receivables_payables(entity_id, transaction_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_rp_store_source
  ON operational_receivables_payables(store_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS operational_receivable_payable_payments (
  id                     TEXT PRIMARY KEY,
  receivable_payable_id  TEXT NOT NULL,
  store_id               TEXT NOT NULL,
  entity_id              TEXT NOT NULL,
  amount                 INTEGER NOT NULL CHECK (amount > 0),
  approval_status        TEXT NOT NULL DEFAULT 'approved'
                         CHECK (approval_status IN ('pending_approval', 'approved', 'rejected')),
  proof_reference        TEXT NOT NULL DEFAULT '',
  note                   TEXT NOT NULL DEFAULT '',
  submitted_by           TEXT NOT NULL DEFAULT '',
  reviewed_by            TEXT NOT NULL DEFAULT '',
  reviewed_at            TEXT,
  rejection_reason       TEXT NOT NULL DEFAULT '',
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (receivable_payable_id) REFERENCES operational_receivables_payables(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE INDEX IF NOT EXISTS idx_operational_rp_payment_store_parent
  ON operational_receivable_payable_payments(store_id, receivable_payable_id, approval_status, created_at);
CREATE INDEX IF NOT EXISTS idx_operational_rp_payment_entity_parent
  ON operational_receivable_payable_payments(entity_id, receivable_payable_id, approval_status, created_at);

-- Trigger hanya hidup pada tabel baru dan hanya untuk pilot Ikan. Tidak ada
-- trigger di sales/purchases/products atau tabel gerai Leker yang sudah ada.
CREATE TRIGGER IF NOT EXISTS trg_operational_rp_payment_scope_insert
BEFORE INSERT ON operational_receivable_payable_payments
WHEN NEW.store_id = 'store_ikan01'
 AND NOT EXISTS (
   SELECT 1
   FROM operational_receivables_payables r
   WHERE r.id = NEW.receivable_payable_id
     AND r.store_id = NEW.store_id
     AND r.entity_id = NEW.entity_id
 )
BEGIN
  SELECT RAISE(ABORT, 'OPERATIONAL_PAYMENT_SCOPE_MISMATCH');
END;

-- Bukti transfer karyawan masuk sebagai pending_approval. Baris itu baru boleh
-- menjadi approved jika bukti review Admin Finance ikut tersimpan; query saldo
-- di aplikasi hanya menghitung payment approved.
CREATE TRIGGER IF NOT EXISTS trg_employee_deposit_payment_insert_guard
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

CREATE TRIGGER IF NOT EXISTS trg_employee_deposit_payment_update_guard
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
