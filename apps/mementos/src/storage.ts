import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import pg from "pg";
import type { Pool, PoolClient } from "pg";
import { resolveServerDataBackend, resolveDatabaseUrl, type ServerDataBackend } from "./generated/storage-kit/backend.js";
import { assertNoLegacyStorageMode } from "./lib/retired-storage-mode.js";
import { getDataRoot } from "./lib/paths.js";

// ============================================================================
// Server-only DSN boundary (project CLAUDE.md §2, NON-NEGOTIABLE)
//
// The raw RDS Postgres DSN is a SERVER concern and must NEVER be constructed or
// used on a client machine. Only the `mementos-serve` process (which runs on our
// AWS/ECS and legitimately holds the DSN via Secrets Manager) may open a direct
// Postgres connection. Every client entrypoint — CLI, MCP, SDK — must reach the
// self-hosted store over HTTPS with a bearer API key
// (HASNA_MEMENTOS_API_URL + HASNA_MEMENTOS_API_KEY), never a DSN.
//
// The server opts in explicitly by calling `markServerContext()` at startup.
// Any client code path that tries to build the DSN fails closed here.
// ============================================================================
let _serverContext = false;

/** Called once by the mementos-serve entrypoint; enables the server-only DSN path. */
export function markServerContext(): void {
  _serverContext = true;
}

export function resetServerContextForTests(): void {
  if (process.env["NODE_ENV"] !== "test") {
    throw new Error("resetServerContextForTests is only available under NODE_ENV=test");
  }
  _serverContext = false;
}

/** True only inside the `mementos-serve` server process. */
export function isServerContext(): boolean {
  return _serverContext;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface PreparedStatement {
  run(...params: any[]): RunResult;
  get(...params: any[]): any;
  all(...params: any[]): any[];
  finalize(): void;
}

export interface DbAdapter {
  run(sql: string, ...params: any[]): RunResult;
  get(sql: string, ...params: any[]): any;
  all(sql: string, ...params: any[]): any[];
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  close(): void;
  transaction<T>(fn: () => T): T;
}

function normalizeParams(params: any[]): any[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => value === undefined ? null : value);
}

export class SqliteAdapter implements DbAdapter {
  private readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  run(sql: string, ...params: any[]): RunResult {
    const result = this.db.prepare(sql).run(...normalizeParams(params));
    return {
      changes: result.changes,
      lastInsertRowid: result.lastInsertRowid,
    };
  }

  get(sql: string, ...params: any[]): any {
    return this.db.prepare(sql).get(...normalizeParams(params));
  }

