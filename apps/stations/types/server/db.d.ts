import { type PoolQueryClient } from "../generated/storage-kit/index.js";
export declare const MACHINES_APP_NAME = "machines";
/** Env var carrying the OWNER-role DSN used only for DDL / migrations. */
export declare const OWNER_DATABASE_URL_ENV = "HASNA_MACHINES_DATABASE_URL_OWNER";
/**
 * Resolve the shared APP-role client the serve process uses for every request.
 * Requires the `postgresql` data backend (HASNA_MACHINES_DATABASE_URL set).
 * Throws a clear error otherwise — never a silent no-op — and any retired
 * storage-mode variable throws naming the variable.
 */
export declare function getServiceClient(): PoolQueryClient;
/**
 * Build a one-off OWNER-role client for migrations. Prefers the dedicated
 * owner DSN (`HASNA_MACHINES_DATABASE_URL_OWNER`); falls back to the app DSN
 * when no separate owner secret is wired. Caller must `close()` it.
 */
export declare function getOwnerClient(env?: NodeJS.ProcessEnv): PoolQueryClient;
/** Close the cached service client (used by tests / graceful shutdown). */
export declare function closeServiceClient(): Promise<void>;
