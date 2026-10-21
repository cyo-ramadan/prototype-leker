-- Koreksi pembelian kasir (Bos Cyo, 2026-10-21, kasus Air Mineral Kaliurang):
--   correction_kind       VOID = hapus transaksi (seperti sebelumnya); AMOUNT = ganti nominal saja.
--   requested_lines_json  AMOUNT: [{productId, lineTotal}] nominal benar per baris yang diajukan CS.
--   replacement_subject_id AMOUNT: pembelian pengganti yang dibuat saat ACC.
--   hpp_replay_status     '' = tidak perlu; MENUNGGU = harga rata-rata bahan menunggu Putar Ulang HPP
--                         di jam sepi (src/hpp-putar-ulang.js); SELESAI; TERTAHAN = perlu dicek manual.
ALTER TABLE approval_permits ADD COLUMN correction_kind TEXT NOT NULL DEFAULT 'VOID' CHECK (correction_kind IN ('VOID', 'AMOUNT'));
ALTER TABLE approval_permits ADD COLUMN requested_lines_json TEXT NOT NULL DEFAULT '';
ALTER TABLE approval_permits ADD COLUMN replacement_subject_id TEXT;
ALTER TABLE approval_permits ADD COLUMN hpp_replay_status TEXT NOT NULL DEFAULT '' CHECK (hpp_replay_status IN ('', 'MENUNGGU', 'SELESAI', 'TERTAHAN'));
ALTER TABLE approval_permits ADD COLUMN hpp_replay_detail TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_approval_permits_hpp_replay ON approval_permits (hpp_replay_status, requested_at);
