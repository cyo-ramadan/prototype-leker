PRAGMA foreign_keys = ON;

ALTER TABLE cash_drawer_sessions ADD COLUMN closing_photo BLOB;
ALTER TABLE cash_drawer_sessions ADD COLUMN closing_photo_type TEXT;

CREATE TABLE IF NOT EXISTS staff_attendance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  attendance_type TEXT NOT NULL CHECK (attendance_type IN ('in', 'out')),
  photo_blob BLOB NOT NULL,
  photo_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES cashiers(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_attendance_user_created
  ON staff_attendance(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_store_created
  ON staff_attendance(store_id, created_at DESC);
