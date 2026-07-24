import type { TypedQueryClient } from './query.js';
import type { Migration, MigrationRunnerOptions } from './migrations.js';
export interface HealthResult {
    ok: boolean;
    latencyMs: number;
    error?: string;
}
export interface ReadyResult extends HealthResult {
    pendingMigrations: string[];
}
export declare function checkHealth(client: TypedQueryClient): Promise<HealthResult>;
export declare function checkReady(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions): Promise<ReadyResult>;
