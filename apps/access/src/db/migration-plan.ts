import type { Database } from "bun:sqlite";
import { SCHEMA_STATEMENTS } from "./schema.js";

/**
 * Ordered, forward-only migration steps. The initial migration (id=1) creates
 * the full schema. New schema changes append a new step with a higher id and a
 * shape-changing flag that triggers backup-on-migration (§4.4). Never rewrite an
 * applied migration — add a new one.
 */
export interface MigrationStep {
  id: number;
  description: string;
  /** true when the step alters existing table shape (needs a pre-backup). */
  shapeChanging: boolean;
  statements: string[];
}

export const MIGRATION_PLAN: MigrationStep[] = [
  {
    id: 1,
    description: "initial access schema (identities, credentials, scopes, elevations, requests, reviews, revocations, tokens, audit)",
    shapeChanging: false,
    statements: SCHEMA_STATEMENTS,
  },
  {
    id: 2,
    description: "access requests table and pending elevation approval semantics",
    shapeChanging: true,
    statements: [
      `DROP TABLE IF EXISTS elevations_migration_v2`,
      `CREATE TABLE elevations_migration_v2 (
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
      `INSERT INTO elevations_migration_v2 (
        id, identity_id, entity_id, scope, reason, approver, requested_by, expires_at,
        status, created_at, updated_at, version
      )
      SELECT
        id, identity_id, entity_id, scope, reason, approver, requested_by, expires_at,
        CASE WHEN status = 'active' AND approver IS NULL THEN 'pending' ELSE status END,
        created_at, updated_at, version
      FROM elevations`,
      `DROP TABLE elevations`,
      `ALTER TABLE elevations_migration_v2 RENAME TO elevations`,
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
    ],
  },
];

export function appliedMigrationIds(db: Database): number[] {
  try {
    const rows = db.query("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[];
    return rows.map((r) => r.id);
  } catch {
    return [];
  }
}

export function pendingMigrations(db: Database): MigrationStep[] {
  const applied = new Set(appliedMigrationIds(db));
  return MIGRATION_PLAN.filter((step) => !applied.has(step.id));
}

export function applyPendingMigrations(db: Database): void {
  for (const step of pendingMigrations(db)) {
    db.run("BEGIN IMMEDIATE");
    try {
      for (const statement of step.statements) db.run(statement);
      db.query("INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)").run(step.id);
      db.run("COMMIT");
    } catch (error) {
      db.run("ROLLBACK");
      throw error;
    }
  }
}
