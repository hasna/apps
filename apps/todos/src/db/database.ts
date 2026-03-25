import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMigrations, backfillTaskTags } from "./schema.js";

export const LOCK_EXPIRY_MINUTES = 30;

function isInMemoryDb(path: string): boolean {
  return path === ":memory:" || path.startsWith("file::memory:");
}

function findNearestTodosDb(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".todos", "todos.db");
    if (existsSync(candidate)) return candidate;
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

  // 2. Per-project: .todos/todos.db in cwd or any parent (incl. repo root)
  const cwd = process.cwd();
  const nearest = findNearestTodosDb(cwd);
  if (nearest) return nearest;

  // 3. Explicit project scope (force repo root)
  if (process.env["TODOS_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot) {
      return join(gitRoot, ".todos", "todos.db");
    }
  }

  // 4. Default: ~/.hasna/todos/todos.db (with backward compat for ~/.todos/)
  const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";
  const newPath = join(home, ".hasna", "todos", "todos.db");
  const legacyPath = join(home, ".todos", "todos.db");

  // Use legacy DB if it exists and new one doesn't yet (backward compat)
  if (!existsSync(newPath) && existsSync(legacyPath)) {
    return legacyPath;
  }

  return newPath;
}

function ensureDir(filePath: string): void {
  if (isInMemoryDb(filePath)) return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let _db: Database | null = null;

export function getDatabase(dbPath?: string): Database {
  if (_db) return _db;

  const path = dbPath || getDbPath();
  ensureDir(path);

  _db = new Database(path);

  // Enable WAL mode for concurrent access
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");
  _db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  runMigrations(_db);
  backfillTaskTags(_db);

  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function resetDatabase(): void {
  _db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function isLockExpired(lockedAt: string | null): boolean {
  if (!lockedAt) return true;
  const lockTime = new Date(lockedAt).getTime();
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return Date.now() - lockTime > expiryMs;
}

export function lockExpiryCutoff(nowMs = Date.now()): string {
  const expiryMs = LOCK_EXPIRY_MINUTES * 60 * 1000;
  return new Date(nowMs - expiryMs).toISOString();
}

export function clearExpiredLocks(db: Database): void {
  const cutoff = lockExpiryCutoff();
  db.run("UPDATE tasks SET locked_by = NULL, locked_at = NULL WHERE locked_at IS NOT NULL AND locked_at < ?", [cutoff]);
}

export function resolvePartialId(db: Database, table: string, partialId: string): string | null {
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

  // For projects table, also try matching on name (case-insensitive)
  if (table === "projects") {
    const nameRow = db.query("SELECT id FROM projects WHERE lower(name) = ?").get(partialId.toLowerCase()) as { id: string } | null;
    if (nameRow) return nameRow.id;
  }

  return null;
}
