/**
 * Identity + linkage columns for the cloud `logs` table (hosted /v1 ingest).
 *
 * The local SQLite `logs` table carries identity in `event_records`, but the
 * cloud `logs` table is the per-line projection store for `logs run` output,
 * and the hosted POST /v1/logs handler feeds it only the narrow
 * level/message/… set. `ApiStore.ingestLog` (src/store/api.ts) deliberately
 * sends the complete LogEntry — deterministic `id`, `source_event_id`,
 * `machine_id`, `repo_id`, `app_id`, `process_id`, `run_id`, `span_id`,
 * `parent_span_id`, `release_id`, `environment`, `privacy`, `page_id` — with a
 * comment claiming the server accepts it. Until this migration, every one of
 * those fields was dropped: createLog minted a fresh UUID per call (so a
 * client retry with the same id inserted a duplicate row instead of deduping
 * like local ingest at src/lib/ingest.ts) and the run/process/privacy/page
 * linkage never reached Postgres.
 *
 * Wired into the cloud migration ledger as `0002_logs_identity_fields` (see
 * src/db/pg-migrate.ts). Additive and idempotent (`ADD COLUMN IF NOT EXISTS`),
 * so it applies to both fresh databases and existing deployed ones; the
 * `0001_logs_pg_schema` checksum is untouched.
 */
export const LOG_IDENTITY_FIELDS_SQL = `ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS source_event_id TEXT,
  ADD COLUMN IF NOT EXISTS machine_id TEXT,
  ADD COLUMN IF NOT EXISTS repo_id TEXT,
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS process_id TEXT,
  ADD COLUMN IF NOT EXISTS run_id TEXT,
  ADD COLUMN IF NOT EXISTS span_id TEXT,
  ADD COLUMN IF NOT EXISTS parent_span_id TEXT,
  ADD COLUMN IF NOT EXISTS release_id TEXT,
  ADD COLUMN IF NOT EXISTS environment TEXT,
  ADD COLUMN IF NOT EXISTS privacy TEXT;
CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id);
CREATE INDEX IF NOT EXISTS idx_logs_process ON logs(process_id);
CREATE INDEX IF NOT EXISTS idx_logs_source_event ON logs(source_event_id)`;
