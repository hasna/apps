/**
 * Live Postgres query client for the @hasna/calendar cloud (A1 pure-remote)
 * service. Uses Bun's built-in SQL driver (`Bun.SQL`) so the OSS package keeps
 * ZERO cloud/database runtime dependencies — the driver is only touched when the
 * serve process opens a `/v1` (or `/ready`) connection. SSL/TLS behaviour is
 * taken verbatim from the connection string (e.g. `?sslmode=require`); we never
 * disable certificate verification.
 *
 * This is the repo-local vendoring of the @hasna/contracts storage kit's query
 * surface — a thin `{ rows }`-returning client the contracts auth `ApiKeyStore`
 * and the calendar Postgres store both consume.
 */

export interface CloudQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface CalendarCloudQueryClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<CloudQueryResult<T>>;
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
      "Live Postgres access requires the Bun runtime (Bun.SQL). Run calendar-serve under bun.",
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

export interface CreateCloudQueryClientOptions {
  max?: number;
  idleTimeout?: number;
  connectionTimeout?: number;
}

export function createCalendarCloudQueryClient(
  url: string,
  options: CreateCloudQueryClientOptions = {},
): CalendarCloudQueryClient {
  const SQL = resolveBunSql();
  const sql = new SQL(url, {
    max: options.max ?? 5,
    idleTimeout: options.idleTimeout ?? 30,
    connectionTimeout: options.connectionTimeout ?? 15,
  });

  return {
    async query<T = Record<string, unknown>>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<CloudQueryResult<T>> {
      const result = await sql.unsafe(text, values.length ? [...values] : []);
      return { rows: toRows<T>(result) };
    },
    async close(): Promise<void> {
      if (typeof sql.end === "function") await sql.end();
      else if (typeof sql.close === "function") await sql.close();
    },
  };
}
