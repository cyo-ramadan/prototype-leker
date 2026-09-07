-- A short-lived intent row makes the OPEN/unclaimed check part of the same D1
-- transaction as the task/path replacement. It avoids changing the existing
-- protocol rule that permits a narrowly-scoped path INSERT on one's own claim.
CREATE TABLE IF NOT EXISTS board_write_intents (
  operation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER IF NOT EXISTS trg_board_write_intent_open_unclaimed
BEFORE INSERT ON board_write_intents
WHEN NOT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.task_id = NEW.task_id AND t.status = 'OPEN'
  )
  OR EXISTS (
    SELECT 1 FROM task_claims c
    WHERE c.task_id = NEW.task_id AND c.released_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'OPEN_UNCLAIMED_TASK_REQUIRED');
END;
