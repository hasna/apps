-- Durable outbound object-sync state for normalized session content.
-- Object bytes live in S3; this table records only retry and acknowledgement metadata.

CREATE TABLE IF NOT EXISTS session_objects (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  object_kind TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  source_digest TEXT NOT NULL,
  size BIGINT NOT NULL CHECK(size >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'uploaded', 'failed')),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT NOW()::text,
  updated_at TEXT NOT NULL DEFAULT NOW()::text,
  PRIMARY KEY (session_id, object_kind)
);

CREATE INDEX IF NOT EXISTS idx_session_objects_retry
  ON session_objects(status, updated_at);
