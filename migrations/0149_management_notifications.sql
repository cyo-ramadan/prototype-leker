PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS management_notifications (
 id TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, entity_id TEXT REFERENCES entities(id), store_id TEXT REFERENCES stores(id),
 dedup_key TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL,
 created_at TEXT NOT NULL, read_at TEXT, UNIQUE(recipient_key,dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_management_notifications_inbox ON management_notifications(recipient_key,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_management_notifications_unread ON management_notifications(recipient_key,read_at);
CREATE TABLE IF NOT EXISTS management_user_preferences (
 recipient_key TEXT PRIMARY KEY, sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK(sound_enabled IN(0,1)),
 push_enabled INTEGER NOT NULL DEFAULT 0 CHECK(push_enabled IN(0,1)), home_pins_json TEXT NOT NULL DEFAULT '[]',
 start_tab TEXT NOT NULL DEFAULT 'home', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS management_notification_rules (
 id TEXT PRIMARY KEY, entity_id TEXT NOT NULL REFERENCES entities(id), title TEXT NOT NULL,
 condition TEXT NOT NULL CHECK(condition IN('STORE_NOT_OPEN','DEPOSIT_PENDING','APPROVAL_PENDING','REMINDER')),
 store_ids_json TEXT NOT NULL DEFAULT '[]', recipients_json TEXT NOT NULL, time_of_day TEXT NOT NULL, days_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)), repeat_minutes INTEGER NOT NULL DEFAULT 0 CHECK(repeat_minutes IN(0,15,30,60)),
 message TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_management_notification_rules_entity ON management_notification_rules(entity_id,enabled);
CREATE INDEX IF NOT EXISTS idx_management_notification_rules_enabled ON management_notification_rules(enabled,time_of_day);
CREATE TABLE IF NOT EXISTS management_push_subscriptions (
 id TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, endpoint TEXT UNIQUE NOT NULL, subscription_json TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_management_push_recipient ON management_push_subscriptions(recipient_key);
CREATE TABLE IF NOT EXISTS management_notification_tickets (
 token_hash TEXT PRIMARY KEY, recipient_key TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_management_notification_tickets_expiry ON management_notification_tickets(expires_at);
-- Alarm rules are user configuration: deliberately no installed defaults.
CREATE INDEX IF NOT EXISTS idx_management_notifications_dedup ON management_notifications(dedup_key,recipient_key);
CREATE TABLE IF NOT EXISTS management_notification_push_outbox (
 id TEXT PRIMARY KEY, notification_id TEXT NOT NULL, recipient_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(notification_id,recipient_key)
);
CREATE INDEX IF NOT EXISTS idx_management_notification_push_outbox_due ON management_notification_push_outbox(next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_notification_deposit_pending ON operational_receivable_payable_payments(entity_id,approval_status,created_at DESC);
