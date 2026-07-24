// Live PostgreSQL executor backed by a `pg.Pool`.
//
// SERVER-SIDE ONLY. A pool is only ever constructed from an explicit
// self-hosted connection string (`HASNA_PERSONALNOTES_DATABASE_URL`) on the
// serve/migrate binaries. Clients (CLI/MCP/SDK) never hold a DSN; they route
// over HTTP (hasna-storage-standard).

import { Pool, type PoolClient } from "pg";
import type { PostgresQueryExecutor } from "./postgres.js";

export interface PgExecutorOptions {
  connectionString: string;
  max?: number;
  applicationName?: string;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
}

/** `PostgresQueryExecutor` over a `pg.Pool`. Transactions bind to one client. */
export class PgPoolExecutor implements PostgresQueryExecutor {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  static fromConnectionString(options: PgExecutorOptions): PgPoolExecutor {
    const pool = new Pool({
      connectionString: options.connectionString,
      ...(options.max !== undefined ? { max: options.max } : {}),
      ...(options.applicationName !== undefined
        ? { application_name: options.applicationName }
        : {}),
      ...(options.connectionTimeoutMillis !== undefined
        ? { connectionTimeoutMillis: options.connectionTimeoutMillis }
        : {}),
      ...(options.idleTimeoutMillis !== undefined
        ? { idleTimeoutMillis: options.idleTimeoutMillis }
        : {}),
    });
    return new PgPoolExecutor(pool);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(sql, params ? [...params] : undefined);
    return result.rows as T[];
  }

  async execute(sql: string, params?: readonly unknown[]): Promise<void> {
    await this.pool.query(sql, params ? [...params] : undefined);
  }

  async transaction<T>(fn: (executor: PostgresQueryExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(clientExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback failure; surface the original error
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function clientExecutor(client: PoolClient): PostgresQueryExecutor {
  return {
    async query<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const result = await client.query(sql, params ? [...params] : undefined);
      return result.rows as T[];
    },
    async execute(sql: string, params?: readonly unknown[]) {
      await client.query(sql, params ? [...params] : undefined);
    },
  };
}
