import type { TodosPostgresQueryClient, TodosPostgresQueryResult } from "./postgres-sync.js";
import { getTodosStorageDatabaseUrl, type TodosStorageEnv } from "./config.js";

/**
 * A live Postgres query client for the shadow mirror and divergence diagnostics.
 *
 * This uses Bun's built-in SQL driver (`Bun.SQL`) so the OSS package keeps ZERO
 * cloud/database runtime dependencies — the driver is only touched when the
 * caller explicitly opens a connection (shadow mode or `storage shadow-status`).
 * SSL/TLS behaviour is taken verbatim from the connection string (e.g.
 * `?sslmode=require`); we never disable certificate verification.
 */
export interface TodosCloudQueryClient extends TodosPostgresQueryClient {
  close(): Promise<void>;
}

interface BunSqlLike {
  unsafe(query: string, values?: unknown[]): Promise<unknown>;
  end?(): Promise<void>;
  close?(): Promise<void>;
}

type BunSqlConstructor = new (url: string, options?: Record<string, unknown>) => BunSqlLike;

function resolveBunSql(): BunSqlConstructor {
  const runtime = (globalThis as { Bun?: { SQL?: unknown } }).Bun;
  const ctor = runtime?.SQL;
  if (typeof ctor !== "function") {
    throw new Error(
      "Live Postgres access requires the Bun runtime (Bun.SQL). Run todos under bun, or inject a TodosPostgresQueryClient.",
    );
  }
  return ctor as BunSqlConstructor;
}

function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export interface CreateTodosCloudQueryClientOptions {
  /** Maximum pooled connections. Shadow mirror is low-volume, so keep it tiny. */
  max?: number;
  /** Connection idle timeout in seconds. */
  idleTimeout?: number;
  /** Statement/connection timeout in seconds. */
  connectionTimeout?: number;
}

export function createTodosCloudQueryClient(
  url: string,
  options: CreateTodosCloudQueryClientOptions = {},
): TodosCloudQueryClient {
  const SQL = resolveBunSql();
  const sql = new SQL(url, {
    max: options.max ?? 2,
    idleTimeout: options.idleTimeout ?? 20,
    connectionTimeout: options.connectionTimeout ?? 15,
  });

  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<TodosPostgresQueryResult<T>> {
      const result = await sql.unsafe(text, values.length ? [...values] : []);
      return { rows: toRows<T>(result) };
    },
    async close(): Promise<void> {
      if (typeof sql.end === "function") await sql.end();
      else if (typeof sql.close === "function") await sql.close();
    },
  };
}

/**
 * Build a live cloud client from the configured database URL, or return `null`
 * when no remote DSN is present. Never reads from the remote store on its own —
 * callers decide what to run.
 */
export function createTodosCloudQueryClientFromEnv(
  env: TodosStorageEnv = process.env,
  options: CreateTodosCloudQueryClientOptions = {},
): TodosCloudQueryClient | null {
  const url = getTodosStorageDatabaseUrl(env);
  if (!url) return null;
  return createTodosCloudQueryClient(url, options);
}
