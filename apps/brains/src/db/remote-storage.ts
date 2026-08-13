import pg from "pg";
import type { Pool, PoolConfig } from "pg";

const LOCAL_PG_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function parsePgUrl(connectionString: string): URL | undefined {
  try {
    return new URL(connectionString);
  } catch {
    return undefined;
  }
}

function isLocalPgHost(hostname: string): boolean {
  return LOCAL_PG_HOSTS.has(hostname.replace(/^\[|\]$/g, ""));
}

function normalizedParams(url: URL, name: string): string[] {
  return url.searchParams.getAll(name).map((value) => value.trim().toLowerCase());
}

function isFalseySslValue(value: string): boolean {
  return value === "0" || value === "false" || value === "no" || value === "disable" || value === "disabled";
}

function isTruthyValue(value: string): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function sanitizedConnectionString(url: URL): string {
  for (const param of ["ssl", "sslmode", "uselibpqcompat"]) {
    url.searchParams.delete(param);
  }
  return url.toString();
}

export function buildPgPoolConfig(connectionString: string): PoolConfig {
  const url = parsePgUrl(connectionString);
  if (!url) {
    return { connectionString, ssl: { rejectUnauthorized: true } };
  }

  const hostname = url.hostname;
  const localHost = isLocalPgHost(hostname);
  const sslModes = normalizedParams(url, "sslmode");
  const sslParams = normalizedParams(url, "ssl");
  const libpqCompatParams = normalizedParams(url, "uselibpqcompat");
  const explicitTlsOff = sslModes.includes("disable") || sslParams.some(isFalseySslValue);
  const weakTlsMode = sslModes.some((mode) => mode === "allow" || mode === "prefer" || mode === "no-verify");
  const libpqCompatibility = libpqCompatParams.some(isTruthyValue);
  const sanitized = sanitizedConnectionString(url);

  if ((explicitTlsOff || weakTlsMode || libpqCompatibility) && !localHost) {
    throw new Error("Remote PostgreSQL storage must use verified TLS.");
  }

  if (localHost && (explicitTlsOff || sslModes.length === 0 && sslParams.length === 0)) {
    return { connectionString: sanitized };
  }

  return { connectionString: sanitized, ssl: { rejectUnauthorized: true } };
}

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool(buildPgPoolConfig(connectionString));
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows[0] ?? null;
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(translatePlaceholders(sql), normalizeParams(params));
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
