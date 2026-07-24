import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMigrations, backfillTaskTags } from "./schema.js";
import { backfillMachineId } from "./machines.js";
import { assertTodosLocalStorageRole, type TodosStorageEnv } from "../storage/config.js";

export const LOCK_EXPIRY_MINUTES = 30;

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestProjectDb(startDir: string): string | null {
  const gitRoot = findGitRoot(startDir);
  const stopAt = gitRoot ? resolve(gitRoot) : resolve(startDir);
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".hasna", "todos", "todos.db");
    if (existsSync(candidate)) return candidate;
    if (dir === stopAt) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function getDbPath(): string {
  // 1. Environment variable override (new env var takes precedence)
  if (process.env["HASNA_TODOS_DB_PATH"]) {
    return process.env["HASNA_TODOS_DB_PATH"];
  }
  if (process.env["TODOS_DB_PATH"]) {
    return process.env["TODOS_DB_PATH"];
  }

  // 2. Per-project: .hasna/todos/todos.db in cwd or any parent (incl. repo root)
  const cwd = process.cwd();
  const nearest = findNearestProjectDb(cwd);
  if (nearest) return nearest;

  // 3. Explicit project scope (force repo root)
  if (process.env["TODOS_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return join(gitRoot, ".hasna", "todos", "todos.db");
    }
  }

  // 4. Default: ~/.hasna/todos/todos.db
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  return join(home, ".hasna", "todos", "todos.db");
}

export function getDatabasePath(): string {
  return getDbPath();
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let _db: Database | null = null;
let _dbPath: string | null = null;
let _dbMachineIdBackfilled = false;

interface DatabaseOpenOptions {
  backfillMachineId?: boolean;
}

const constructorOwnedDatabases = new WeakSet<Database>();

export class TodosSqliteProvenanceError extends Error {
  readonly code = "UNTRUSTED_SQLITE_PROVENANCE";

  constructor() {
    super("UNTRUSTED_SQLITE_PROVENANCE: SQLite handles must be constructed by the Todos database owner");
    this.name = "TodosSqliteProvenanceError";
  }
}

/**
 * Database provenance is issued only by this module at construction time.
 * WeakSet membership cannot be copied onto a proxy or database-shaped object,
 * and callers cannot add entries after construction.
 */
export function isConstructorOwnedSqliteDatabase(value: unknown): value is Database {
  return typeof value === "object" && value !== null && constructorOwnedDatabases.has(value as Database);
}

export function assertConstructorOwnedSqliteDatabase(value: unknown): asserts value is Database {
  if (!isConstructorOwnedSqliteDatabase(value)) throw new TodosSqliteProvenanceError();
}

function isBunSqliteDatabase(value: unknown): value is Database {
  if (typeof value !== "object" || value === null) return false;
  try {
    return value instanceof Database;
  } catch {
    throw new TodosSqliteProvenanceError();
  }
}

/**
 * Reject raw Bun Database capabilities at a generated package boundary before
 * dispatching to CRUD, snapshot, import/export, report, search, or plan code.
 * A single descriptor-only options level covers the public `{ db }` and
 * `{ database }` forms without invoking caller accessors.
 */
export function assertPublicSqliteBoundaryArguments(args: readonly unknown[]): void {
  for (const value of args) {
    if (isBunSqliteDatabase(value)) {
      assertConstructorOwnedSqliteDatabase(value);
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    for (const key of ["db", "database"] as const) {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      } catch {
        throw new TodosSqliteProvenanceError();
      }
      if (!descriptor) continue;
      if (!("value" in descriptor) || descriptor.get || descriptor.set) {
        throw new TodosSqliteProvenanceError();
      }
      if (isBunSqliteDatabase(descriptor.value)) {
        assertConstructorOwnedSqliteDatabase(descriptor.value);
      }
    }
  }
}

function openDatabase(path: string, options: DatabaseOpenOptions = {}): Database {
  ensureDir(path);

  const db = new Database(path);
  try {
    // Enable WAL mode for concurrent access
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA foreign_keys = ON");

    // Run migrations
    runMigrations(db);
    backfillTaskTags(db);
    if (options.backfillMachineId !== false) backfillMachineId(db);

    // Durable dual-write shadow (sanctioned Amendment A1 exception): when
    // HASNA_TODOS_SHADOW=1, install capture triggers so EVERY local write path
    // (CLI, MCP, serve, raw src/db SQL) enqueues a durable mirror op. This is the
    // single chokepoint that makes the shadow real without refactoring every
    // direct-SQL call site onto the storage adapter. Pure SQLite; no network here.
    maybeInstallShadowCapture(db);

    constructorOwnedDatabases.add(db);
    return db;
  } catch (error) {
    try { db.close(); } catch { /* construction already failed */ }
    throw error;
  }
}

/** Internal/test constructor that preserves the same immutable provenance path. */
export function openLocalSqliteDatabase(
  path: string,
  environment: TodosStorageEnv = process.env,
  options: DatabaseOpenOptions = {},
): Database {
  assertTodosLocalStorageRole(process.env);
  if (environment !== process.env) assertTodosLocalStorageRole(environment);
  return openDatabase(path, options);
}

/**
 * Open an existing SQLite store read-only while retaining constructor
 * provenance. This is intentionally separate from openDatabase(): source
 * discovery must never migrate or otherwise rewrite another Todos store.
 */
export function openReadonlyLocalSqliteDatabase(
  path: string,
  environment: TodosStorageEnv = process.env,
): Database {
  assertTodosLocalStorageRole(process.env);
  if (environment !== process.env) assertTodosLocalStorageRole(environment);

  const db = new Database(path, { readonly: true, create: false });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA foreign_keys = ON");
    constructorOwnedDatabases.add(db);
    return db;
  } catch (error) {
    try { db.close(); } catch { /* construction already failed */ }
    throw error;
  }
}

