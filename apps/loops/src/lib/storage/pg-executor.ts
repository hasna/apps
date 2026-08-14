// Live Postgres executor for the loops storage backend.
//
// Adapts the generated @hasna/contracts storage kit (`createQueryClient` over a
// `pg.Pool`) to the `PostgresQueryExecutor` contract consumed by
// `PostgresStorage`. A pool is only ever built when a self-hosted database URL
// is present; there is no local/hybrid Postgres path.

import type { PoolQueryClient, TypedQueryClient } from "../../generated/storage-kit/query.js";
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
 * `PostgresQueryExecutor` backed by a live `pg.Pool` via the generated kit.
 *
 * Transactions bind every statement to one dedicated pool client. This is
 * required both for atomic migration+ledger writes and request-scoped RLS
 * settings established with `SET LOCAL`.
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

  async transaction<T>(fn: (executor: PostgresQueryExecutor) => Promise<T>): Promise<T> {
    return this.client.transaction((client) => fn(queryExecutor(client)));
  }

  async withRequestContext<T>(
    context: { tenantId: string; principalId: string; requestId: string },
    fn: (client: PoolQueryClient) => Promise<T>,
  ): Promise<T> {
    return this.client.transaction(async (client) => {
      await client.execute("SET LOCAL ROLE open_loops_runtime");
      await client.execute("SET LOCAL search_path = pg_catalog, public");
      await client.get(
        `SELECT
          set_config('open_loops.tenant_id', $1, true),
          set_config('open_loops.principal_id', $2, true),
          set_config('open_loops.request_id', $3, true)`,
        [context.tenantId, context.principalId, context.requestId],
      );
      const scoped: PoolQueryClient = {
        ...client,
        pool: this.client.pool,
        transaction: (nested) => nested(client),
        close: async () => {},
      };
      return fn(scoped);
    });
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

function queryExecutor(client: TypedQueryClient): PostgresQueryExecutor {
  return {
    query: <T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) =>
      client.many<T>(sql, params),
    execute: (sql: string, params?: readonly unknown[]) => client.execute(sql, params),
  };
}
