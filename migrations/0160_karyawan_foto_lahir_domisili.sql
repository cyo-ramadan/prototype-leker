-- Bos Cyo, 2026-10-16: data diri karyawan ditambah foto, tahun kelahiran, dan alamat domisili
-- "saat itu" dengan keterangan waktu entry. Domisili bisa berpindah, jadi disimpan sebagai riwayat
-- (baris baru tiap kali berubah, tidak pernah ditimpa); yang tampil = baris terbaru.

ALTER TABLE employees ADD COLUMN birth_year INTEGER;
-- Foto disimpan sebagai data URL JPEG yang sudah dikecilkan di browser (pola sama dengan foto barang).
ALTER TABLE employees ADD COLUMN photo_data TEXT;
ALTER TABLE employees ADD COLUMN photo_updated_at TEXT;

CREATE TABLE IF NOT EXISTS employee_domicile_history (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  address TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  recorded_by_role TEXT NOT NULL DEFAULT '',
  recorded_by_id TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (employee_id) REFERENCES employees(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_domicile_history_employee
  ON employee_domicile_history(employee_id, recorded_at DESC);
