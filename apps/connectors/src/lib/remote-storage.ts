import pg from "pg";
import type { Pool, PoolClient, PoolConfig } from "pg";

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

function parseKeywordFields(connectionString: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const part of connectionString.match(/\S+=("[^"]*"|'[^']*'|\S*)/g) ?? []) {
    const [key, ...valueParts] = part.split("=");
    if (!key) continue;
    fields.set(key.toLowerCase(), valueParts.join("=").replace(/^['"]|['"]$/g, ""));
  }
  return fields;
}

function sslConfigFor(sslMode: string | null, ssl: string | null): boolean | { rejectUnauthorized: boolean } | undefined {
  const normalizedMode = sslMode?.toLowerCase() ?? null;
  const normalizedSsl = ssl?.toLowerCase() ?? null;
  if (normalizedMode === "disable" || normalizedSsl === "false") return undefined;
  if (normalizedMode || normalizedSsl === "true") return { rejectUnauthorized: true };
  return undefined;
}

function poolOptionsFor(connectionString: string): PoolConfig {
  try {
    const url = new URL(connectionString);
    return {
      connectionString,
      ssl: sslConfigFor(url.searchParams.get("sslmode"), url.searchParams.get("ssl")),
    };
  } catch {
    const fields = parseKeywordFields(connectionString);
    if (fields.size === 0) return { connectionString };

    const options: PoolConfig = {};
    if (fields.has("host")) options.host = fields.get("host");
    if (fields.has("port")) {
      const port = Number(fields.get("port"));
      if (Number.isInteger(port) && port > 0) options.port = port;
    }
    if (fields.has("dbname")) options.database = fields.get("dbname");
    if (fields.has("database")) options.database = fields.get("database");
    if (fields.has("user")) options.user = fields.get("user");
    if (fields.has("password")) options.password = fields.get("password");
    if (fields.has("application_name")) options.application_name = fields.get("application_name");
    const ssl = sslConfigFor(fields.get("sslmode") ?? null, fields.get("ssl") ?? null);
    if (ssl !== undefined) options.ssl = ssl;
    return options;
  }
}

export class PgTransactionAdapter {
  constructor(private readonly client: PoolClient) {}

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.client.query(sql, normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown> {
    const result = await this.client.query(sql, normalizeParams(params));
    return result.rows[0] ?? null;
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.client.query(sql, normalizeParams(params));
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string);
  constructor(pool: Pool);
  constructor(source: string | Pool) {
    this.pool = typeof source === "string"
      ? new pg.Pool(poolOptionsFor(source))
      : source;
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    const result = await this.pool.query(sql, normalizeParams(params));
    return { changes: result.rowCount ?? 0 };
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown> {
    const result = await this.pool.query(sql, normalizeParams(params));
    return result.rows[0] ?? null;
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    const result = await this.pool.query(sql, normalizeParams(params));
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: (adapter: PgTransactionAdapter) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgTransactionAdapter(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  get raw(): Pool {
    return this.pool;
  }
}