  all(sql: string, ...params: any[]): any[] {
    return this.db.prepare(sql).all(...normalizeParams(params));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  query(sql: string) {
    return this.db.query(sql);
  }

  prepare(sql: string): PreparedStatement {
    const statement = this.db.prepare(sql);
    return {
      run: (...params: any[]): RunResult => {
        const result = statement.run(...normalizeParams(params));
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (...params: any[]): any => statement.get(...normalizeParams(params)),
      all: (...params: any[]): any[] => statement.all(...normalizeParams(params)),
      finalize: (): void => {
        statement.finalize();
      },
    };
  }

  close(): void {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  get raw(): Database {
    return this.db;
  }
}

export function translateSql(sql: string): string {
  let parameterIndex = 0;
  let translated = sql.replace(/\?/g, () => `$${++parameterIndex}`);

  // Mementos stores timestamps as ISO-8601 UTC strings (JS `toISOString()`).
  // The cloud schema is mixed: some columns are `timestamptz`, others are
  // `text`. Emitting an ISO-8601 UTC *text* value for SQLite's `datetime('now')`
  // compares correctly against BOTH: text-vs-text is lexicographic (ISO ordering
  // == chronological), and timestamptz-vs-text implicitly casts the text.
  const ISO_FMT = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
  translated = translated.replace(
    /datetime\s*\(\s*'now'\s*\)/gi,
    `to_char(now() AT TIME ZONE 'UTC', ${ISO_FMT})`
  );
  // The local SQLite path renders `now` in the same byte format as JS
  // `toISOString()` via `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` so stored
  // ISO-8601 TEXT timestamps compare chronologically. Postgres has no
  // strftime; map the exact ISO format string to the identical to_char
  // expression the `datetime('now')` form already used.
  translated = translated.replace(
    /strftime\s*\(\s*'%Y-%m-%dT%H:%M:%fZ'\s*,\s*'now'\s*\)/gi,
    `to_char(now() AT TIME ZONE 'UTC', ${ISO_FMT})`
  );
  translated = translated.replace(
    /datetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s+(minutes?|hours?|days?|seconds?)'\s*\)/gi,
    (_match, amount, unit) => {
      const parsed = parseInt(String(amount), 10);
      const absolute = Math.abs(parsed);
      const normalizedUnit = String(unit).toLowerCase().replace(/s$/, "");
      const pluralUnit = absolute === 1 ? normalizedUnit : `${normalizedUnit}s`;
      const op = parsed < 0 ? "-" : "+";
      return `to_char((now() ${op} INTERVAL '${absolute} ${pluralUnit}') AT TIME ZONE 'UTC', ${ISO_FMT})`;
    }
  );

  // Mixed-type COALESCE: in the cloud schema `created_at`/`updated_at` are
  // `timestamptz` while `accessed_at` is `text` (JS ISO-8601). Postgres refuses
  // `COALESCE(text, timestamptz)` ("types text and timestamp with time zone
  // cannot be matched"), which 500s the `stale`, health, and retention surfaces
  // (`archiveStale` uses COALESCE(accessed_at, created_at); `deprioritizeStale`
  // uses COALESCE(accessed_at, updated_at) — reached by `mementos clean`).
  // Render the timestamptz fallback as the SAME ISO-8601 text as accessed_at so
  // the COALESCE is type-consistent AND the fallback sorts/compares
  // lexicographically alongside real accessed_at values (identical format =>
  // chronological order preserved).
  translated = translated.replace(
    /COALESCE\s*\(\s*accessed_at\s*,\s*(created_at|updated_at)\s*\)/gi,
    (_match, col: string) =>
      `COALESCE(accessed_at, to_char(${col} AT TIME ZONE 'UTC', ${ISO_FMT}))`
  );
  translated = translated.replace(
    /lower\s*\(\s*hex\s*\(\s*randomblob\s*\(\s*\d+\s*\)\s*\)\s*\)/gi,
    "gen_random_uuid()::text"
  );
  translated = translated.replace(/\bIFNULL\s*\(/gi, "COALESCE(");

  // SQLite `INSTR(haystack, needle)` -> Postgres `STRPOS(string, substring)`.
  // Same argument order and same semantics (1-based position, 0 when absent),
  // so the `= 0` "not present" idiom in the graph-path recursive CTE is
  // preserved. Postgres has no INSTR function, so without this the
  // `graph path` recursive CTE errors out (500 on GET /v1/graph/path).
  translated = translated.replace(/\bINSTR\s*\(/gi, "STRPOS(");

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(translated)) {
    translated = translated.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, "INSERT INTO");
    translated = translated.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  }

  translated = translated.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, "INSERT INTO");

  // Postgres does not implicitly cast integer 0/1 to BOOLEAN. The SQLite schema
  // uses 0/1 for boolean-typed columns (e.g. memories.pinned). Rewrite the
  // known boolean-column assignment/default idioms so writes succeed against
  // the BOOLEAN columns in the cloud schema. Reads return JS booleans, which
  // `parseMemoryRow`'s `!!(...)` handles transparently.
  translated = translated.replace(
    /COALESCE\s*\(\s*pinned\s*,\s*0\s*\)/gi,
    "COALESCE(pinned, FALSE)"
  );

  // Literal integer comparisons against BOOLEAN columns. Postgres has no
  // `boolean = integer` operator, so `<col> = 1`/`<col> = 0` literals must
  // become TRUE/FALSE. This covers every boolean column in the cloud schema
  // (see pg-migrations.ts): `pinned` (health/stats/report), `success`
  // (tool-insights — `SUM(CASE WHEN success = 1 ...)` 500s without this),
  // `is_primary` (machines), plus blocking/enabled/useful/dry_run/applied.
  // Parameterized `<col> = ?` is unaffected — pg coerces the bound '1'/'0'
  // text to boolean. Only bare integer literals are rewritten.
  const BOOLEAN_COLUMNS = [
    "pinned",
    "success",
    "is_primary",
    "blocking",
    "enabled",
    "useful",
    "dry_run",
    "applied",
  ];
  for (const col of BOOLEAN_COLUMNS) {
    translated = translated.replace(new RegExp(`\\b${col}\\s*=\\s*1\\b`, "gi"), `${col} = TRUE`);
    translated = translated.replace(new RegExp(`\\b${col}\\s*=\\s*0\\b`, "gi"), `${col} = FALSE`);
  }

  return translated;
}

export function shouldUsePgSsl(connectionString: string): boolean {
  let params: URLSearchParams;

  try {
    params = new URL(connectionString).searchParams;
  } catch {
    params = new URLSearchParams(connectionString.split("?", 2)[1] ?? "");
  }

  const ssl = params.get("ssl")?.trim().toLowerCase();
  const sslMode = params.get("sslmode")?.trim().toLowerCase();

  return (
    ["1", "true", "yes", "on", "require"].includes(ssl ?? "") ||
    ["require", "verify-ca", "verify-full"].includes(sslMode ?? "")
  );
}

type PgSslConfig = boolean | { rejectUnauthorized: boolean };

/**
 * Resolve the `pg` SSL option from a connection string, following libpq
 * semantics rather than node-postgres' newer verify-full-by-default behavior:
 *
 * - `sslmode=verify-ca` / `verify-full` → verify the server certificate.
 * - `sslmode=require` (or `ssl=true|1|yes|on`) → encrypt but do NOT verify the
 *   certificate chain/hostname. This matches libpq `require` and is what lets a
 *   private RDS endpoint (or an SSM/Tailscale tunnel presenting the RDS cert on
 *   a localhost address) connect without a spurious hostname mismatch.
 * - otherwise → no SSL.
 */
function sslConfigFor(connectionString: string): PgSslConfig | undefined {
  if (!shouldUsePgSsl(connectionString)) return undefined;

  let sslMode: string | undefined;
  try {
    sslMode = new URL(connectionString).searchParams.get("sslmode")?.trim().toLowerCase() ?? undefined;
  } catch {
    sslMode = new URLSearchParams(connectionString.split("?", 2)[1] ?? "").get("sslmode")?.trim().toLowerCase() ?? undefined;
  }

  if (sslMode === "verify-ca" || sslMode === "verify-full") {
    return { rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

/**
 * Strip `ssl`/`sslmode` query params from a connection string so the adapter's
 * explicit `ssl` option (from {@link sslConfigFor}) is authoritative. Newer
 * pg-connection-string versions parse `sslmode=require` as verify-full, which
 * clobbers the explicit option and breaks tunnelled/private-endpoint connects.
 */
function stripSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("ssl");
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Build a pg Pool with adapter-controlled SSL from a connection string. */
export function makePool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString: stripSslParams(connectionString),
    ssl: sslConfigFor(connectionString),
  });
}

interface SyncQueryResult {
  rows: any[];
  rowCount: number;
}

/**
 * Synchronous Postgres access backed by a worker thread (see
 * `pg-sync-worker.ts`). The worker owns one long-lived `pg.Client` and runs
 * queries on its own event loop; the main thread blocks on `Atomics.wait`
 * against a SharedArrayBuffer until the worker writes the response. This is the
 * only way to expose a truly synchronous API (which the entire mementos data
 * layer requires) over async pg I/O without deadlocking the main event loop.
 *
 * Every query carries a monotonic generation that the worker echoes back in
 * the status word when the response is ready. When a query times out it is
 * ABANDONED, not cancelled — the worker still finishes it and writes its
 * response later — and the generation is what lets the caller tell that late
 * response apart from the response to the query currently waiting, so a stale
 * payload can never be consumed by a newer query (todos 027d17e9).
 */
export class PgSyncPool {
  private readonly worker: Worker;
  private readonly status: Int32Array;
  private readonly data: Uint8Array;
  private closed = false;
  private lastError: Error | null = null;
  private generation = 0;
  private static readonly DATA_BYTES = 128 * 1024 * 1024; // 128 MiB response ceiling

  /**
   * Per-query timeout in milliseconds, overridable via
   * `MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS` (default 60_000). Read on every query()
   * call so tests can shrink it without import-order games — the regression
   * test in `pg-sync-race.test.ts` relies on this being a live read.
   */
  private static queryTimeoutMs(): number {
    const raw = process.env["MEMENTOS_PGSYNC_QUERY_TIMEOUT_MS"]?.trim();
    const parsed = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000;
  }

  /**
   * Resolve the worker entry file. `storage` is bundled into several entry
   * points at different depths (dist/cli, dist/mcp, dist/server) as well as run
   * directly from source, so probe candidate locations relative to this module.
   */
  private static resolveWorkerPath(): string {
    const ext = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
    const here = fileURLToPath(new URL(".", import.meta.url));
    const candidates = [
      join(here, `pg-sync-worker${ext}`),
      join(here, "..", `pg-sync-worker${ext}`),
      join(here, "..", "..", `pg-sync-worker${ext}`),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0]!;
  }

  constructor(connectionString: string, workerPath?: string) {
    // 3 x Int32: [0]=responding generation (0 idle), [1]=byteLength,
    // [2]=status code (1 ok, 2 err). The generation is the response
    // correlation token: a late response to an abandoned query carries a
    // generation no caller is waiting for and is discarded, never consumed.
    const control = new SharedArrayBuffer(12);
    const dataSab = new SharedArrayBuffer(PgSyncPool.DATA_BYTES);
    this.status = new Int32Array(control);
    this.data = new Uint8Array(dataSab);

    // `workerPath` is the test seam used by src/pg-sync-race.test.ts to run the
    // pool against a stub worker speaking the same protocol.
    this.worker = new Worker(workerPath ?? PgSyncPool.resolveWorkerPath(), {
      workerData: {
        dsn: stripSslParams(connectionString),
        ssl: sslConfigFor(connectionString),
        control,
        data: dataSab,
      },
    });
    // Do not keep the process alive solely for this worker.
    this.worker.unref();
    this.worker.on("error", (err: Error) => {
      this.lastError = err;
    });
  }

  query(sql: string, params: any[]): SyncQueryResult {
    if (this.closed) throw new Error("PgSyncPool is closed");
    if (this.lastError) throw this.lastError;

    const timeoutMs = PgSyncPool.queryTimeoutMs();
    const gen = ++this.generation;
    Atomics.store(this.status, 0, 0);
    Atomics.store(this.status, 2, 0);
    this.worker.postMessage({ sql, params, gen });

    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const remaining = deadline - Date.now();
      const responding = Atomics.load(this.status, 0);
      if (responding === gen) {
        // This query's response: the worker wrote the payload and the code
        // word before it stored `gen`, so both are visible here.
        const code = Atomics.load(this.status, 2);
        const len = Atomics.load(this.status, 1);
        const payload = JSON.parse(new TextDecoder().decode(this.data.subarray(0, len)));
        if (code === 2) {
          throw new Error(payload.message ?? "PostgreSQL error");
        }
        return payload as SyncQueryResult;
      }
      if (responding !== 0) {
        // Response for an abandoned generation (a query that timed out while
        // the worker was still running it). Discard it and re-arm the slot
        // with compareExchange, which closes the lost-notify window: a notify
        // for OUR generation that races the CAS either lands before it (the
        // CAS fails and the loop reads our generation) or after it (the CAS
        // succeeded, the slot is 0 again, and the wait below blocks on it).
        Atomics.compareExchange(this.status, 0, responding, 0);
        continue;
      }
      if (remaining <= 0) {
        if (this.lastError) throw this.lastError;
        throw new Error(`PostgreSQL query timed out after ${timeoutMs}ms`);
      }
      Atomics.wait(this.status, 0, 0, remaining);
    }
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    void this.worker.terminate();
  }
}

export class PgAdapter implements DbAdapter {
  private readonly pool: PgSyncPool;