function maybeInstallShadowCapture(db: Database): void {
  try {
    // Lazy require keeps the hot path free of the storage-adapter import chain.
    const { isTodosShadowEnabled } = require("../storage/config.js") as typeof import("../storage/config.js");
    if (!isTodosShadowEnabled()) return;
    const { installShadowOutboxSchema } = require("../storage/shadow-outbox-schema.js") as typeof import("../storage/shadow-outbox-schema.js");
    installShadowOutboxSchema(db);
  } catch (error) {
    // Capture must never break normal DB open; log and continue local-only.
    console.error(
      `[todos] shadow capture install failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getDatabase(
  dbPath?: string | Database,
  environment: TodosStorageEnv = process.env,
  options: DatabaseOpenOptions = {},
): Database {
  // Stage A: a hosted, ambiguous, or invalid process role must never fall
  // through to SQLite, including when a handle was opened before an env flip.
  assertTodosLocalStorageRole(process.env);
  if (environment !== process.env) assertTodosLocalStorageRole(environment);
  if (typeof dbPath === "object" && dbPath !== null) {
    assertConstructorOwnedSqliteDatabase(dbPath);
    return dbPath;
  }
  const path = dbPath || getDbPath();
  if (_db && _dbPath === path) {
    if (options.backfillMachineId !== false && !_dbMachineIdBackfilled) {
      backfillMachineId(_db);
      _dbMachineIdBackfilled = true;
    }
    return _db;
  }

  // M11: The resolved path changed (e.g. the process cwd moved to a different
  // project). Do NOT close the previous handle here — other code may still hold
  // a reference to it, and closing it out from under them surfaces "database is
  // closed" errors mid-operation. Open the new handle and repoint the
  // singleton; the previous handle is released via resetDatabase()/
  // closeDatabase() or on process exit.
  _db = openDatabase(path, options);
  _dbPath = path;
  _dbMachineIdBackfilled = options.backfillMachineId !== false;
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
    _dbPath = null;
    _dbMachineIdBackfilled = false;
  }
}

export function resetDatabase(): void {
  // M11: close the live handle on reset instead of leaking it. Guarded because
  // callers sometimes close the handle explicitly before calling resetDatabase.
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
  }
  _db = null;
  _dbPath = null;
  _dbMachineIdBackfilled = false;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function isLockExpired(lockedAt: string | null, nowMs = Date.now()): boolean {
  if (!lockedAt) return true;
  const lockTime = new Date(lockedAt).getTime();
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return nowMs - lockTime > expiryMs;
}

export function lockExpiryCutoff(nowMs = Date.now()): string {
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return new Date(nowMs - expiryMs).toISOString();
}

export function clearExpiredLocks(db: Database): void {
  const cutoff = lockExpiryCutoff();
  db.run("UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE locked_at IS NOT NULL AND locked_at < ?", [cutoff]);
}

const ALLOWED_TABLES = new Set(["tasks", "projects", "agents", "plans", "task_lists", "task_templates", "project_knowledge_records", "project_risks", "local_retrospectives"]);

function slugifyRef(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function resolvePartialId(db: Database, table: string, partialId: string): string | null {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  if (partialId.length >= 36) {
    // Full UUID
    const row = db.query(`SELECT id FROM ${table} WHERE id = ?`).get(partialId) as { id: string } | null;
    return row?.id ?? null;
  }

  // Partial match (prefix) on id column
  const rows = db.query(`SELECT id FROM ${table} WHERE id LIKE ?`).all(`${partialId}%`) as { id: string }[];
  if (rows.length === 1) {
    return rows[0]!.id;
  }
  if (rows.length > 1) {
    // Ambiguous - return null
    return null;
  }

  // For tasks table, also try matching on short_id (e.g. "OPE-00006")
  if (table === "tasks") {
    const shortIdRows = db.query("SELECT id FROM tasks WHERE short_id = ?").all(partialId) as { id: string }[];
    if (shortIdRows.length === 1) {
      return shortIdRows[0]!.id;
    }
  }

  // For task_lists table, also try matching on slug (e.g. "todos-open-mementos")
  if (table === "task_lists") {
    const slugRow = db.query("SELECT id FROM task_lists WHERE slug = ?").get(partialId) as { id: string } | null;
    if (slugRow) return slugRow.id;
  }

  // For plans table, also try matching on readable slug. Ambiguous slugs return
  // null so callers can fail loudly or retry with project scope.
  if (table === "plans") {
    const slug = slugifyRef(partialId);
    if (slug) {
      const slugRows = db.query("SELECT id FROM plans WHERE slug = ?").all(slug) as { id: string }[];
      if (slugRows.length === 1) return slugRows[0]!.id;
      if (slugRows.length > 1) return null;
    }
  }

  // For projects table, also try matching on name (case-insensitive)
  if (table === "projects") {
    const nameRow = db.query("SELECT id FROM projects WHERE lower(name) = ?").get(partialId.toLowerCase()) as { id: string } | null;
    if (nameRow) return nameRow.id;
  }

  // For agents table, also try matching on name (case-insensitive). Agent names
  // are UNIQUE, and MCP tools document assigned_to as "Agent ID or name" — without
  // this, a name resolves to null and the caller throws UNKNOWN_ERROR.
  if (table === "agents") {
    const nameRow = db.query("SELECT id FROM agents WHERE lower(name) = ?").get(partialId.toLowerCase()) as { id: string } | null;
    if (nameRow) return nameRow.id;
  }

  return null;
}
