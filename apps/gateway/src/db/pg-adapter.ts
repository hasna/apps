import { Pool, type PoolConfig } from "pg";

import type { RunResult } from "./sqlite-adapter";

/**
 * Rewrites the SQLite-flavoured placeholders used by the ledger statements into the
 * numbered form Postgres requires (`?` -> `$1`, `$2`, ...).
 *
 * The scope is deliberately a placeholder rewrite rather than a general SQLite-to-Postgres
 * dialect translator. Every statement that reaches this adapter is written in
 * `src/storage.ts` — the ledger DDL, its two `CREATE INDEX` statements, one `INSERT` and
 * one `SELECT` — and `?` placeholders are the only construct among them that Postgres
 * spells differently. None of them contains a `?` inside a string literal, which a
 * regex-level rewrite could not tell apart from a placeholder.
 */
export function sqlitePlaceholdersToPostgres(sql: string): string {
  let placeholder = 0;
  return sql.replace(/\?/g, () => `$${(placeholder += 1)}`);
}

/**
 * Normalizes bindings for `pg`, which takes one array of values.
 *
 * Callers may pass either the spread form (`run(sql, a, b)`) or a single array
 * (`run(sql, [a, b])`). `pg` also rejects `undefined`, so it is mapped to SQL NULL.
 */
export function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? (params[0] as unknown[]) : params;
  return flat.map((value) => (value === undefined ? null : value));
}

/**
 * Resolves TLS options for a connection string.
 *
 * `sslmode=require` means "encrypt but do not verify the server certificate" in libpq,
 * which is the mode managed Postgres providers document when their CA is not in the
 * default trust store. Every other mode is left to `pg`'s own connection-string parsing
 * so verifying modes such as `verify-full` keep verifying.
 */
export function resolvePoolSsl(connectionString: string): PoolConfig["ssl"] {
  const encryptWithoutVerifying =
    connectionString.includes("sslmode=require") || connectionString.includes("ssl=true");
  return encryptWithoutVerifying ? { rejectUnauthorized: false } : undefined;
}

/**
 * Promise-based Postgres adapter backing the `storage.cloud` `backend: "postgres"`
 * usage ledger.
 *
 * Constructing it does not open a socket: `pg` pools connect lazily on the first query,
 * so a misconfigured connection string surfaces as a query-time failure, which is what
 * `src/storage.ts` already maps onto `usage_ledger_*_failed` errors.
 */
export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, ssl: resolvePoolSsl(connectionString) });
  }

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const result = await this.pool.query(sqlitePlaceholdersToPostgres(sql), normalizeParams(params));
    const firstRow = result.rows[0] as { id?: number | bigint } | undefined;
    return { changes: result.rowCount ?? 0, lastInsertRowid: firstRow?.id ?? 0 };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(sqlitePlaceholdersToPostgres(sql), normalizeParams(params));
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sqlitePlaceholdersToPostgres(sql));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