  constructor(connectionString: string);
  constructor(pool: PgSyncPool);
  constructor(input: string | PgSyncPool) {
    this.pool = typeof input === "string" ? new PgSyncPool(input) : input;
  }

  run(sql: string, ...params: any[]): RunResult {
    const result = this.pool.query(translateSql(sql), normalizeParams(params));
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: result.rows?.[0]?.id ?? 0,
    };
  }

  get(sql: string, ...params: any[]): any {
    const result = this.pool.query(translateSql(sql), normalizeParams(params));
    return result.rows[0] ?? null;
  }

  all(sql: string, ...params: any[]): any[] {
    return this.pool.query(translateSql(sql), normalizeParams(params)).rows;
  }

  exec(sql: string): void {
    // exec runs raw DDL/utility SQL (no `?` params). It is not used in cloud
    // runtime paths (no local schema/migrations in the postgresql backend), but honor it.
    this.pool.query(sql, []);
  }

  prepare(sql: string): PreparedStatement {
    return {
      run: (...params: any[]): RunResult => this.run(sql, ...params),
      get: (...params: any[]): any => this.get(sql, ...params),
      all: (...params: any[]): any[] => this.all(sql, ...params),
      finalize: (): void => {},
    };
  }

  /**
   * Bun-sqlite-style `query()` shim so the CLI/MCP/server call sites that do
   * `db.query(sql).get(...)` / `.all(...)` / `.run(...)` work unchanged against
   * Postgres in the postgresql backend. Behaves like {@link prepare}.
   */
  query(sql: string): PreparedStatement {
    return this.prepare(sql);
  }

