-- Additive artifact metadata only. No business facts, jobs, or Accounting changes.
CREATE TABLE IF NOT EXISTS una_surfaces (
 id TEXT PRIMARY KEY, principal_key TEXT NOT NULL,
 entity_id TEXT NOT NULL REFERENCES entities(id), store_id TEXT REFERENCES stores(id),
 scope_kind TEXT NOT NULL CHECK(scope_kind IN('entity','gerai')),
 kind TEXT NOT NULL CHECK(kind IN('page','canvas')), title TEXT NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0), format_version INTEGER NOT NULL DEFAULT 1 CHECK(format_version=1),
 content_json TEXT NOT NULL, page_key TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK((scope_kind='entity' AND store_id IS NULL) OR (scope_kind='gerai' AND store_id IS NOT NULL)),
 CHECK((kind='page' AND page_key IS NOT NULL) OR (kind='canvas' AND page_key IS NULL)),
 UNIQUE(principal_key,entity_id,store_id,page_key)
);
-- SQLite UNIQUE treats NULL stores as distinct: protect entity page identity too.
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_surfaces_entity_page ON una_surfaces(principal_key,entity_id,page_key) WHERE store_id IS NULL AND kind='page';
CREATE INDEX IF NOT EXISTS idx_una_surfaces_scope ON una_surfaces(principal_key,entity_id,store_id,updated_at DESC);
