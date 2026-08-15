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

/**
 * P1-5: verified TLS by default. `sslmode=require` / `ssl=true` previously
 * produced `rejectUnauthorized: false` — TLS that verified nothing, so the
 * "encrypted" channel was open to a MITM. The default is now
 * `rejectUnauthorized: true`.
 *
 * Insecure verification exists ONLY through the explicit dev-only config key
 * HASNA_HOOKS_PG_INSECURE_TLS=1 (or HOOKS_PG_INSECURE_TLS) and is refused
 * under a production-shaped environment (NODE_ENV=production) — a dev key
 * silently disabling verification in prod would be the exact failure this
 * finding corrects.
 *
 * Exported for tests; the connection-string forms are the documented
 * sslmode values the pg client understands.
 */
export function sslConfigFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  const wantsSsl =
    connectionString.includes("sslmode=require") ||
    connectionString.includes("sslmode=verify-ca") ||
    connectionString.includes("sslmode=verify-full") ||
    connectionString.includes("sslmode=prefer") ||
    connectionString.includes("ssl=true");

  if (!wantsSsl) return undefined;

  const insecure =
    process.env.HASNA_HOOKS_PG_INSECURE_TLS === "1" || process.env.HOOKS_PG_INSECURE_TLS === "1";

  if (insecure && process.env.NODE_ENV === "production") {
    throw new Error(
      "HASNA_HOOKS_PG_INSECURE_TLS / HOOKS_PG_INSECURE_TLS is a dev-only key and is refused under NODE_ENV=production. Use verified TLS (default) instead.",
    );
  }

  return insecure ? { rejectUnauthorized: false } : { rejectUnauthorized: true };
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