  close(): void {
    this.pool.end();
  }

  transaction<T>(fn: () => T): T {
    // All statements serialize over the worker's single client, so BEGIN/COMMIT
    // wrap the synchronous fn() correctly.
    this.pool.query("BEGIN", []);
    try {
      const value = fn();
      this.pool.query("COMMIT", []);
      return value;
    } catch (error) {
      try {
        this.pool.query("ROLLBACK", []);
      } catch {
        // ignore rollback failure; surface the original error
      }
      throw error;
    }
  }

  get raw(): PgSyncPool {
    return this.pool;
  }
}

export class PgAdapterAsync {
  private readonly pool: Pool;

  constructor(connectionString: string);
  constructor(pool: Pool);
  constructor(input: string | Pool) {
    this.pool = typeof input === "string" ? makePool(input) : input;
  }

  async run(sql: string, ...params: any[]): Promise<RunResult> {
    const result = await this.pool.query(translateSql(sql), normalizeParams(params));
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: result.rows?.[0]?.id ?? 0,
    };
  }

  async get(sql: string, ...params: any[]): Promise<any> {
    const result = await this.pool.query(translateSql(sql), normalizeParams(params));
    return result.rows[0] ?? null;
  }

  async all(sql: string, ...params: any[]): Promise<any[]> {
    const result = await this.pool.query(translateSql(sql), normalizeParams(params));
    return result.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
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

export const MEMENTOS_STORAGE_TABLES = [
  "projects",
  "agents",
  "machines",
  "sessions",
  "entities",
  "memories",
  "relations",
  "entity_memories",
  "memory_tags",
  "memory_versions",
  "memory_embeddings",
  "tool_events",
  "resource_locks",
  "memory_ratings",
] as const;

export const STORAGE_TABLES = MEMENTOS_STORAGE_TABLES;

export type MementosStorageTable = (typeof MEMENTOS_STORAGE_TABLES)[number];

export const MEMENTOS_STORAGE_ENV = {
  databaseUrl: "HASNA_MEMENTOS_DATABASE_URL",
} as const;

export const MEMENTOS_STORAGE_FALLBACK_ENV = {
  databaseUrl: "MEMENTOS_DATABASE_URL",
} as const;

type MementosStorageEnvKey = keyof typeof MEMENTOS_STORAGE_ENV;

export interface StorageConfig {
  rds: {
    host: string;
    port: number;
    username: string;
    password_env: string;
    ssl: boolean;
  };
  auto_sync_interval_minutes: number;
  feedback_endpoint: string;
  sync: {
    schedule_minutes: number;
  };
}

const LOCAL_DATA_DIR = getDataRoot();
const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  rds: {
    host: "",
    port: 5432,
    username: "",
    password_env: "MEMENTOS_DATABASE_PASSWORD",
    ssl: true,
  },
  auto_sync_interval_minutes: 0,
  feedback_endpoint: "",
  sync: {
    schedule_minutes: 0,
  },
};
const STORAGE_CONFIG_DIR = join(LOCAL_DATA_DIR, "storage");
const STORAGE_CONFIG_PATH = join(STORAGE_CONFIG_DIR, "config.json");

const DATABASE_ENV_NAMES = [
  { name: MEMENTOS_STORAGE_ENV.databaseUrl, deprecated: false },
  { name: MEMENTOS_STORAGE_FALLBACK_ENV.databaseUrl, deprecated: false },
] as const;

export interface StorageEnv {
  name: string;
  deprecated: boolean;
}

export interface StorageEnvStatus {
  name: string;
  active_name: string;
  configured: boolean;
}

/** The server data backend, from the shared storage kit: `sqlite | postgresql`. */
export type StorageRuntimeKind = ServerDataBackend;

export interface StorageRuntimeContract {
  contract: "mementos-storage-runtime-v1";
  kind: StorageRuntimeKind;
  fail_closed: boolean;
  local: {
    adapter: "sqlite";
    primary_runtime: boolean;
    data_dir: string;
    config_path: string;
    local_file_sync: {
      supported: false;
      reason: string;
    };
  };
  backend: {
    adapter: "sqlite" | "postgres";
    requested: boolean;
    configured: boolean;
    source: "env" | "config-file" | "none";
    env_name: string | null;
    redacted_url: string | null;
    rds_compatible: boolean;
    fail_closed: boolean;
    missing: string[];
  };
  migrations: {
    target: "postgres-rds-compatible";
    command: "mementos storage migrate";
    dry_run_command: "mementos storage migrate --dry-run";
    configured: boolean;
    mutates_remote_on_apply: true;
    requires_approval_for_live_run: true;
  };
}

export interface SafeStorageConfigSummary {
  auto_sync_interval_minutes: number;
  feedback_endpoint_configured: boolean;
  sync: StorageConfig["sync"];
  rds: {
    host_configured: boolean;
    port: number;
    username_configured: boolean;
    password_env: string;
    password_configured: boolean;
    ssl: boolean;
  };
}

