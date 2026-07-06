import type { Pool, QueryResultRow } from 'pg';
import { type PoolQueryClient } from '../generated/storage-kit/index.js';
/** App name used for the canonical HASNA_KNOWLEDGE_* env contract. */
export declare const KNOWLEDGE_APP_NAME = "knowledge";
/**
 * Async Postgres adapter for knowledge cloud-mode access.
 *
 * All pg access — TLS handling, pooling, and the typed query surface — is
 * delegated to the vendored `@hasna/contracts` storage kit
 * (`src/generated/storage-kit`). This replaces the previous hand-rolled
 * `rejectUnauthorized: false` TLS shim and restores the single-row `get()`
 * helper that had been dropped from this adapter.
 *
 * PURE REMOTE (Amendment A1): cloud mode reads AND writes go directly to the
 * cloud Postgres. There is no cache, no local mirror, and no merge — every
 * call round-trips to the database.
 */
export declare class PgAdapterAsync {
    private readonly client;
    constructor(connectionString: string);
    /** Underlying pg pool (fleet-standard TLS applied). */
    get pool(): Pool;
    run(sql: string, ...params: unknown[]): Promise<{
        changes: number;
    }>;
    all(sql: string, ...params: unknown[]): Promise<unknown[]>;
    /** First row or `null`. Restored via the storage kit's typed `get()`. */
    get<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T | null>;
    close(): Promise<void>;
}
/**
 * Build a PURE REMOTE cloud query client from the environment.
 *
 * Requires `HASNA_KNOWLEDGE_STORAGE_MODE=cloud` and
 * `HASNA_KNOWLEDGE_DATABASE_URL`. Throws (without logging the URL) when the
 * mode is not `cloud` or the URL is missing. Returns the kit's typed client so
 * callers get `query/many/get/one/execute/transaction` uniformly.
 */
export declare function createKnowledgeCloudClient(): PoolQueryClient;
