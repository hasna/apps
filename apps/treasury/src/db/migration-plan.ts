// Ordered, forward-only migration plan (descriptive). The baseline is applied
// idempotently by runSqliteMigrations / POSTGRES_MIGRATIONS; this plan powers
// `treasury doctor` / dry-run reporting. Never rewrite an applied migration —
// add a new one.

export interface MigrationPlanEntry {
  id: string;
  name: string;
  status: "applied" | "planned";
  description: string;
}

export interface MigrationPlan {
  version: string;
  current_schema_id: string;
  entries: MigrationPlanEntry[];
}

export const CURRENT_MIGRATION_PLAN: MigrationPlan = {
  version: "2026-07-06",
  current_schema_id: "0000-baseline",
  entries: [
    {
      id: "0000-baseline",
      name: "baseline treasury schema",
      status: "applied",
      description:
        "entities, balance_snapshots, fx_rates, cost_feeds, sweep_recommendations, and the append-only hash-chained audit_log with immutability triggers.",
    },
  ],
};

export function getCurrentMigrationPlan(): MigrationPlan {
  return CURRENT_MIGRATION_PLAN;
}
