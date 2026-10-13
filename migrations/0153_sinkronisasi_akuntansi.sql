-- Bos Cyo, 2026-10-13: "tombol sinkronisasi di panel entity admin. ketika tombol di klik yang berubah
-- hanya di portal staff di entity dsb. semuanya menambahkan 1 baris transaksi dengan nama sinkronisasi
-- akuntansi angkanya berbeda2 menyesuaikan penyamaan saldo di akuntansi. baris penyesuaian tadi tidak
-- masuk di akuntansi."
--
-- Satu baris = penyamaan riwayat Operasional (Portal Staf, panel Entity) dengan buku Akuntansi untuk
-- satu karyawan, satu gerai, satu jenis saldo. Buku Akuntansi adalah acuan (ADR-054) dan TIDAK
-- disentuh: tabel ini sengaja di luar semua jembatan Akuntansi (accounting-auto-sync, bridge setoran,
-- bridge admin) sehingga tidak pernah dijurnal. Tanda nilai mengikuti sisi normal akunnya:
--   SETORAN: + menambah piutang setoran yang dipegang karyawan (Piutang Karyawan 1202)
--   GAJI   : + menambah hutang gaji ke karyawan (Hutang Gaji 2102)
-- book_scaled / displayed_scaled = potret angka buku dan angka riwayat saat disinkronkan (jejak audit).
-- Dibatalkan lewat voided_at (append-only, tidak dihapus).
CREATE TABLE IF NOT EXISTS people_balance_syncs (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id),
  store_id TEXT NOT NULL REFERENCES stores(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  kind TEXT NOT NULL CHECK (kind IN ('SETORAN', 'GAJI')),
  amount_scaled INTEGER NOT NULL CHECK (amount_scaled <> 0),
  book_scaled INTEGER NOT NULL,
  displayed_scaled INTEGER NOT NULL,
  created_by_role TEXT NOT NULL,
  created_by_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  voided_by_role TEXT,
  voided_by_id TEXT,
  void_reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_people_balance_syncs_employee
  ON people_balance_syncs(employee_id, kind, store_id);
CREATE INDEX IF NOT EXISTS idx_people_balance_syncs_store
  ON people_balance_syncs(store_id, kind);
