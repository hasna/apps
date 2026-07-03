import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMigrations, backfillTaskTags } from "./schema.js";
import { backfillMachineId } from "./machines.js";

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

function openDatabase(path: string): Database {
  ensureDir(path);

  const db = new Database(path);

  // Enable WAL mode for concurrent access
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  runMigrations(db);
  backfillTaskTags(db);
  backfillMachineId(db);

  return db;
}

export function getDatabase(dbPath?: string): Database {
  const path = dbPath || getDbPath();
  if (_db && _dbPath === path) return _db;

  // M11: The resolved path changed (e.g. the process cwd moved to a different
  // project). Do NOT close the previous handle here — other code may still hold
  // a reference to it, and closing it out from under them surfaces "database is
  // closed" errors mid-operation. Open the new handle and repoint the
  // singleton; the previous handle is released via resetDatabase()/
  // closeDatabase() or on process exit.
  _db = openDatabase(path);
  _dbPath = path;
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    try { _db.close(); } catch { /* already closed */ }
    _db = null;
    _dbPath = null;
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
