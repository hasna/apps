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
    description: "initial access schema (identities, credentials, scopes, elevations, reviews, revocations, tokens, audit)",
    shapeChanging: false,
    statements: SCHEMA_STATEMENTS,
  },
];

export function appliedMigrationIds(db: Database): number[] {
  const rows = db.query("SELECT id FROM schema_migrations ORDER BY id").all() as { id: number }[];
  return rows.map((r) => r.id);
}

export function pendingMigrations(db: Database): MigrationStep[] {
  const applied = new Set(appliedMigrationIds(db));
  return MIGRATION_PLAN.filter((step) => !applied.has(step.id));
}
