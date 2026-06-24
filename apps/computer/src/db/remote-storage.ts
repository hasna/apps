import pg from "pg";
import type { Pool } from "pg";

function translatePlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function normalizeParams(params: unknown[]): unknown[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

export interface PgAdapterOptions {
  allowInsecureTls?: boolean;
}

export function sslConfigFor(
  connectionString: string,
  options: PgAdapterOptions = {}
): { rejectUnauthorized: boolean } | undefined {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  const ssl = url.searchParams.get("ssl")?.toLowerCase();

  if (sslMode === "disable" || ssl === "false") return undefined;
  if (sslMode === "require" || sslMode === "verify-full" || sslMode === "verify-ca" || ssl === "true") {
    return { rejectUnauthorized: options.allowInsecureTls === true ? false : true };
  }
  return undefined;
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string, options: PgAdapterOptions = {}) {
    this.pool = new pg.Pool({ connectionString, ssl: sslConfigFor(connectionString, options) });
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
