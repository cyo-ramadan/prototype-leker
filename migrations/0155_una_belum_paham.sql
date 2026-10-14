PRAGMA foreign_keys = ON;
-- Diagnostics only; no business facts, ledger writes or scheduled jobs.
CREATE TABLE IF NOT EXISTS una_belum_paham (
 id TEXT PRIMARY KEY,
 entity_tenancy_id TEXT NOT NULL REFERENCES entity_tenancy(id), entity_id TEXT NOT NULL REFERENCES entities(id), store_id TEXT REFERENCES stores(id),
 scope_kind TEXT NOT NULL CHECK(scope_kind IN ('entity','gerai')), principal_key TEXT NOT NULL,
 sender_role TEXT NOT NULL CHECK(sender_role IN ('OWNER','ENTITY_ADMIN')), conversation_key TEXT NOT NULL, reason TEXT NOT NULL,
 trigger_message TEXT NOT NULL, turns_json TEXT NOT NULL, tool_name TEXT, asset_version TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'baru' CHECK(status IN ('baru','dikerjakan','selesai','bukan_masalah')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 UNIQUE(conversation_key,reason)
);
CREATE INDEX IF NOT EXISTS idx_una_belum_paham_scope ON una_belum_paham(entity_tenancy_id,entity_id,store_id,status,created_at,id);
CREATE INDEX IF NOT EXISTS idx_una_belum_paham_expiry ON una_belum_paham(expires_at);
-- Hashes and counters only. Browser history never supplies a counter.
CREATE TABLE IF NOT EXISTS una_belum_paham_observations (
 conversation_key TEXT NOT NULL, question_key TEXT NOT NULL,
 incomplete_count INTEGER NOT NULL DEFAULT 1 CHECK(incomplete_count>0), expires_at TEXT NOT NULL,
 PRIMARY KEY(conversation_key,question_key)
);
CREATE INDEX IF NOT EXISTS idx_una_belum_paham_observations_expiry ON una_belum_paham_observations(expires_at);
-- Scoped masking must not scan stores across tenants as the service grows.
CREATE INDEX IF NOT EXISTS idx_stores_entity_id ON stores(entity_id,id);
