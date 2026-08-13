import type { Database } from "bun:sqlite";

/**
 * Idempotent SQLite DDL for iapp-access plus the schema_migrations ledger.
 * Every table anchors to entity_id (an unguessable UUIDv4 home-entity ref).
 * The audit_log table is append-only and hash-chained (§4.7); UPDATE/DELETE
 * are blocked by triggers that RAISE(ABORT).
 */

export const AUDIT_TABLE = "audit_log";

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS identities (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    entity_slug TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('agent','service','human')),
    name TEXT NOT NULL,
    owner_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','retired')),
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identities_entity ON identities(entity_id)`,
  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    identity_id TEXT NOT NULL REFERENCES identities(id),
    entity_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('api_key','oauth','mcp_token','ssh_key','webhook_secret')),
    secret_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_credentials_identity ON credentials(identity_id)`,
  `CREATE TABLE IF NOT EXISTS scopes (
    id TEXT PRIMARY KEY,
    identity_id TEXT NOT NULL REFERENCES identities(id),
    entity_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('granted','revoked')),
    granted_by TEXT,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scopes_identity ON scopes(identity_id)`,
  `CREATE TABLE IF NOT EXISTS elevations (
    id TEXT PRIMARY KEY,
    identity_id TEXT NOT NULL REFERENCES identities(id),
    entity_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    reason TEXT NOT NULL,
    approver TEXT,
    requested_by TEXT,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','expired','revoked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_elevations_identity ON elevations(identity_id)`,
  `CREATE TABLE IF NOT EXISTS access_requests (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    requested_by_identity_id TEXT NOT NULL REFERENCES identities(id),
    provider TEXT NOT NULL,
    resource_kind TEXT NOT NULL,
    resource_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','provisioned','failed','cancelled')),
    policy_mode TEXT NOT NULL DEFAULT 'permissive_default',
    policy_decision TEXT NOT NULL DEFAULT 'allow' CHECK (policy_decision IN ('allow','deny','manual_review')),
    policy_reason TEXT,
    decision_metadata TEXT NOT NULL,
    approved_by TEXT,
    approved_at TEXT,
    secret_ref TEXT NOT NULL,
    command_preview TEXT NOT NULL,
    provision_metadata TEXT,
    provisioned_at TEXT,
    provisioned_by TEXT,
    failure_reason TEXT,
    failed_at TEXT,
    failed_by TEXT,
    cancelled_at TEXT,
    cancelled_by TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_access_requests_entity ON access_requests(entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requested_by_identity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)`,
  `CREATE INDEX IF NOT EXISTS idx_access_requests_provider_resource ON access_requests(provider, resource_kind, resource_ref)`,
  `CREATE TABLE IF NOT EXISTS access_reviews (
    id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    scheduled_at TEXT NOT NULL,
    due_at TEXT,
    scope_filter TEXT,
    completed_at TEXT,
    completed_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    version INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_entity ON access_reviews(entity_id)`,
  `CREATE TABLE IF NOT EXISTS revocations (
    id TEXT PRIMARY KEY,
    identity_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('credential','scope','identity','elevation','token')),
    target_id TEXT,
    reason TEXT NOT NULL,
    actor TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_revocations_identity ON revocations(identity_id)`,
  `CREATE TABLE IF NOT EXISTS issued_tokens (
    id TEXT PRIMARY KEY,
    jti TEXT NOT NULL UNIQUE,
    identity_id TEXT NOT NULL REFERENCES identities(id),
    entity_id TEXT NOT NULL,
    credential_id TEXT,
    scopes TEXT NOT NULL,
    entity_ids TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
    issued_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_identity ON issued_tokens(identity_id)`,
  `CREATE TABLE IF NOT EXISTS ${AUDIT_TABLE} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT,
    event_type TEXT NOT NULL,
    actor TEXT,
    payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Append-only enforcement: audit rows can never be updated or deleted.
  `CREATE TRIGGER IF NOT EXISTS ${AUDIT_TABLE}_no_update
    BEFORE UPDATE ON ${AUDIT_TABLE}
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS ${AUDIT_TABLE}_no_delete
    BEFORE DELETE ON ${AUDIT_TABLE}
    BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END`,
];

/** Tables that participate in storage push/pull/sync (audit_log is EXCLUDED). */
export const SYNCABLE_TABLES = [
  "identities",
  "credentials",
  "scopes",
  "elevations",
  "access_requests",
  "access_reviews",
  "revocations",
  "issued_tokens",
] as const;

export function applySchema(db: Database): void {
  for (const statement of SCHEMA_STATEMENTS) db.run(statement);
  db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (1)");
}
