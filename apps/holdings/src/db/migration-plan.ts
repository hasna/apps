// Ordered, forward-only migration plan (§4.3). Migration 1 is the initial schema
// (applied via SCHEMA at open time). Additional shape-changing migrations append
// here with a new id; each is applied at most once and triggers a pre-migration
// backup (§4.4). Never rewrite an applied migration.

export interface MigrationStep {
  id: number;
  description: string;
  /** Extra SQL to run for this step (beyond the idempotent base SCHEMA). Empty for the initial create. */
  sql: string;
  /** Whether this step changes shape and therefore requires a pre-migration backup. */
  shapeChanging: boolean;
}

export const MIGRATION_PLAN: MigrationStep[] = [
  {
    id: 1,
    description: "Initial IP portfolio schema (entities, assets, registrations, renewals, classes, documents, audit).",
    sql: "",
    shapeChanging: false,
  },
];

export function latestMigrationId(): number {
  return MIGRATION_PLAN.reduce((max, step) => Math.max(max, step.id), 0);
}
