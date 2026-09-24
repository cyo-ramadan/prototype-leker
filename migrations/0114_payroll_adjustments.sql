PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-24: "untuk detil gaji dikasi tombol dan kolom sendiri
-- saja. karna selain dari presensi, gaji nanti juga bisa dibuat oleh
-- akuntan sendiri, misal tanggal 26 akuntan entry tambahan 30rb karena
-- lembur. atau potongan 15rb karna ngilangin barang, atau tambahan 23rb
-- karna kesalahan perhitungan ... jadi di tanggal 26 nanti akan terlihat 2
-- kartu, 1 dari presensi normal, 2 tambah entryan akuntan."
--
-- Payroll dari presensi (src/staff-attendance.js buildPayroll) selalu
-- dihitung ULANG tiap request dari fakta presensi + tarif akun saat ini --
-- sengaja tidak pernah disimpan sebagai baris (lihat komentar di sana).
-- Entry manual di sini BEDA sifatnya: dia keputusan manusia yang tidak bisa
-- dihitung ulang dari mana pun ("kasih toleransi Rp23rb karena HP mati
-- kemarin"), jadi WAJIB punya baris sendiri yang permanen.
--
-- Append-only, mengikuti idiom ledger operasional lain di repo ini
-- (cash_ledger_entries, entity_shared_account_ledger, migration 0111) --
-- baris adalah source of truth dan immutable, koreksi lewat void + entry
-- baru, bukan UPDATE nominal yang sudah ada.
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id TEXT PRIMARY KEY,
  -- Sama seperti account_job_details/account_shift_schedule (migration
  -- 0104/0106): polymorphic lewat (account_type, account_id), sengaja tanpa
  -- FK langsung ke tabel akun karena account_type-nya bisa lebih dari satu
  -- tabel. Aplikasi baru mengaktifkan jalur CASHIER; STORE_ADMIN/ENTITY_ADMIN
  -- disiapkan di skema supaya konsisten kalau nanti dibutuhkan, sama seperti
  -- dua tabel job-detail itu.
  account_type TEXT NOT NULL DEFAULT 'CASHIER' CHECK (account_type IN ('CASHIER', 'STORE_ADMIN', 'ENTITY_ADMIN')),
  account_id TEXT NOT NULL,
  -- store_id dicatat eksplisit (bukan diturunkan dari akun) supaya baris ini
  -- tetap jelas gerainya kalau akun ini nanti pindah gerai (akun backup
  -- lintas gerai yang lagi dirancang terpisah) -- Admin GERAI yang membuat
  -- entry ini scoped ke gerainya sendiri, persis seperti /api/admin/cashiers.
  store_id TEXT NOT NULL REFERENCES stores(id),
  business_date TEXT NOT NULL,
  -- Rupiah utuh, BUKAN scaled -- konsisten dengan earningRupiah yang sudah
  -- ada di buildPayroll() (juga plain rupiah, bukan scaled), karena fitur
  -- payroll ini murni tampilan/rekap, tidak pernah memposting jurnal
  -- Akuntansi. Boleh negatif (potongan).
  amount_rupiah INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_by_role TEXT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by_role TEXT,
  voided_by_id TEXT,
  void_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_payroll_adjustments_account
  ON payroll_adjustments(account_type, account_id, business_date);
