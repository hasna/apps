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

export function sslConfigFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return undefined;
  }
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
  const ssl = url.searchParams.get("ssl")?.toLowerCase();
  if (sslMode === "disable" || ssl === "false") return undefined;
  if (sslMode === "no-verify" || process.env["HASNA_MACHINES_DATABASE_SSL_REJECT_UNAUTHORIZED"] === "0") {
    return { rejectUnauthorized: false };
  }
  return sslMode || ssl === "true" ? { rejectUnauthorized: true } : undefined;
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
