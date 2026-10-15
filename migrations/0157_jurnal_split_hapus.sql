-- Bos Cyo, 2026-10-14: "split ini apa bisa ditandai satu model ... semisal aku salah masukin split,
-- hapusnya ... bisa langsung dari request split ku tadi ... split yang uda dibikin sebelumnya tetep bisa
-- di delete." Satu Jurnal Split (accounting_journal_schedules kind SPLIT, termasuk yang dibuat sebelum
-- fitur ini) dihapus sekaligus: hari yang belum diposting dilewati (SKIPPED), hari yang sudah diposting
-- dibalik dengan jurnal pembalik bertanggal sama (jurnal POSTED tidak pernah diedit/dihapus, invariant #2).
-- Kolom di bawah mencatat kapan, oleh siapa, dan alasannya. NULL = split masih berlaku.
ALTER TABLE accounting_journal_schedules ADD COLUMN cancelled_at TEXT;
ALTER TABLE accounting_journal_schedules ADD COLUMN cancelled_by_role TEXT NOT NULL DEFAULT '';
ALTER TABLE accounting_journal_schedules ADD COLUMN cancelled_by_id TEXT NOT NULL DEFAULT '';
ALTER TABLE accounting_journal_schedules ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';
-- Pencarian "jurnal harian ini sudah dibalik?" (daftar split + hapus split) tanpa memindai semua jurnal.
CREATE INDEX IF NOT EXISTS idx_accounting_journal_headers_reversal_of
  ON accounting_journal_headers(store_id, reversal_of_journal_id) WHERE reversal_of_journal_id IS NOT NULL;
