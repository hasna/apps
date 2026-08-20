import { type Migration } from "../generated/storage-kit/migrations.js";
/** Full ordered migration set for the machines database. */
export declare function allMigrations(): Migration[];
export interface RunMigrationsResult {
    applied: string[];
    pending: string[];
    alreadyApplied: string[];
}
/** Apply all pending migrations (or report the plan with `dryRun`). */
export declare function runMigrations(options?: {
    dryRun?: boolean;
    env?: NodeJS.ProcessEnv;
}): Promise<RunMigrationsResult>;