export interface NativeStorageStatus {
  ok: boolean;
  service: "mementos";
  backend: StorageRuntimeKind;
  local_default: boolean;
  runtime: StorageRuntimeContract;
  database: {
    configured: boolean;
    redacted_url: string | null;
    source: "env" | "config-file" | "none";
    env_name: string | null;
    rds_compatible: boolean;
  };
  tables: readonly MementosStorageTable[];
  env: {
    databaseUrl: StorageEnvStatus;
  };
  issues: string[];
  warnings: string[];
  no_network: true;
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readConfigFile(): Partial<StorageConfig> {
  if (!existsSync(STORAGE_CONFIG_PATH)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(STORAGE_CONFIG_PATH, "utf-8")) as Partial<StorageConfig>;
  } catch {
    return {};
  }
}

export function getConfigDir(): string {
  return STORAGE_CONFIG_DIR;
}

export function getConfigPath(): string {
  return STORAGE_CONFIG_PATH;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  for (const env of DATABASE_ENV_NAMES) {
    if (readEnv(env.name)) return env;
  }
  return null;
}

function getStorageEnvName(key: MementosStorageEnvKey): string {
  const canonical = MEMENTOS_STORAGE_ENV[key];
  const fallback = MEMENTOS_STORAGE_FALLBACK_ENV[key];
  return readEnv(canonical) || !readEnv(fallback) ? canonical : fallback;
}

export function getStorageDatabaseUrl(): string | null {
  const env = getStorageDatabaseEnv();
  return env ? readEnv(env.name) : null;
}

export function getStorageDatabaseEnvName(): string {
  return getStorageEnvName("databaseUrl");
}

/**
 * The server data backend selected by the environment: `postgresql` when
 * HASNA_MEMENTOS_DATABASE_URL is set, `sqlite` otherwise. Runs the fail-loud
 * ratchet first, so a retired storage-mode variable throws here rather than
 * being silently ignored. Delegated to the vendored storage kit so the key
 * spec and the ratchet cannot drift from the shared contract.
 */
export function getStorageBackend(env: NodeJS.ProcessEnv = process.env): ServerDataBackend {
  return resolveServerDataBackend("mementos", env).backend;
}

/** The database URL for the selected server backend, or `null` when sqlite. */
export function getStorageBackendDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return resolveDatabaseUrl("mementos", env);
}

export function getStorageConfig(): StorageConfig {
  assertNoLegacyStorageMode();
  const fileConfig = readConfigFile();

  const merged: StorageConfig = {
    ...DEFAULT_STORAGE_CONFIG,
    ...fileConfig,
    rds: {
      ...DEFAULT_STORAGE_CONFIG.rds,
      ...(fileConfig.rds ?? {}),
    },
    sync: {
      ...DEFAULT_STORAGE_CONFIG.sync,
      ...(fileConfig.sync ?? {}),
    },
  };

  return merged;
}

const SECRET_QUERY_PARAMS = new Set([
  "password",
  "pass",
  "pwd",
  "token",
  "secret",
  "api_key",
  "apikey",
]);

function isSecretQueryParam(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return (
    SECRET_QUERY_PARAMS.has(normalized) ||
    /(?:secret|token|password|passphrase|credential|api[_-]?key|apikey|private[_-]?key|auth|session)/i.test(normalized)
  );
}

export function redactDatabaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = "***";
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSecretQueryParam(key)) {
        url.searchParams.set(key, "***");
      }
    }
    return url.toString();
  } catch {
    return value
      .replace(/:[^:@/\s]+@/, ":***@")
      .replace(
        /([?&\s][^=&\s]*(?:secret|token|password|passphrase|credential|api[_-]?key|apikey|private[_-]?key|auth|session)[^=&\s]*=)[^&\s]+/gi,
        "$1***"
      );
  }
}

export interface PostgresConnectionStringValidation {
  ok: boolean;
  redacted_url: string | null;
  issues: string[];
}

export function validatePostgresConnectionString(
  value: string | null
): PostgresConnectionStringValidation {
  const redactedUrl = redactDatabaseUrl(value);
  if (!value) {
    return {
      ok: false,
      redacted_url: redactedUrl,
      issues: ["Missing PostgreSQL/RDS connection string."],
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      redacted_url: redactedUrl,
      issues: ["PostgreSQL/RDS connection string must be a valid postgres:// or postgresql:// URL."],
    };
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return {
      ok: false,
      redacted_url: redactedUrl,
      issues: ["PostgreSQL/RDS connection string must use postgres:// or postgresql://."],
    };
  }

  if (!url.hostname) {
    return {
      ok: false,
      redacted_url: redactedUrl,
      issues: ["PostgreSQL/RDS connection string must include a host."],
    };
  }

  return {
    ok: true,
    redacted_url: redactedUrl,
    issues: [],
  };
}

function storageEnvStatus(key: MementosStorageEnvKey): StorageEnvStatus {
  const activeName = getStorageEnvName(key);
  return {
    name: MEMENTOS_STORAGE_ENV[key],
    active_name: activeName,
    configured: readEnv(activeName) !== null,
  };
}

interface PostgresBackendStatus {
  configured: boolean;
  source: "env" | "config-file" | "none";
  env_name: string | null;
  redacted_url: string | null;
  missing: string[];
  issues: string[];
  rds_compatible: boolean;
}

function postgresBackendStatus(config: StorageConfig): PostgresBackendStatus {
  const env = getStorageDatabaseEnv();
  const envUrl = env ? readEnv(env.name) : null;
  if (env && envUrl) {
    const validation = validatePostgresConnectionString(envUrl);
    return {
      configured: validation.ok,
      source: "env",
      env_name: env.name,
      redacted_url: validation.redacted_url,
      missing: [],
      issues: validation.issues,
      rds_compatible: validation.ok,
    };
  }

  const missing: string[] = [];
  if (!config.rds.host) {
    missing.push("storage.rds.host");
  }
  if (!config.rds.username) {
    missing.push("storage.rds.username");
  }
  if (!readEnv(config.rds.password_env)) {
    missing.push(config.rds.password_env);
  }

  const configured = missing.length === 0;
  const redactedUrl = configured
    ? `postgres://${config.rds.username}:***@${config.rds.host}:${config.rds.port}/mementos${config.rds.ssl ? "?sslmode=require" : ""}`
    : null;
  const issues = missing.length === 0
    ? []
    : [`Missing ${missing.join(", ")}.`];

  return {
    configured,
    source: config.rds.host || config.rds.username ? "config-file" : "none",
    env_name: null,
    redacted_url: redactedUrl,
    missing,
    issues,
    rds_compatible: configured,
  };
}

