-- Align the hosted (cloud) embeddings table with the /v1 code path.
--
-- 0007 declared the intended cloud schema (`embedding FLOAT8[] NOT NULL`,
-- `synced_to_s3 INTEGER`, the two search indexes) but ran as a no-op on
-- every database where 0001 had already created `embeddings` (CREATE TABLE
-- IF NOT EXISTS against an existing table). The shipped schema therefore
-- never matched the code:
--
--   * `embedding BYTEA` — the cloud store writes and reads JavaScript
--     `number[]` vectors, which node-postgres serializes as Postgres array
--     literals; a BYTEA column fails the insert and misreads the select.
--   * `synced_to_s3 BOOLEAN` — the same insert passes integer 0, which
--     Postgres rejects for a boolean column.
--
-- This migration performs the ALTERs that 0007 was unable to, and adds the
-- two indexes 0007 also no-oped on. Cast strategy: there is no bytea ->
-- float8[] cast, so the USING clause routes around it — NULL stays NULL,
-- any non-NULL legacy BYTEA value becomes an empty array, and boolean
-- 0/1 maps to integer 0/1. The hosted embeddings feature ships for the
-- first time in this release, so no released database can hold real BYTEA
-- rows; a row that somehow carried one is dev residue, and converting it
-- to an empty array is a lossless-in-practice outcome.

ALTER TABLE embeddings
  ALTER COLUMN embedding TYPE FLOAT8[]
    USING (CASE WHEN embedding IS NULL THEN NULL ELSE '{}'::FLOAT8[] END),
  ALTER COLUMN synced_to_s3 DROP DEFAULT;

ALTER TABLE embeddings
  ALTER COLUMN synced_to_s3 TYPE INTEGER
    USING (CASE WHEN synced_to_s3 THEN 1 ELSE 0 END);

ALTER TABLE embeddings ALTER COLUMN synced_to_s3 SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_embeddings_session_id
  ON embeddings(session_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_message_id
  ON embeddings(message_id);
