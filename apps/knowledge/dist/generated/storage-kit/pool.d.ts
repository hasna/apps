import type { Pool } from "pg";
import { type TlsResolveOptions } from "./tls.js";
import { type PoolQueryClient } from "./query.js";
export interface CreatePgPoolOptions extends TlsResolveOptions {
    connectionString: string;
    /** Max clients in the pool. Defaults to pg's default (10). */
    max?: number;
    /** Idle client timeout (ms). */
    idleTimeoutMillis?: number;
    /** Connection acquisition timeout (ms). */
    connectionTimeoutMillis?: number;
    /** Application name reported to Postgres (shows in pg_stat_activity). */
    applicationName?: string;
}
/** Build a `pg.Pool` with fleet-standard TLS handling. */
export declare function createPgPool(options: CreatePgPoolOptions): Pool;
export interface CreateCloudPoolFromEnvOptions extends TlsResolveOptions {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    applicationName?: string;
}
export interface CloudPoolFromEnv {
    client: PoolQueryClient;
    connectionSource: string;
}
/**
 * Resolve mode + database URL from the environment and build a cloud pool.
 *
 * Throws when the resolved mode is not `cloud` (PURE REMOTE has no Postgres in
 * `local` mode) or when the database URL is missing. Never logs the URL.
 */
export declare function createCloudPoolFromEnv(appName: string, options?: CreateCloudPoolFromEnvOptions): CloudPoolFromEnv;
