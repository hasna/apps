import type { TypedQueryClient } from "./query.js";
/** Default ledger table name. Override per app if a legacy name exists. */
export declare const DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";
export interface Migration {
    readonly id: string;
    readonly sql: string;
    readonly checksum: string;
}
export type MigrationState = "already_applied" | "pending";
export interface MigrationPlanItem {
    readonly migration: Migration;
    readonly state: MigrationState;
}
export interface AppliedMigration {
    readonly id: string;
    readonly checksum: string;
    readonly appliedAt: string;
}
export interface MigrationResult {
    readonly dryRun: boolean;
    readonly applied: AppliedMigration[];
    readonly plan: MigrationPlanItem[];
}
/** Stable sha256 checksum for a migration's SQL text. */
export declare function checksumSql(sql: string): string;
/** Freeze a migration definition, computing its checksum from the SQL. */
export declare function defineMigration(id: string, sql: string): Migration;
export interface MigrationRunnerOptions {
    ledgerTable?: string;
    /**
     * Applied-ledger rows whose ids the build ACKNOWLEDGES as non-reproducible
     * history: a migration that was applied to the ledger by an out-of-band
     * operation or by a build whose id scheme no longer exists, so no current
     * source can reproduce its id or its SQL.
     *
     * An acknowledged id:
     *   - passes the downgrade guard (it IS recognized — as history),
     *   - is never checksum-compared (its SQL is gone, so no checksum can be
     *     computed for it; storing an arbitrary placeholder in `checksum` is
     *     what the prod ledger already holds for such rows),
     *   - is never re-applied and never re-inserted (it is already in the
     *     ledger; the plan covers declared migrations only).
     *
     * The list is EXPLICIT and OPT-IN: an acknowledged id may not also be a
     * declared migration (enforced at construction), and any OTHER applied row
     * unknown to the build still fails the downgrade guard. Every declared
     * migration keeps its checksum bind unchanged.
     */
    acknowledgedLegacyIds?: readonly string[];
}
export declare class MigrationLedger {
    private readonly client;
    private readonly migrations;
    private readonly ledgerTable;
    private readonly acknowledgedLegacyIds;
    constructor(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions);
    ensureLedger(): Promise<void>;
    listApplied(): Promise<AppliedMigration[]>;
    private readApplied;
    /** Compute the migration plan and guard against drift/downgrade. */
    private buildPlan;
    /** Apply all pending migrations. With `dryRun`, report the plan only. */
    migrate(opts?: {
        dryRun?: boolean;
    }): Promise<MigrationResult>;
}
/** Convenience: build a ledger and run all pending migrations. */
export declare function createMigrationLedger(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions): MigrationLedger;
