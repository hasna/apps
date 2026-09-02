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
export interface CreateServerPoolFromEnvOptions extends TlsResolveOptions {
    max?: number;
    idleTimeoutMillis?: number;
    connectionTimeoutMillis?: number;
    applicationName?: string;
}
export interface ServerPoolFromEnv {
    client: PoolQueryClient;
    connectionSource: string;
}
/**
 * Resolve the required database URL and build the server's PostgreSQL pool.
 * Missing or invalid configuration throws without logging the URL.
 */
export declare function createServerPoolFromEnv(appName: string, options?: CreateServerPoolFromEnvOptions): ServerPoolFromEnv;
