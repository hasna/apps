/**
 * Keep artifact object storage additive for PostgreSQL databases that already
 * recorded the immutable `0001_logs_pg_schema` checksum.
 */
export const LOG_ARTIFACT_OBJECT_KEY_SQL =
  "ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS object_key TEXT";
