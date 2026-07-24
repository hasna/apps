-- 0006: Postgres full-text + fuzzy search parity for cloud/self-hosted.
--
-- ROOT CAUSE this fixes: `searchTasks` (src/lib/search.ts) queries the local
-- bun:sqlite FTS5 index unconditionally. On a Postgres self-hosted/cloud
-- deployment the shared task rows live in `todos_sync_records`, not in the local
-- SQLite file, so search returned EMPTY. Cloud search must run against Postgres.
--
-- This migration gives `todos_sync_records` a weighted tsvector for ranked
-- full-text search plus a pg_trgm trigram index for typo/fuzzy matching, both
-- diacritics-insensitive via unaccent. The Postgres adapter's buildTaskFilterSql
-- emits a `task_search_tsv @@ websearch_to_tsquery(...)` predicate (with a
-- trigram-similarity fallback) and ranks with ts_rank_cd, mirroring the SQLite
-- bm25() weighting so both backends return equivalent ranked results.
--
-- Idempotent: extensions/function/column/indexes all use IF NOT EXISTS /
-- OR REPLACE. The STORED generated column backfills every existing row on ADD.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Postgres marks the stock unaccent(text) as STABLE, which bars it from a
-- generated column or an expression index. The two-argument form pins an
-- explicit dictionary, so wrapping it in an IMMUTABLE SQL function is safe and
-- is the standard pattern for diacritics-insensitive FTS/trigram indexes.
CREATE OR REPLACE FUNCTION todos_immutable_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT unaccent('unaccent', $1) $$;

-- Weighted document: title(A) > description(B) > tags(C). Tags are stored as a
-- jsonb array in the payload; translate() strips the JSON punctuation to a
-- space-separated token list without a non-immutable subquery. 'simple' keeps
-- the config language-neutral; unaccent folds diacritics.
ALTER TABLE todos_sync_records
  ADD COLUMN IF NOT EXISTS task_search_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', todos_immutable_unaccent(COALESCE(payload->>'title', ''))), 'A')
    || setweight(to_tsvector('simple', todos_immutable_unaccent(COALESCE(payload->>'description', ''))), 'B')
    || setweight(to_tsvector('simple', todos_immutable_unaccent(translate(COALESCE(payload->>'tags', '[]'), '[]",', '    '))), 'C')
  ) STORED;

-- Ranked full-text lookups (websearch_to_tsquery @@ task_search_tsv).
CREATE INDEX IF NOT EXISTS todos_sync_records_task_search_tsv_idx
  ON todos_sync_records USING gin (task_search_tsv)
  WHERE object_type = 'tasks' AND deleted_at IS NULL;

-- Typo/fuzzy fallback: trigram similarity over the unaccented title+description.
CREATE INDEX IF NOT EXISTS todos_sync_records_task_search_trgm_idx
  ON todos_sync_records USING gin (
    todos_immutable_unaccent(COALESCE(payload->>'title', '') || ' ' || COALESCE(payload->>'description', '')) gin_trgm_ops
  )
  WHERE object_type = 'tasks' AND deleted_at IS NULL;
