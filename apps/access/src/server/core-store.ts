import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

export interface CoreExecutor { query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null }> }
export interface CoreConnection extends CoreExecutor { release(): void }
export interface CorePool { connect(): Promise<CoreConnection>; end(): Promise<void> }
export const now = (): string => new Date().toISOString();
export const uuid = (): string => crypto.randomUUID();

/** Translate this app's bound placeholders, never interpolating argument values. */
export function postgresSql(sql: string): string {
  let quote = "";
  let n = 0;
  let result = "";
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      result += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) result += sql[++i];
        else quote = "";
      }
    } else if (ch === "'" || ch === '"') { quote = ch; result += ch; }
    else if (ch === "?") result += `$${++n}`;
    else result += ch;
  }
  if (quote) throw new Error("Unterminated SQL literal.");
  return result;
}

export class CoreDatabase {
  constructor(private readonly executor: CoreExecutor) {}
  query(sql: string) {
    const query = (params: unknown[]) => this.executor.query(postgresSql(sql), params);
    return {
      get: async (...params: unknown[]) => (await query(params)).rows[0] ?? null,
      all: async (...params: unknown[]) => (await query(params)).rows,
      run: async (...params: unknown[]) => { await query(params); },
    };
  }
}

const operationDatabase = new AsyncLocalStorage<CoreDatabase>();

/** A domain handler cannot acquire an ambient/local database outside its transaction. */
export function getDatabase(): CoreDatabase {
  const db = operationDatabase.getStore();
  if (!db) throw new Error("Access core operation requires a server PostgreSQL transaction.");
  return db;
}

export async function withCoreTransaction<T>(pool: CorePool, handler: () => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    // Serialize the app's read-modify-write/audit chains across service instances.
    // A later concurrency optimisation must preserve the same ordering guarantees.
    await connection.query("SELECT pg_advisory_xact_lock(1935762275)");
    const result = await operationDatabase.run(new CoreDatabase(connection), handler);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    try { await connection.query("ROLLBACK"); } catch { /* preserve original failure */ }
    throw error;
  } finally { connection.release(); }
}

function configuredValue(env: Record<string, string | undefined>, names: string[]): string {
  const values = names.filter(name => env[name] !== undefined).map(name => {
    const raw = env[name]!;
    if (!raw || raw !== raw.trim()) throw new Error(`Invalid server configuration: ${name}.`);
    if (!name.endsWith("_FILE")) return raw;
    try {
      const content = readFileSync(raw, "utf8").trim();
      if (!content) throw new Error();
      return content;
    } catch { throw new Error(`Cannot read server credential pointer: ${name}.`); }
  });
  if (!values.length || new Set(values).size !== 1) throw new Error("Access server requires one unambiguous PostgreSQL credential declaration.");
  return values[0]!;
}

export function postgresOptions(env: Record<string, string | undefined> = process.env) {
  const dsn = configuredValue(env, ["HASNA_ACCESS_DATABASE_URL", "ACCESS_DATABASE_URL", "HASNA_ACCESS_DATABASE_URL_FILE", "ACCESS_DATABASE_URL_FILE"]);
  let url: URL;
  try { url = new URL(dsn); } catch { throw new Error("Invalid server PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || !url.password || url.hash || !/^\/[^/]+$/.test(url.pathname) || /[\s\x00-\x1f\x7f]/.test(dsn)) throw new Error("Invalid server PostgreSQL URL.");
  if (url.searchParams.get("sslmode") !== "verify-full" || [...url.searchParams.keys()].some(key => key !== "sslmode") || url.searchParams.getAll("sslmode").length !== 1) throw new Error("Server PostgreSQL requires sslmode=verify-full and no transport override parameters.");
  let ca: string | undefined;
  if (env.PGSSLROOTCERT !== undefined) {
    try { ca = readFileSync(env.PGSSLROOTCERT, "utf8"); if (!ca.trim()) throw new Error(); }
    catch { throw new Error("Cannot read server PostgreSQL CA certificate."); }
  }
  try {
    return { host: url.hostname, port: Number(url.port || 5432), database: decodeURIComponent(url.pathname.slice(1)), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: { rejectUnauthorized: true as const, ...(ca ? { ca } : {}) }, connectionTimeoutMillis: 10_000, max: 10 };
  } catch { throw new Error("Invalid server PostgreSQL URL encoding."); }
}

export function createCorePool(env: Record<string, string | undefined> = process.env): CorePool {
  return new Pool(postgresOptions(env)) as CorePool;
}