export function getSafeStorageConfigSummary(
  config: StorageConfig = getStorageConfig()
): SafeStorageConfigSummary {
  return {
    auto_sync_interval_minutes: config.auto_sync_interval_minutes,
    feedback_endpoint_configured: config.feedback_endpoint.trim() !== "",
    sync: { ...config.sync },
    rds: {
      host_configured: config.rds.host.trim() !== "",
      port: config.rds.port,
      username_configured: config.rds.username.trim() !== "",
      password_env: config.rds.password_env,
      password_configured: readEnv(config.rds.password_env) !== null,
      ssl: config.rds.ssl,
    },
  };
}

export function getStorageStatus(): NativeStorageStatus {
  assertNoLegacyStorageMode();
  const config = getStorageConfig();
  const backend = getStorageBackend();
  const postgresRequested = backend === "postgresql";
  const postgres = postgresBackendStatus(config);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (postgresRequested && !postgres.configured) {
    issues.push(
      `PostgreSQL is selected (HASNA_MEMENTOS_DATABASE_URL) but not configured. ${postgres.issues.join(" ")}`
    );
  }
  if (!postgresRequested && postgres.issues.length > 0 && postgres.source !== "none") {
    warnings.push(
      `PostgreSQL configuration is present but invalid; the postgresql backend stays disabled until fixed. ${postgres.issues.join(" ")}`
    );
  }
  if (!postgresRequested && postgres.configured) {
    warnings.push(
      "PostgreSQL configuration is present, but the selected backend is sqlite; the postgresql backend stays disabled until HASNA_MEMENTOS_DATABASE_URL is set."
    );
  }

  const failClosed = postgresRequested && !postgres.configured;
  const runtime: StorageRuntimeContract = {
    contract: "mementos-storage-runtime-v1",
    kind: backend,
    fail_closed: failClosed,
    local: {
      adapter: "sqlite",
      primary_runtime: backend === "sqlite",
      data_dir: LOCAL_DATA_DIR,
      config_path: STORAGE_CONFIG_PATH,
      local_file_sync: {
        supported: false,
        reason: "Mementos stores local state in SQLite; it does not sync raw local data files.",
      },
    },
    backend: {
      adapter: "postgres",
      requested: postgresRequested,
      configured: postgres.configured,
      source: postgres.source,
      env_name: postgres.env_name,
      redacted_url: postgres.redacted_url,
      rds_compatible: postgres.rds_compatible,
      fail_closed: failClosed,
      missing: postgres.missing,
    },
    migrations: {
      target: "postgres-rds-compatible",
      command: "mementos storage migrate",
      dry_run_command: "mementos storage migrate --dry-run",
      configured: postgres.configured,
      mutates_remote_on_apply: true,
      requires_approval_for_live_run: true,
    },
  };

  return {
    ok: issues.length === 0,
    service: "mementos",
    backend,
    local_default: backend === "sqlite",
    runtime,
    database: {
      configured: postgres.configured,
      redacted_url: postgres.redacted_url,
      source: postgres.source,
      env_name: postgres.env_name,
      rds_compatible: postgres.rds_compatible,
    },
    tables: MEMENTOS_STORAGE_TABLES,
    env: {
      databaseUrl: storageEnvStatus("databaseUrl"),
    },
    issues,
    warnings,
    no_network: true,
  };
}

export const getMementosStorageStatus = getStorageStatus;

