PRAGMA foreign_keys = ON;

-- Customer sessions intentionally remain multi-session. Staff sessions are single-session.
-- Reset legacy staff tokens once so duplicated/stale sessions from the old policy do not survive migration.
DELETE FROM owner_sessions;
DELETE FROM store_admin_sessions;
DELETE FROM cashier_sessions;

-- The trigger keeps the invariant true even for legacy/direct staff login endpoints.
CREATE TRIGGER IF NOT EXISTS trg_owner_single_session
BEFORE INSERT ON owner_sessions
BEGIN
  DELETE FROM owner_sessions WHERE owner_id = NEW.owner_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_store_admin_single_session
BEFORE INSERT ON store_admin_sessions
BEGIN
  DELETE FROM store_admin_sessions WHERE admin_id = NEW.admin_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_cashier_single_session
BEFORE INSERT ON cashier_sessions
BEGIN
  DELETE FROM cashier_sessions WHERE cashier_id = NEW.cashier_id;
END;
