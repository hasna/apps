import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { randomUUID } from "crypto";
import * as schema from "./schema.js";

export * from "./schema.js";

let _migrated = false;

type SqliteValue = string | number | bigint | boolean | null | Uint8Array;

export interface FeedbackEntry {
  id: string;
  service: string;
  version: string;
  message: string;
  email: string;
  machine_id: string;
  created_at: string;
}

export interface FeedbackInput {
  message: string;
  email?: string;
  version?: string;
  service?: string;
  machineId?: string;
}

export class SqliteAdapter {
  readonly raw: Database;

  constructor(dbPath = getDbPath()) {
    if (dbPath !== ":memory:") {
      mkdirSync(resolve(dbPath, ".."), { recursive: true });
    }
    this.raw = new Database(dbPath);
    this.raw.run("PRAGMA journal_mode = WAL;");
    this.raw.run("PRAGMA foreign_keys = ON;");
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const result = this.raw.prepare(sql).run(...normalizeSqliteParams(params));
    return { changes: result.changes };
  }

  get(sql: string, ...params: unknown[]): unknown {
    return this.raw.prepare(sql).get(...normalizeSqliteParams(params));
  }

  all(sql: string, ...params: unknown[]): unknown[] {
    return this.raw.prepare(sql).all(...normalizeSqliteParams(params));
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    return this.raw.prepare(sql);
  }

  close(): void {
    this.raw.close();
  }
}

export function getDbPath(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  return resolve(home, ".hasna", "brains", "db.sqlite");
}

function ensureMigrated() {
  if (_migrated) return;
  migrateLegacyDotfile();
  _migrated = true;
}

export function getDb(dbPath?: string) {
  ensureMigrated();
  const adapter = new SqliteAdapter(dbPath ?? getDbPath());
  const sqlite = adapter.raw;
  const db = drizzle(sqlite, { schema });

  // Run migrations (idempotent — drizzle tracks applied migrations in __drizzle_migrations table)
  try {
    const migrationsFolder = resolve(import.meta.dir, "../../drizzle");
    migrate(db, { migrationsFolder });
  } catch {
    // Fall back to raw SQL for environments where migrations folder is unavailable
    ensureCoreTables(sqlite);
  }

  ensureFeedbackTable(adapter);

  return db;
}

/** Get a raw SqliteAdapter for direct SQL queries (e.g. feedback table). */
export function getRawDb(dbPath?: string): SqliteAdapter {
  ensureMigrated();
  const adapter = new SqliteAdapter(dbPath ?? getDbPath());
  ensureCoreTables(adapter.raw);
  ensureFeedbackTable(adapter);
  return adapter;
}

export function saveFeedback(input: FeedbackInput, dbPath?: string): { sent: false; entry: FeedbackEntry } {
  const rawDb = getRawDb(dbPath);
  try {
    const entry: FeedbackEntry = {
      id: randomUUID(),
      service: input.service ?? "brains",
      version: input.version ?? "",
      message: input.message,
      email: input.email ?? "",
      machine_id: input.machineId ?? process.env["HOSTNAME"] ?? "",
      created_at: new Date().toISOString(),
    };
    rawDb.run(
      `INSERT INTO feedback (id, service, version, message, email, machine_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.service,
      entry.version,
      entry.message,
      entry.email,
      entry.machine_id,
      entry.created_at,
    );
    return { sent: false, entry };
  } finally {
    rawDb.close();
  }
}

export function listFeedback(dbPath?: string): FeedbackEntry[] {
  const rawDb = getRawDb(dbPath);
  try {
    return rawDb.all(
      "SELECT id, service, version, message, email, machine_id, created_at FROM feedback ORDER BY created_at DESC"
    ) as FeedbackEntry[];
  } finally {
    rawDb.close();
  }
}

function ensureFeedbackTable(adapter: SqliteAdapter): void {
  adapter.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL DEFAULT 'brains',
      version TEXT DEFAULT '',
      message TEXT NOT NULL,
      email TEXT DEFAULT '',
      machine_id TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function ensureCoreTables(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fine_tuned_models (
      id TEXT PRIMARY KEY,
      base_model TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      fine_tune_job_id TEXT,
      display_name TEXT,
      description TEXT,
      collection TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_jobs (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES fine_tuned_models(id),
      provider TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      metrics TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS training_datasets (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      file_path TEXT NOT NULL,
      example_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      used_in_job_id TEXT REFERENCES training_jobs(id)
    );
  `);
}

function migrateLegacyDotfile(): void {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  const oldDir = resolve(home, ".brains");
  const newDir = resolve(home, ".hasna", "brains");
  if (!existsSync(oldDir) || existsSync(newDir)) return;

  mkdirSync(newDir, { recursive: true });
  for (const file of readdirSync(oldDir)) {
    const oldPath = resolve(oldDir, file);
    const newPath = resolve(newDir, file);
    try {
      if (statSync(oldPath).isFile()) copyFileSync(oldPath, newPath);
    } catch {
      // Ignore legacy files that cannot be copied.
    }
  }
}

function normalizeSqliteParams(params: unknown[]): SqliteValue[] {
  const flat = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
  return flat.map((value) => coerceSqliteValue(value));
}

function coerceSqliteValue(value: unknown): SqliteValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
