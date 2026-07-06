import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveDatabaseUrl, resolveDbPath, resolveStorageMode, scrubDatabaseUrl, type StorageMode } from "../config.js";
import { ensureTreasuryAppHome } from "../core/app-home.js";
import { maybeBackupBeforeMigration } from "./backup.js";
import { runSqliteMigrations, POSTGRES_MIGRATIONS } from "./schema.js";

/**
 * A tiny dialect-agnostic async query surface shared by every service so the
 * SAME domain code runs over local SQLite and cloud Postgres. Services write
 * `?`-placeholder SQL; the Postgres client rewrites to `$n`.
 */
export interface QueryClient {
  readonly mode: StorageMode;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class SqliteClient implements QueryClient {
  readonly mode: StorageMode = "local";
  constructor(private readonly db: Database) {}

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.query(sql).all(...(params as never[])) as T[];
  }
  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (this.db.query(sql).get(...(params as never[])) as T) ?? null;
  }
  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.db.query(sql).run(...(params as never[]));
  }
  async transaction<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T> {
    this.db.run("BEGIN");
    try {
      const result = await fn(this);
      this.db.run("COMMIT");
      return result;
    } catch (error) {
      try {
        this.db.run("ROLLBACK");
      } catch {
        /* surface original */
      }
      throw error;
    }
  }
  async close(): Promise<void> {
    this.db.close();
  }
  raw(): Database {
    return this.db;
  }
}

function toPgSql(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Minimal shape of the vendored kit's PoolQueryClient we depend on.
interface KitExec {
  many<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
}
interface KitClient extends KitExec {
  transaction<T>(fn: (c: KitExec) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PostgresClient implements QueryClient {
  readonly mode: StorageMode = "cloud";
  constructor(
    private readonly client: KitExec,
    private readonly full?: KitClient,
  ) {}
  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.client.many(toPgSql(sql), params) as Promise<T[]>;
  }
  async get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return this.client.get(toPgSql(sql), params) as Promise<T | null>;
  }
  async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.client.execute(toPgSql(sql), params);
  }
  async transaction<T>(fn: (tx: QueryClient) => Promise<T>): Promise<T> {
    if (!this.full) throw new Error("Nested transaction is not supported.");
    return this.full.transaction((c) => fn(new PostgresClient(c)));
  }
  async close(): Promise<void> {
    await this.full?.close();
  }
}

let _client: QueryClient | null = null;

export interface OpenOptions {
  /** Explicit path/`:memory:` for local tests. */
  path?: string;
  /** Force a fresh client (ignore singleton). */
  fresh?: boolean;
  /**
   * Force a specific storage mode instead of resolving it from env. Used by the
   * storage push/pull/sync tools to open the OPPOSITE (counterpart) store so a
   * transfer truly crosses local<->cloud. Cloud still fails closed without a DSN.
   */
  mode?: StorageMode;
}

/**
 * Open the treasury store.
 *
 * - local: bun:sqlite at the resolved path (`:memory:` for tests) — authoritative.
 * - cloud: PURE REMOTE — a real pg pool built from the vendored storage-kit with
 *   `sslmode=verify-full`. It NEVER silently falls back to in-memory/SQLite; a
 *   missing DSN or connection failure is a hard fail-closed error.
 */
export async function openDatabase(opts: OpenOptions = {}): Promise<QueryClient> {
  if (_client && !opts.fresh && !opts.path && !opts.mode) return _client;

  const mode = opts.mode ?? resolveStorageMode();
  const client = opts.path !== undefined ? openLocal(opts.path) : mode === "cloud" ? await openCloud() : openLocal(resolveLocalPath());

  if (!opts.path && !opts.fresh && !opts.mode) _client = client;
  return client;
}

function resolveLocalPath(): string {
  ensureTreasuryAppHome();
  return resolveDbPath();
}

function openLocal(path: string): QueryClient {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    maybeBackupBeforeMigration(path);
  }
  const db = new Database(path);
  db.run("PRAGMA journal_mode = WAL;");
  db.run("PRAGMA busy_timeout = 5000;");
  db.run("PRAGMA foreign_keys = ON;");
  runSqliteMigrations(db);
  return new SqliteClient(db);
}

async function openCloud(): Promise<QueryClient> {
  const dsn = resolveDatabaseUrl();
  if (!dsn) {
    throw new Error(
      "cloud storage mode requires HASNA_TREASURY_DATABASE_URL (or *_FILE). " +
        "PURE REMOTE refuses to fall back to local/in-memory SQLite.",
    );
  }
  if (!/sslmode=verify-full/.test(dsn)) {
    throw new Error(
      "cloud DSN must use sslmode=verify-full (BUILD-SPEC §4.8); sslmode=require is forbidden.",
    );
  }
  // Vendored kit only — runtime never imports @hasna/contracts (no_cloud_guard).
  //
  // Build the pool from the ALREADY-RESOLVED (file-aware) DSN. We must NOT call
  // createCloudPoolFromEnv here: that helper re-resolves the DSN from env keys
  // ONLY (HASNA_TREASURY_DATABASE_URL / TREASURY_DATABASE_URL) and cannot see a
  // *_DATABASE_URL_FILE mount — exactly how docker-compose and production inject
  // the secret (BUILD-SPEC §2.4). Passing the resolved `dsn` straight through
  // keeps file-mounted DSNs working while preserving the kit's TLS handling.
  const { createPgPool } = (await import("../generated/storage-kit/pool.js")) as unknown as {
    createPgPool: (opts: {
      connectionString: string;
      env?: Record<string, string | undefined>;
      applicationName?: string;
      caCertPath?: string;
    }) => import("pg").Pool;
  };
  const { createQueryClient } = (await import("../generated/storage-kit/query.js")) as unknown as {
    createQueryClient: (pool: import("pg").Pool) => KitClient;
  };
  const pool = createPgPool({ connectionString: dsn, env: process.env, applicationName: "treasury" });
  const client = createQueryClient(pool);
  for (const sql of POSTGRES_MIGRATIONS) {
    await client.execute(sql);
  }
  scrubDatabaseUrl();
  return new PostgresClient(client, client);
}

export function closeDatabase(): void {
  if (_client) {
    void _client.close();
    _client = null;
  }
}

export function resetDatabaseSingleton(): void {
  _client = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}
