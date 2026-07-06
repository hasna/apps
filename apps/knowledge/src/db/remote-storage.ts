import type { Pool, QueryResultRow } from 'pg';
import {
  createCloudPoolFromEnv,
  createPgPool,
  createQueryClient,
  type PoolQueryClient,
} from '../generated/storage-kit/index.js';

/** App name used for the canonical HASNA_KNOWLEDGE_* env contract. */
export const KNOWLEDGE_APP_NAME = 'knowledge';

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => (value === undefined ? null : value));
}

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
export class PgAdapterAsync {
  private readonly client: PoolQueryClient;

  constructor(connectionString: string) {
    const pool = createPgPool({
      connectionString,
      applicationName: '@hasna/knowledge',
    });
    this.client = createQueryClient(pool);
  }

  /** Underlying pg pool (fleet-standard TLS applied). */
  get pool(): Pool {
    return this.client.pool;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.client.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  /** First row or `null`. Restored via the storage kit's typed `get()`. */
  async get<T extends QueryResultRow = QueryResultRow>(sql: string, ...params: unknown[]): Promise<T | null> {
    return this.client.get<T>(translatePlaceholders(sql), normalizeParams(params));
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Build a PURE REMOTE cloud query client from the environment.
 *
 * Requires `HASNA_KNOWLEDGE_STORAGE_MODE=cloud` and
 * `HASNA_KNOWLEDGE_DATABASE_URL`. Throws (without logging the URL) when the
 * mode is not `cloud` or the URL is missing. Returns the kit's typed client so
 * callers get `query/many/get/one/execute/transaction` uniformly.
 */
export function createKnowledgeCloudClient(): PoolQueryClient {
  return createCloudPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: '@hasna/knowledge' }).client;
}