export function saveStorageConfig(config: StorageConfig): void {
  mkdirSync(STORAGE_CONFIG_DIR, { recursive: true });
  writeFileSync(STORAGE_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function getConfiguredConnectionString(): string | undefined {
  return getStorageDatabaseUrl() ?? undefined;
}

/**
 * Resolve the configured remote storage DSN (env `HASNA_MEMENTOS_DATABASE_URL`
 * first, then `~/.hasna/mementos/storage/config.json`) with full validation,
 * WITHOUT the client-context guard. Callers decide whether the guard applies:
 * {@link getStorageConnectionString} applies it to every client data path;
 * {@link getStorageConnectionStringForOperator} is the explicitly-invoked
 * operator escape used ONLY by the migrate commands (see its doc comment).
 */
function resolveConfiguredConnectionString(dbName: string): string {
  const envConnectionString = getConfiguredConnectionString();
  if (envConnectionString) {
    const validation = validatePostgresConnectionString(envConnectionString);
    if (!validation.ok) {
      throw new Error(
        `Remote storage database is not configured. ${validation.issues.join(" ")}`
      );
    }
    return envConnectionString;
  }

  const config = getStorageConfig();
  const { host, port, username, password_env, ssl } = config.rds;
  const missing = [];
  if (!host) {
    missing.push("storage.rds.host");
  }
  if (!username) {
    missing.push("storage.rds.username");
  }
  if (missing.length > 0) {
    throw new Error(
      `Remote storage database is not configured. Missing ${missing.join(", ")}. Set HASNA_MEMENTOS_DATABASE_URL or configure ${STORAGE_CONFIG_PATH}.`
    );
  }

  const password = process.env[password_env];
  if (!password) {
    throw new Error(`Remote storage database password is not set. Export ${password_env}.`);
  }

  const sslParam = ssl ? "?sslmode=require" : "";
  return `postgres://${username}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}

export function getStorageConnectionString(dbName = "mementos"): string {
  assertNoLegacyStorageMode();
  // Fail closed on clients: the raw RDS DSN is server-only (CLAUDE.md §2). A
  // client machine must use the HTTP API, never a Postgres DSN.
  if (!isServerContext()) {
    throw new Error(
      "Refusing to construct an RDS Postgres DSN outside the mementos-serve server. " +
        "The raw database DSN is NEVER distributed to client machines. " +
        "Clients must use the HTTP API: set HASNA_MEMENTOS_API_URL and " +
        "HASNA_MEMENTOS_API_KEY (and unset HASNA_MEMENTOS_DATABASE_URL)."
    );
  }
  return resolveConfiguredConnectionString(dbName);
}

/**
 * Operator-only DSN resolution for the migrate commands.
 *
 * `storage migrate` / `migrate-pg` are deliberately-invoked operator commands
 * (docs/CUTOVER-RUNBOOK.md §3): they run from an approved, database-reachable
 * administrative environment — on this fleet, the ECS one-shot migrate task
 * that holds the DSN via Secrets Manager as HASNA_MEMENTOS_DATABASE_URL, the
 * same credential the serve task uses. The explicit `--connection-string` form
 * was already sanctioned; this resolves the SAME configured DSN for the
 * operator verb without forcing the value onto the command line.
 *
 * This is NOT the client data path. Every read/write surface (getDatabase,
 * getCloudDatabase, storage-sync, MCP data tools) keeps the fail-closed guard
 * in {@link getStorageConnectionString}. Only the migrate operator surfaces
 * call this, and only they may: a DSN must already be present on the machine
 * for the env/config form to resolve, so this adds no exfiltration surface.
 */
export function getStorageConnectionStringForOperator(dbName = "mementos"): string {
  assertNoLegacyStorageMode();
  return resolveConfiguredConnectionString(dbName);
}

export const SYNC_EXCLUDED_TABLE_PATTERNS = [
  /^sqlite_/,
  /_fts$/,
  /_fts_/,
  /^_sync_/,
  /^_pg_migrations$/,
];

export function isSyncExcludedTable(table: string): boolean {
  return SYNC_EXCLUDED_TABLE_PATTERNS.some((pattern) => pattern.test(table));
}

export function listSqliteTables(db: DbAdapter): string[] {
  const rows = db.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ) as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

export interface IncrementalSyncStats {
  table: string;
  total_rows: number;
  synced_rows: number;
  skipped_rows: number;
  errors: string[];
  first_sync: boolean;
}

export interface SyncMeta {
  table_name: string;
  last_synced_at: string;
  last_synced_row_count: number;
  direction: "push" | "pull";
}

export interface IncrementalSyncOptions {
  primaryKey?: string;
  conflictColumn?: string;
  batchSize?: number;
}

const SYNC_META_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _sync_meta (
  table_name TEXT PRIMARY KEY,
  last_synced_at TEXT,
  last_synced_row_count INTEGER DEFAULT 0,
  direction TEXT DEFAULT 'push'
)`;

export function ensureSyncMetaTable(db: DbAdapter): void {
  db.exec(SYNC_META_TABLE_SQL);
}

function getSyncMeta(db: DbAdapter, table: string): SyncMeta | null {
  ensureSyncMetaTable(db);
  return db.get(
    "SELECT table_name, last_synced_at, last_synced_row_count, direction FROM _sync_meta WHERE table_name = ?",
    table
  ) as SyncMeta | null;
}

function upsertSyncMeta(db: DbAdapter, meta: SyncMeta): void {
  ensureSyncMetaTable(db);
  const existing = db.get("SELECT table_name FROM _sync_meta WHERE table_name = ?", meta.table_name);
  if (existing) {
    db.run(
      "UPDATE _sync_meta SET last_synced_at = ?, last_synced_row_count = ?, direction = ? WHERE table_name = ?",
      meta.last_synced_at,
      meta.last_synced_row_count,
      meta.direction,
      meta.table_name
    );
    return;
  }

  db.run(
    "INSERT INTO _sync_meta (table_name, last_synced_at, last_synced_row_count, direction) VALUES (?, ?, ?, ?)",
    meta.table_name,
    meta.last_synced_at,
    meta.last_synced_row_count,
    meta.direction
  );
}

function transferRows(
  target: DbAdapter,
  table: string,
  rows: Array<Record<string, any>>,
  options: IncrementalSyncOptions
): { written: number; skipped: number; errors: string[]; maxSyncedAt: string | null } {
  const primaryKey = options.primaryKey ?? "id";
  const conflictColumn = options.conflictColumn ?? "updated_at";
  let written = 0;
  let skipped = 0;
  let maxSyncedAt: string | null = null;
  const errors: string[] = [];

  // Tracks the newest conflictColumn value over rows this call actually
  // processed (written or skipped because the target already holds a newer
  // version). Errored rows are excluded so the caller's cursor never advances
  // past a row that still needs retrying. String comparison mirrors the
  // `WHERE "${conflictColumn}" > ?` selection, so the returned value is the
  // exact high-water mark of the result set.
  const bumpMaxSyncedAt = (row: Record<string, any>): void => {
    const value = row[conflictColumn];
    if (typeof value === "string" && (maxSyncedAt === null || value > maxSyncedAt)) {
      maxSyncedAt = value;
    }
  };

  if (rows.length === 0) {
    return { written, skipped, errors, maxSyncedAt };
  }

  const columns = Object.keys(rows[0] ?? {});
  if (!columns.includes(primaryKey)) {
    return {
      written,
      skipped,
      errors: [`Table "${table}" has no "${primaryKey}" column; skipping`],
      maxSyncedAt,
    };
  }

  const hasConflictColumn = columns.includes(conflictColumn);

  for (const row of rows) {
    try {
      const existing = target.get(
        `SELECT "${primaryKey}"${hasConflictColumn ? `, "${conflictColumn}"` : ""} FROM "${table}" WHERE "${primaryKey}" = ?`,
        row[primaryKey]
      ) as Record<string, any> | null;

      if (existing) {
        if (hasConflictColumn && existing[conflictColumn] && row[conflictColumn]) {
          const existingTime = Date.parse(String(existing[conflictColumn]));
          const incomingTime = Date.parse(String(row[conflictColumn]));
          if (Number.isFinite(existingTime) && Number.isFinite(incomingTime) && existingTime >= incomingTime) {
            skipped++;
            bumpMaxSyncedAt(row);
            continue;
          }
        }

        const updateColumns = columns.filter((column) => column !== primaryKey);
        const setClauses = updateColumns.map((column) => `"${column}" = ?`).join(", ");
        target.run(
          `UPDATE "${table}" SET ${setClauses} WHERE "${primaryKey}" = ?`,
          ...updateColumns.map((column) => row[column]),
          row[primaryKey]
        );
      } else {
        const placeholders = columns.map(() => "?").join(", ");
        const columnList = columns.map((column) => `"${column}"`).join(", ");
        target.run(
          `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`,
          ...columns.map((column) => row[column])
        );
      }
      written++;
      bumpMaxSyncedAt(row);
    } catch (error) {
      errors.push(`Row ${String(row[primaryKey] ?? "unknown")}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { written, skipped, errors, maxSyncedAt };
}

export function incrementalSyncPush(
  local: DbAdapter,
  remote: DbAdapter,
  tables: string[],
  options: IncrementalSyncOptions = {}
): IncrementalSyncStats[] {
  return runIncrementalSync("push", local, remote, local, tables, options);
}

export function incrementalSyncPull(
  remote: DbAdapter,
  local: DbAdapter,
  tables: string[],
  options: IncrementalSyncOptions = {}
): IncrementalSyncStats[] {
  return runIncrementalSync("pull", remote, local, local, tables, options);
}

function runIncrementalSync(
  direction: "push" | "pull",
  source: DbAdapter,
  target: DbAdapter,
  metaDb: DbAdapter,
  tables: string[],
  options: IncrementalSyncOptions
): IncrementalSyncStats[] {
  const conflictColumn = options.conflictColumn ?? "updated_at";
  const batchSize = options.batchSize ?? 500;
  const results: IncrementalSyncStats[] = [];

  ensureSyncMetaTable(metaDb);

  for (const table of tables) {
    const stat: IncrementalSyncStats = {
      table,
      total_rows: 0,
      synced_rows: 0,
      skipped_rows: 0,
      errors: [],
      first_sync: false,
    };

    try {
      const countResult = source.get(`SELECT COUNT(*) as cnt FROM "${table}"`) as { cnt?: number } | null;
      stat.total_rows = countResult?.cnt ?? 0;

      const meta = getSyncMeta(metaDb, table);
      let rows: Array<Record<string, any>>;
      if (meta?.last_synced_at) {
        try {
          rows = source.all(
            `SELECT * FROM "${table}" WHERE "${conflictColumn}" > ?`,
            meta.last_synced_at
          ) as Array<Record<string, any>>;
        } catch {
          rows = source.all(`SELECT * FROM "${table}"`) as Array<Record<string, any>>;
          stat.first_sync = true;
        }
      } else {
        rows = source.all(`SELECT * FROM "${table}"`) as Array<Record<string, any>>;
        stat.first_sync = true;
      }

      let maxSyncedAt: string | null = null;

      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const result = transferRows(target, table, batch, options);
        stat.synced_rows += result.written;
        stat.skipped_rows += result.skipped;
        stat.errors.push(...result.errors);
        if (result.maxSyncedAt !== null && (maxSyncedAt === null || result.maxSyncedAt > maxSyncedAt)) {
          maxSyncedAt = result.maxSyncedAt;
        }
      }

      if (rows.length === 0) {
        stat.skipped_rows = stat.total_rows;
      }

      // The cursor is the high-water mark of what THIS run actually processed
      // (max updated_at over rows written or skipped) — never the wall clock,
      // which silently dropped any source row mutated between the SELECT above
      // and the cursor write (its updated_at landed inside (old, now] and the
      // strict `>` excluded it forever). When a row errored, the cursor stays
      // in place so the errored row remains eligible for retry, and an empty
      // selection never advances the cursor (converges, no busy-loop).
      const nextCursor = maxSyncedAt ?? meta?.last_synced_at ?? null;
      if (rows.length > 0 && stat.errors.length === 0 && nextCursor !== null) {
        upsertSyncMeta(metaDb, {
          table_name: table,
          last_synced_at: nextCursor,
          last_synced_row_count: stat.synced_rows,
          direction,
        });
      }
    } catch (error) {
      stat.errors.push(`Table "${table}": ${error instanceof Error ? error.message : String(error)}`);
    }

    results.push(stat);
  }

  return results;
}

export function getSyncMetaAll(db: DbAdapter): SyncMeta[] {
  ensureSyncMetaTable(db);
  return db.all(
    "SELECT table_name, last_synced_at, last_synced_row_count, direction FROM _sync_meta ORDER BY table_name"
  ) as SyncMeta[];
}

export function getSyncMetaForTable(db: DbAdapter, table: string): SyncMeta | null {
  return getSyncMeta(db, table);
}

export function resetSyncMeta(db: DbAdapter, table: string): void {
  ensureSyncMetaTable(db);
  db.run("DELETE FROM _sync_meta WHERE table_name = ?", table);
}

export function resetAllSyncMeta(db: DbAdapter): void {
  ensureSyncMetaTable(db);
  db.run("DELETE FROM _sync_meta");
}
