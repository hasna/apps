import { SCHEMA_SQL } from "./schema.js";

// Ordered, forward-only migration steps. The initial migration (id 1) creates
// the whole schema idempotently. New shape changes append a new step with a
// higher id and are applied at most once — never rewrite an applied migration.
//
// In cloud mode these same logical steps are applied through the vendored
// storage-kit migration ledger (Postgres); in local mode SCHEMA_SQL is applied
// idempotently and the ledger row is recorded.

export interface MigrationStep {
  id: number;
  name: string;
  /** SQLite DDL (idempotent). */
  sqlite: string;
  /** True for shape-changing steps that require a pre-migration backup. */
  shapeChanging: boolean;
}

export const MIGRATION_PLAN: MigrationStep[] = [
  {
    id: 1,
    name: "initial-workforce-schema",
    sqlite: SCHEMA_SQL,
    shapeChanging: false,
  },
];

export function getCurrentMigrationPlan(): MigrationStep[] {
  return MIGRATION_PLAN;
}

export function latestMigrationId(): number {
  return MIGRATION_PLAN.reduce((max, step) => Math.max(max, step.id), 0);
}
