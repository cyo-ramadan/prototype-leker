PRAGMA foreign_keys = ON;

-- Bea Operasional yang dicatat dari panel Admin Gerai -- Bos Cyo, 2026-09-17:
-- "kasi tombol di admin bea operasional. isinya bea gaji, bea lapak, bea
-- lainnya".
--
-- KENAPA TABEL SENDIRI, bukan menumpang `expenses` (Pengeluaran Kasir):
-- `expenses` mewajibkan drawer_session_id DAN cashier_id (dua-duanya NOT NULL
-- dengan foreign key), karena tabel itu memang mencatat uang keluar dari LACI
-- kasir yang sedang dibuka. Bea Gaji/Lapak yang dibayar Admin tidak punya
-- keduanya. Memaksakannya lewat sesi laci buatan akan membuat laporan tutup
-- laci kasir kelihatan selisih -- kasirnya dituduh kurang setor padahal yang
-- keluar itu gaji yang dibayar Admin. Jadi ini fakta bisnis yang berbeda dan
-- pantas punya tabelnya sendiri.
--
-- business_date DIISI ADMIN, bukan diturunkan dari created_at: bayar gaji
-- tanggal 5 untuk periode bulan lalu itu wajar, dan Admin yang tahu tanggal
-- mana yang benar untuk dibebankan. Laporan Net Profit mengelompokkan bea ini
-- pakai business_date, bukan waktu pencatatannya.
--
-- amount: rupiah bulat biasa (sama seperti expenses.amount), BUKAN scaled
-- 1.000.000 -- skala scaled hanya untuk HPP/average cost/jurnal (invariant #1).
--
-- PENTING -- sudah didaftarkan ke Laporan Net Profit di
-- src/net-profit-report.js (BEBAN_SOURCES + computeFactsForDates). Tanpa
-- pendaftaran itu, bea di sini tercatat tapi tidak pernah mengurangi untung
-- di laporan, dan tidak ada error apa pun yang memberi tahu. Lihat
-- KNOWN_PITFALLS.md "Laporan Net Profit tidak otomatis ikut fitur Beban baru".
CREATE TABLE IF NOT EXISTS admin_operational_expenses (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('BEA_GAJI', 'BEA_LAPAK', 'BEA_LAINNYA')),
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  business_date TEXT NOT NULL CHECK (business_date GLOB '????-??-??'),
  note TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL DEFAULT '' CHECK (created_by_role IN ('', 'OWNER', 'ENTITY_ADMIN', 'ADMIN', 'LEGACY_PIN')),
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Koreksi lewat pembatalan, bukan hapus/edit -- pola yang sama dengan
  -- sales/purchases/expenses (migration 0027). Angka yang sudah pernah masuk
  -- laporan harus tetap punya jejak.
  voided_at TEXT,
  voided_by_role TEXT,
  voided_by_id TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_admin_operational_expenses_store_date
  ON admin_operational_expenses(store_id, business_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_operational_expenses_store_void
  ON admin_operational_expenses(store_id, voided_at, business_date);
