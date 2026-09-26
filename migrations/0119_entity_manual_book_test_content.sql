PRAGMA foreign_keys = ON;

-- Bos Cyo, 2026-09-26: test write ke Entity Manual Book.
-- Konten entity tampil pada Manual Book Portal Staf seluruh gerai
-- yang berada dalam entity yang sama.
INSERT INTO entity_manual_book (entity_id, content, updated_by, updated_at)
VALUES (
  'ENT-KPM',
  'karen tes tulis dulu ya',
  'karen',
  CURRENT_TIMESTAMP
)
ON CONFLICT(entity_id) DO UPDATE SET
  content = excluded.content,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;
