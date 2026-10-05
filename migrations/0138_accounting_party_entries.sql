-- Sub-buku "atas nama siapa" untuk akun piutang & hutang (Bos Cyo, 2026-10-05).
--
-- Masalah yang ditutup: saldo setoran per karyawan hidup di modul Operasional
-- (operational_receivables_payables), sedangkan akuntan bisa memposting jurnal manual ke
-- Piutang Karyawan (1202) tanpa menyebut siapa orangnya. Hasilnya saldo akun di buku besar
-- dan jumlah saldo per karyawan tidak sinkron, dan tidak ada yang tahu selisihnya milik siapa.
-- Keputusan Bos Cyo: "piutang dan hutang wajib kasih nama".
--
-- Satu baris = satu baris jurnal (accounting_journal_lines) pada akun piutang/hutang yang
-- diberi nama pihaknya. Tabel ini milik Accounting (invariant #4): ia menunjuk ke jurnal,
-- bukan sebaliknya, dan referensi ke karyawan/pemasok sengaja tanpa foreign key supaya
-- modul Operasional tidak punya ketergantungan keras ke interpretasi Accounting.
--
-- Jurnal yang sudah posted tidak diubah (invariant #2) -- tabel ini hanya menambah label
-- nama. Uang = integer skala 1.000.000 (invariant #1). entity_id disimpan untuk arah SaaS
-- (ADR-030).
CREATE TABLE IF NOT EXISTS accounting_party_entries (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES stores(id),
  entity_id TEXT,
  journal_id TEXT NOT NULL REFERENCES accounting_journal_headers(id),
  journal_line_id TEXT NOT NULL UNIQUE REFERENCES accounting_journal_lines(id),
  account_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  account_code TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('EMPLOYEE', 'SUPPLIER', 'OTHER')),
  employee_id TEXT,
  supplier_id TEXT,
  party_name TEXT NOT NULL CHECK (length(trim(party_name)) >= 2),
  side TEXT NOT NULL CHECK (side IN ('DEBIT', 'CREDIT')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled > 0),
  business_date TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '',
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_accounting_party_entries_store_account
  ON accounting_party_entries(store_id, account_code, business_date);
CREATE INDEX IF NOT EXISTS idx_accounting_party_entries_employee
  ON accounting_party_entries(store_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounting_party_entries_journal
  ON accounting_party_entries(journal_id);
