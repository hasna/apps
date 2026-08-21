import pg from "pg";
import type { Pool } from "pg";

export const STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV = "HASNA_STATIONS_ALLOW_INSECURE_DATABASE_TLS";
export const STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV = "HASNA_STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED";

type Env = Record<string, string | undefined>;

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

function envFlag(env: Env, name: string): boolean {
  const value = env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost"
    || normalized === "::1"
    || normalized === "0:0:0:0:0:0:0:1"
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function allowsLocalInsecureTls(url: URL, env: Env): boolean {
  return isLoopbackHost(url.hostname) && envFlag(env, STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV);
}

export function sslConfigFor(connectionString: string, env: Env = process.env): { rejectUnauthorized: boolean } | undefined {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return undefined;
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  const ssl = url.searchParams.get("ssl")?.toLowerCase();
  const rejectUnauthorizedOverride = env[STATIONS_DATABASE_SSL_REJECT_UNAUTHORIZED_ENV]?.trim() === "0";

  if (sslMode === "disable" || ssl === "false") {
    if (allowsLocalInsecureTls(url, env)) return undefined;
    throw new Error(
      `Insecure PostgreSQL TLS mode is rejected for remote storage; use sslmode=require or set ${STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV}=1 only for loopback development databases.`,
    );
  }
  if (sslMode === "no-verify" || rejectUnauthorizedOverride) {
    if (!allowsLocalInsecureTls(url, env)) {
      throw new Error(
        `PostgreSQL TLS certificate verification cannot be disabled for remote storage; set ${STATIONS_DATABASE_ALLOW_INSECURE_TLS_ENV}=1 only for loopback development databases.`,
      );
    }
    return { rejectUnauthorized: false };
  }
  if (sslMode || ssl === "true") return { rejectUnauthorized: true };
  return isLoopbackHost(url.hostname) ? undefined : { rejectUnauthorized: true };
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, ssl: sslConfigFor(connectionString) });
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
