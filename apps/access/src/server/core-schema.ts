import type { CorePool } from "./core-store.js";

export const CORE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (\n    id INTEGER PRIMARY KEY,\n    applied_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))\n  )",
  "CREATE TABLE IF NOT EXISTS identities (\n    id TEXT PRIMARY KEY,\n    entity_id TEXT NOT NULL,\n    entity_slug TEXT,\n    kind TEXT NOT NULL CHECK (kind IN ('agent','service','human')),\n    name TEXT NOT NULL,\n    owner_ref TEXT,\n    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),\n    metadata TEXT,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_identities_entity ON identities(entity_id)",
  "CREATE TABLE IF NOT EXISTS credentials (\n    id TEXT PRIMARY KEY,\n    identity_id TEXT NOT NULL REFERENCES identities(id),\n    entity_id TEXT NOT NULL,\n    name TEXT NOT NULL,\n    kind TEXT NOT NULL CHECK (kind IN ('api_key','oauth','mcp_token','ssh_key','webhook_secret')),\n    secret_ref TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_credentials_identity ON credentials(identity_id)",
  "CREATE TABLE IF NOT EXISTS scopes (\n    id TEXT PRIMARY KEY,\n    identity_id TEXT NOT NULL REFERENCES identities(id),\n    entity_id TEXT NOT NULL,\n    scope TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),\n    granted_by TEXT,\n    granted_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    revoked_at TEXT,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_scopes_identity ON scopes(identity_id)",
  "CREATE TABLE IF NOT EXISTS elevations (\n    id TEXT PRIMARY KEY,\n    identity_id TEXT NOT NULL REFERENCES identities(id),\n    entity_id TEXT NOT NULL,\n    scope TEXT NOT NULL,\n    reason TEXT NOT NULL,\n    approver TEXT,\n    requested_by TEXT,\n    expires_at TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','revoked')),\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_elevations_identity ON elevations(identity_id)",
  "CREATE TABLE IF NOT EXISTS access_requests (\n    id TEXT PRIMARY KEY,\n    entity_id TEXT NOT NULL,\n    requested_by_identity_id TEXT NOT NULL REFERENCES identities(id),\n    provider TEXT NOT NULL,\n    resource_kind TEXT NOT NULL,\n    resource_ref TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','provisioned','failed','cancelled')),\n    policy_mode TEXT NOT NULL DEFAULT 'permissive_default',\n    policy_decision TEXT NOT NULL DEFAULT 'allow' CHECK (policy_decision IN ('allow','deny','manual_review')),\n    policy_reason TEXT,\n    decision_metadata TEXT NOT NULL,\n    approved_by TEXT,\n    approved_at TEXT,\n    secret_ref TEXT NOT NULL,\n    command_preview TEXT NOT NULL,\n    provision_metadata TEXT,\n    provisioned_at TEXT,\n    provisioned_by TEXT,\n    failure_reason TEXT,\n    failed_at TEXT,\n    failed_by TEXT,\n    cancelled_at TEXT,\n    cancelled_by TEXT,\n    cancel_reason TEXT,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_access_requests_entity ON access_requests(entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requested_by_identity_id)",
  "CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)",
  "CREATE INDEX IF NOT EXISTS idx_access_requests_provider_resource ON access_requests(provider, resource_kind, resource_ref)",
  "CREATE TABLE IF NOT EXISTS access_reviews (\n    id TEXT PRIMARY KEY,\n    entity_id TEXT NOT NULL,\n    name TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),\n    scheduled_at TEXT NOT NULL,\n    due_at TEXT,\n    scope_filter TEXT,\n    completed_at TEXT,\n    completed_by TEXT,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    updated_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    version INTEGER NOT NULL DEFAULT 1\n  )",
  "CREATE INDEX IF NOT EXISTS idx_reviews_entity ON access_reviews(entity_id)",
  "CREATE TABLE IF NOT EXISTS revocations (\n    id TEXT PRIMARY KEY,\n    identity_id TEXT NOT NULL,\n    entity_id TEXT NOT NULL,\n    target_type TEXT NOT NULL CHECK (target_type IN ('credential','scope','identity','elevation','token')),\n    target_id TEXT,\n    reason TEXT NOT NULL,\n    actor TEXT,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))\n  )",
  "CREATE INDEX IF NOT EXISTS idx_revocations_identity ON revocations(identity_id)",
  "CREATE TABLE IF NOT EXISTS issued_tokens (\n    id TEXT PRIMARY KEY,\n    jti TEXT NOT NULL UNIQUE,\n    identity_id TEXT NOT NULL REFERENCES identities(id),\n    entity_id TEXT NOT NULL,\n    credential_id TEXT,\n    scopes TEXT NOT NULL,\n    entity_ids TEXT NOT NULL,\n    token_hash TEXT NOT NULL,\n    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),\n    issued_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),\n    expires_at TEXT NOT NULL,\n    revoked_at TEXT\n  )",
  "CREATE INDEX IF NOT EXISTS idx_tokens_identity ON issued_tokens(identity_id)",
  "CREATE TABLE IF NOT EXISTS audit_log (\n    id SERIAL PRIMARY KEY,\n    entity_id TEXT,\n    event_type TEXT NOT NULL,\n    actor TEXT,\n    payload TEXT NOT NULL,\n    prev_hash TEXT NOT NULL,\n    row_hash TEXT NOT NULL,\n    created_at TEXT NOT NULL DEFAULT (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))\n  )"
];

/** Explicit schema administration only; never run by a client or normal startup. */
export async function migrateCoreSchema(pool: CorePool): Promise<void> {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    await connection.query("SELECT pg_advisory_xact_lock(1935762275)");
    for (const statement of CORE_SCHEMA) await connection.query(statement);
    await connection.query(`CREATE OR REPLACE FUNCTION access_reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_log is append-only'; END $$`);
    await connection.query("DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log");
    await connection.query("CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION access_reject_audit_mutation()");
    await connection.query("INSERT INTO schema_migrations (id) VALUES (1) ON CONFLICT DO NOTHING");
    await connection.query("COMMIT");
  } catch (error) {
    try { await connection.query("ROLLBACK"); } catch { /* retain original */ }
    throw error;
  } finally { connection.release(); }
}
