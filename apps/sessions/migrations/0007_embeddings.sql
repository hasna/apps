-- Embeddings for hosted (cloud) semantic search, hybrid search, and recall.
--
-- Mirrors the local SQLite `embeddings` table so the /v1 surface serves the
-- same capability on the shared Postgres. Embeddings are stored as FLOAT8[]
-- (no pgvector dependency): the local path ranks with brute-force cosine in
-- JS, and the cloud path does the same, so parity is exact and the ranking
-- code stays shared.

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT,
  embedding FLOAT8[] NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_to_s3 INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_embeddings_session_id
  ON embeddings(session_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_message_id
  ON embeddings(message_id);
