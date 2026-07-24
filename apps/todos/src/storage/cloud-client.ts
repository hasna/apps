import type { TodosPostgresQueryClient, TodosPostgresQueryResult } from "./postgres-sync.js";
import {
  assertTodosLocalStorageRole,
  getTodosStorageDatabaseUrl,
  type TodosStorageEnv,
} from "./config.js";
import { assertTodosStageARemoteAccessFloor } from "./authority-floor.js";

function assertStageARemoteClientAuthority(): void {
  assertTodosStageARemoteAccessFloor();
}

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
  // Stage A has no trusted hosted principal or tenant/project grants. This
  // floor deliberately precedes URL/options reads and Bun.SQL construction.
  assertStageARemoteClientAuthority();
  assertTodosLocalStorageRole(process.env);
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
      assertStageARemoteClientAuthority();
      const result = await sql.unsafe(text, values.length ? [...values] : []);
      return { rows: toRows<T>(result) };
    },
    async close(): Promise<void> {
      assertStageARemoteClientAuthority();
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
  assertStageARemoteClientAuthority();
  assertTodosLocalStorageRole(process.env);
  assertTodosLocalStorageRole(env);
  const url = getTodosStorageDatabaseUrl(env);
  if (!url) return null;
  return createTodosCloudQueryClient(url, options);
}
/**
 * Explicit low-level Postgres operator client. Stage-A product entrypoints must
 * never select this constructor automatically; their containment is enforced at
 * CLI/API/MCP/server/shadow boundaries and in the convenience storage factory.
 */
