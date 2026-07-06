// Live Postgres executor for the loops storage backend.
//
// Adapts the vendored @hasna/contracts storage kit (`createQueryClient` over a
// `pg.Pool`) to the `PostgresQueryExecutor` contract consumed by
// `PostgresStorage`. PURE REMOTE (Amendment A1): a pool is only ever built when
// a cloud database URL is present; there is no local/hybrid Postgres path.

import type { PoolQueryClient } from "../../generated/storage-kit/query.js";
import { createPgPool } from "../../generated/storage-kit/pool.js";
import { createQueryClient } from "../../generated/storage-kit/query.js";
import type { PostgresQueryExecutor } from "./postgres.js";

export interface PgExecutorOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

/**
 * `PostgresQueryExecutor` backed by a live `pg.Pool` via the vendored kit.
 *
 * Transaction support is intentionally omitted: `PostgresStorage.migrate`
 * treats DDL as idempotent (`CREATE ... IF NOT EXISTS` + a checksum ledger), so
 * a pooled sequential apply is correct and avoids binding every inner
 * `execute` to a single dedicated client.
 */
export class PgPoolExecutor implements PostgresQueryExecutor {
  private readonly client: PoolQueryClient;

  constructor(client: PoolQueryClient) {
    this.client = client;
  }

  static fromConnectionString(options: PgExecutorOptions): PgPoolExecutor {
    const pool = createPgPool({
      connectionString: options.connectionString,
      ...(options.max !== undefined ? { max: options.max } : {}),
      ...(options.applicationName !== undefined ? { applicationName: options.applicationName } : {}),
      ...(options.connectionTimeoutMillis !== undefined
        ? { connectionTimeoutMillis: options.connectionTimeoutMillis }
        : {}),
      ...(options.idleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.idleTimeoutMillis } : {}),
    });
    return new PgPoolExecutor(createQueryClient(pool));
  }

  /** The underlying typed query client, for callers that need `get`/`one`/`transaction`. */
  get queryClient(): PoolQueryClient {
    return this.client;
  }

  async query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
    return this.client.many<T & Record<string, unknown>>(sql, params) as Promise<T[]>;
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    await this.client.execute(sql, params);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
