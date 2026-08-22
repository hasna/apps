import type { TypedQueryClient } from "./query.js";
import { type Migration, type MigrationRunnerOptions } from "./migrations.js";
export interface HealthResult {
    ok: boolean;
    /** Round-trip latency of the probe query, in milliseconds. */
    latencyMs: number;
    error?: string;
}
/** Cheap reachability probe: `SELECT 1`. Never throws — reports `ok: false`. */
export declare function checkHealth(client: TypedQueryClient): Promise<HealthResult>;
export interface ReadyResult extends HealthResult {
    /** Migration ids that are defined but not yet applied. */
    pendingMigrations: string[];
}
/**
 * Readiness probe: reachable AND fully migrated. Reports `ok: false` with the
 * list of pending migration ids when the schema is behind.
 */
export declare function checkReady(client: TypedQueryClient, migrations: readonly Migration[], options?: MigrationRunnerOptions): Promise<ReadyResult>;
