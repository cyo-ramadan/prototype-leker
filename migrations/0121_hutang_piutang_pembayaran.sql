PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-26: "bea operasional itu kita bikin tombol kusus untuk
-- membuat hutang ... lalu kita bikin tombol lagi di sisi admin misal kita
-- kusus pembayaran hutang/piutang ... isi nominal dan cara bayarnya bisa
-- rekber atau lainnya ... untuk sementara kita bikin 2 tombol saja, ada
-- kusus pembayaran hutang piutang. dan pembayaran lainnya." Lalu: "rekber
-- nya jangan dijadikan label tapi udah bener2 jadi rekening bersama", "yang
-- cara bayarnya hutang ke suplier ikut disambungkan ke catatan hutang kita",
-- dan laporan Hutang Piutang per orang + Laporan Beban.
--
-- Aturannya satu untuk semua jenis: Bea Operasional = satu-satunya pintu
-- MEMBUAT Hutang + mengakui Beban; Pembayaran Hutang/Piutang = satu-satunya
-- pintu MELUNASI (cash-neutral terhadap Laporan Net Profit). Lihat
-- src/hutang-piutang.js dan KNOWN_ISSUES.md.
--
-- Semua perubahan di sini ADD COLUMN / CREATE TABLE -- tidak ada tabel lama
-- yang di-rebuild, jadi trigger lama (migration 0074/0111/0120) tidak
-- tersentuh.

-- 1. Cara bayar mana yang artinya "jadi Hutang" (dipilih admin sendiri di
--    Setting Akuntansi > Metode Pembayaran). Kasir di produksi TIDAK memakai
--    PAYABLE bawaan -- mereka memakai cara bayar buatan admin (mis. "Piutang
--    Poci Malang"), jadi Hana tidak menebak mana yang hutang: hanya PAYABLE
--    ("Hutang / Utang Usaha") yang ditandai dari awal.
ALTER TABLE payment_methods ADD COLUMN creates_payable INTEGER NOT NULL DEFAULT 0 CHECK (creates_payable IN (0, 1));
UPDATE payment_methods SET creates_payable = 1 WHERE code = 'PAYABLE';

-- 2. Siapa pihaknya, supaya Hutang Piutang bisa direkap PER ORANG (Supplier
--    dari Master Supplier, Karyawan dari Master Karyawan, atau nama bebas).
ALTER TABLE operational_receivables_payables ADD COLUMN counterparty_type TEXT NOT NULL DEFAULT 'OTHER'
  CHECK (counterparty_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER'));
-- EMPLOYEE_DEPOSIT (piutang setoran laci) sejak awal menyimpan employee_id
-- di counterparty_id (src/employee-deposit-settlement.js).
UPDATE operational_receivables_payables SET counterparty_type = 'EMPLOYEE' WHERE source_type = 'EMPLOYEE_DEPOSIT';

-- 3. Header satu pembayaran Admin (uang keluar di luar laci kasir): pelunasan
--    Hutang ATAU pembayaran lainnya. Ini juga fondasi Laporan Cashflow nanti.
--    Nominal rupiah bulat -- pola yang sama dengan admin_operational_expenses
--    dan entity_shared_account_ledger (ledger operasional non-Akuntansi).
CREATE TABLE IF NOT EXISTS admin_payments (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  entity_id TEXT REFERENCES entities(id),
  kind TEXT NOT NULL CHECK (kind IN ('HUTANG', 'LAINNYA')),
  hutang_account TEXT NOT NULL DEFAULT '',
  counterparty_type TEXT NOT NULL DEFAULT 'OTHER' CHECK (counterparty_type IN ('SUPPLIER', 'EMPLOYEE', 'OTHER')),
  counterparty_id TEXT,
  counterparty_name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('KAS', 'BANK', 'REKBER')),
  shared_account_id TEXT REFERENCES entity_shared_accounts(id),
  shared_ledger_id TEXT REFERENCES entity_shared_account_ledger(id),
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
  CHECK (kind <> 'LAINNYA' OR expense_id IS NOT NULL),
  CHECK (kind <> 'HUTANG' OR hutang_account <> '')
);

CREATE INDEX IF NOT EXISTS idx_admin_payments_store_date ON admin_payments(store_id, business_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_payments_counterparty ON admin_payments(store_id, counterparty_type, counterparty_id);

-- Rekening Bersama dipilih sebagai cara bayar = gerai itu wajib satu entity
-- dengan Rekening Bersama-nya (isolasi CLAUDE.md #5, sama dengan
-- trg_payment_method_shared_account_scope_insert di migration 0111).
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

-- Fakta inti pembayaran tidak boleh diedit -- koreksi lewat Batalkan
-- (voided_at), bukan ubah nominal/pihak/cara bayar.
CREATE TRIGGER IF NOT EXISTS trg_admin_payments_core_immutable
BEFORE UPDATE OF store_id, entity_id, kind, hutang_account, counterparty_type, counterparty_id, counterparty_name,
  amount, payment_method, shared_account_id, shared_ledger_id, expense_id, business_date, created_at
ON admin_payments
BEGIN
  SELECT RAISE(ABORT, 'ADMIN_PAYMENT_CORE_FIELDS_IMMUTABLE');
END;

-- 4. Alokasi pelunasan Hutang non-gaji ke baris hutangnya.
ALTER TABLE operational_receivable_payable_payments ADD COLUMN admin_payment_id TEXT REFERENCES admin_payments(id);

-- 5. Bea Operasional: dibuat sebagai Hutang (tombol Bea Operasional) atau
--    dibayar langsung (tombol Pembayaran Lainnya), plus pihak & cara bayar
--    untuk Laporan Beban. Baris lama = LANGSUNG (dulu Bea memang dicatat
--    sebagai sudah dibayar).
ALTER TABLE admin_operational_expenses ADD COLUMN settlement TEXT NOT NULL DEFAULT 'LANGSUNG' CHECK (settlement IN ('LANGSUNG', 'HUTANG'));
ALTER TABLE admin_operational_expenses ADD COLUMN counterparty_name TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_operational_expenses ADD COLUMN payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE admin_operational_expenses ADD COLUMN shared_account_id TEXT REFERENCES entity_shared_accounts(id);
UPDATE admin_operational_expenses SET settlement = 'HUTANG' WHERE category = 'BEA_GAJI';
UPDATE admin_operational_expenses SET settlement = 'HUTANG'
WHERE id IN (SELECT source_id FROM operational_receivables_payables WHERE source_type IN ('BEA_LAPAK', 'BEA_LAINNYA'));
