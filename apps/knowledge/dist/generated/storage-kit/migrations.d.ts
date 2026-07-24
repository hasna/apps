import type { TypedQueryClient } from './query.js';
export declare const DEFAULT_MIGRATION_LEDGER_TABLE = "schema_migrations";
export interface Migration {
    readonly id: string;
    readonly sql: string;
    readonly checksum: string;
}
export type MigrationState = 'already_applied' | 'pending';
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
export declare function checksumSql(sql: string): string;
export declare function defineMigration(id: string, sql: string): Migration;
export interface MigrationRunnerOptions {
    ledgerTable?: string;
}
export declare class MigrationLedger {
    private readonly client;
    private readonly migrations;
    private readonly ledgerTable;
    constructor(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions);
    ensureLedger(): Promise<void>;
    listApplied(): Promise<AppliedMigration[]>;
    private readApplied;
    private buildPlan;
    migrate(opts?: {
        dryRun?: boolean;
    }): Promise<MigrationResult>;
    private applyPendingMigration;
}
export declare function createMigrationLedger(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions): MigrationLedger;
