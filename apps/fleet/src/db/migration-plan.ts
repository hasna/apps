export type SQLiteMigrationPlanStatus = "applied" | "planned";

export interface SQLiteMigrationStep {
  id: string;
  name: string;
  status: SQLiteMigrationPlanStatus;
  kind: "schema" | "data";
  description: string;
}

export interface SQLiteMigrationPlan {
  ledgerTable: string;
  steps: SQLiteMigrationStep[];
}

// Ordered, forward-only migration plan. The baseline is applied idempotently by
// db/schema.ts; later shape changes append new ordered steps (never rewrite an
// applied one). This plan is also the source for cloud migrations via the
// vendored storage-kit MigrationLedger.
const CURRENT_PLAN: SQLiteMigrationPlan = {
  ledgerTable: "schema_migrations",
  steps: [
    {
      id: "0000-baseline",
      name: "baseline fleet config + append-only audit",
      status: "applied",
      kind: "schema",
      description:
        "Create fleet's owned config tables (saved_views, slos, error_budget_policies, alert_thresholds, annotations), the entities cache, and the append-only hash-chained fleet_audit table with UPDATE/DELETE guard triggers.",
    },
    {
      id: "0001-view-tags",
      name: "add saved_view tags",
      status: "planned",
      kind: "schema",
      description: "Add an optional tags column to saved_views for dashboard organization. Forward-only; backup taken before apply.",
    },
  ],
};

export function getCurrentSQLiteMigrationPlan(): SQLiteMigrationPlan {
  return CURRENT_PLAN;
}
