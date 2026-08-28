import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMigrations, backfillTaskTags } from "./schema.js";
import { backfillMachineId } from "./machines.js";
import { ensureAgentIdentitySchema } from "./identity-mapping.js";
import { IdentityAliasAmbiguousError, TaskReferenceAmbiguousError } from "../types/index.js";
import { getTodosGlobalDir } from "../lib/sync-utils.js";

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

function getGlobalDbPath(): string {
  return join(getTodosGlobalDir(), "todos.db");
}

function hasExplicitProjectArg(args: readonly string[] = process.argv.slice(2)): boolean {
  return args.some((arg) => arg === "--project" || arg.startsWith("--project="));
}

function getCliCommand(args: readonly string[] = process.argv.slice(2)): string | null {
  const globalOptionsWithValues = new Set(["--project", "--agent", "--session"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (globalOptionsWithValues.has(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return null;
}

function canCreateScopedProjectDb(args: readonly string[] = process.argv.slice(2)): boolean {
  return getCliCommand(args) === "project-bootstrap"
    && !args.some((arg) => arg === "--dry-run" || arg.startsWith("--dry-run="));
}

function getDbPath(): string {
  // 1. Environment variable override (new env var takes precedence)
  if (process.env["HASNA_TODOS_DB_PATH"]) {
    return process.env["HASNA_TODOS_DB_PATH"];
  }
  if (process.env["TODOS_DB_PATH"]) {
    return process.env["TODOS_DB_PATH"];
  }

  // 2. An explicit project selector is resolved against the global registry.
  // A cwd-scoped database must not silently replace that registry, especially
  // when a stray empty database exists at the repository root.
  if (hasExplicitProjectArg()) return getGlobalDbPath();

  // 3. Per-project: .hasna/todos/todos.db in cwd or any parent (incl. repo root)
  const cwd = process.cwd();
  const nearest = findNearestProjectDb(cwd);
  if (nearest) return nearest;

  // 4. Explicit project scope may create a new scoped store only through the
  // project initialization command. Reads and ordinary writes fall back to the
  // global store instead of materializing an accidental shadow database.
  if (process.env["TODOS_DB_SCOPE"] === "project") {
    const gitRoot = findGitRoot(cwd);
    if (gitRoot && canCreateScopedProjectDb()) {
      return join(gitRoot, ".hasna", "todos", "todos.db");
    }
  }

  // 5. Default: ~/.hasna/todos/todos.db
  return getGlobalDbPath();
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

  // busy_timeout MUST be set before any pragma that takes a lock. Switching the
  // journal mode acquires one, so with the timeout set afterwards the WAL pragma
  // had no timeout in effect and failed instantly with SQLITE_BUSY whenever
  // another connection held the database — the ordinary case of a `todos serve`
  // starting while a CLI process still has the same file open. Now it waits.
  db.run("PRAGMA busy_timeout = 5000");
  // Enable WAL mode for concurrent access
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // Run migrations
  runMigrations(db);
  ensureAgentIdentitySchema(db);
  backfillTaskTags(db);
  backfillMachineId(db);

  // Durable dual-write shadow (sanctioned Amendment A1 exception): when
  // HASNA_TODOS_SHADOW=1, install capture triggers so EVERY local write path
  // (CLI, MCP, serve, raw src/db SQL) enqueues a durable mirror op. This is the
  // single chokepoint that makes the shadow real without refactoring every
  // direct-SQL call site onto the storage adapter. Pure SQLite; no network here.
  maybeInstallShadowCapture(db);

  return db;
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
    const shortIdRows = db.query(
      "SELECT id, project_id FROM tasks WHERE LOWER(short_id) = LOWER(?) ORDER BY project_id, id",
    ).all(partialId) as Array<{ id: string; project_id: string | null }>;
    if (shortIdRows.length === 1) {
      return shortIdRows[0]!.id;
    }
    if (shortIdRows.length > 1) {
      throw new TaskReferenceAmbiguousError(
        partialId,
        shortIdRows.map((row) => ({ task_id: row.id, project_id: row.project_id })),
      );
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

  // Agent labels resolve only legacy local IDs. Historical aliases are additive;
  // candidate aliases remain quarantined, and collisions fail closed. This path
  // never infers or returns canonical identity_id authority.
  if (table === "agents") {
    const normalized = partialId.trim().toLowerCase();
    const matches = db.query(`
      SELECT id FROM agents WHERE lower(name) = ?
      UNION
      SELECT local_agent_id AS id FROM agent_identity_aliases
        WHERE normalized_label = ? AND status = 'active'
      ORDER BY id
    `).all(normalized, normalized) as Array<{ id: string }>;
    if (matches.length === 1) return matches[0]!.id;
    if (matches.length > 1) {
      throw new IdentityAliasAmbiguousError(partialId, matches.map((match) => match.id));
    }
  }

  return null;
}

/**
 * Resolve an `--assigned`/`assigned_to` filter/comparison value to every
 * stored form it could legitimately appear under: its registered agent's id,
 * its registered name, and the literal input.
 *
 * ROOT CAUSE this closes (todos task 8f07bc15, sibling sites tracked in
 * 84c77210): `add --agent <id>` and `update --assign <name>` both write
 * whatever string the caller passed, unresolved, into the same `assigned_to`
 * field — so one agent's tasks end up split across its id form and its name
 * form with no overlap. Every exact-match read/comparison against that field
 * therefore returns a silent subset unless it goes through this resolver (or
 * the equivalent Postgres-side `resolveAgentForAssignedFilter` in
 * storage/postgres-adapter.ts, for the hosted/cloud path).
 *
 * Canonical home: originally introduced as a private helper in
 * db/task-crud.ts for PR #160 (`listTasks`/`countTasks`); moved here so every
 * other exact-match `assigned_to` call site in this package can reuse the
 * SAME resolution logic instead of re-deriving it. `task-crud.ts` re-exports
 * it for backward compatibility with existing imports.
 *
 * An ambiguous name (2+ independently-registered agent rows share it
 * case-insensitively, e.g. `fabricius` + `Fabricius`, task 0bf5d979) degrades
 * to literal-only matching — same as no match — rather than crashing or
 * silently picking one of the ambiguous rows. This must stay behaviourally
 * identical to the Postgres adapter's `resolveAgentForAssignedFilter`, which
 * resolves the same ambiguity to `null` for the same reason.
 *
 * Deliberately NOT covered: two independently registered agent rows for what
 * a human considers one seat (e.g. a personal name and a seat slug registered
 * as separate rows with no linking field). Bridging that needs an
 * identity-model decision, not a widened query filter (todos task a37a7137).
 */
export function resolveAssignedToAliases(db: Database, ref: string): string[] {
  const aliases = new Set<string>([ref]);
  let agentId: string | null;
  try {
    agentId = resolvePartialId(db, "agents", ref);
  } catch (err) {
    if (!(err instanceof IdentityAliasAmbiguousError)) throw err;
    agentId = null;
  }
  if (agentId) {
    aliases.add(agentId);
    const row = db.query("SELECT name FROM agents WHERE id = ?").get(agentId) as { name: string } | null;
    if (row?.name) aliases.add(row.name);
  }
  return [...aliases];
}

/**
 * `resolveAssignedToAliases`, as a lowercased Set for in-memory (JS-level)
 * comparisons against an already-fetched `Task.assigned_to` value, e.g.
 * `aliasSet.has((task.assigned_to ?? "").toLowerCase())`. Use this instead of
 * a bare `task.assigned_to === ref` wherever the comparison is against a
 * value that might be an agent id in one row and a resolved name in another —
 * exactly the case a raw `IN (...)` SQL clause covers for query-time filters.
 */
export function assignedToAliasSet(db: Database, ref: string): Set<string> {
  return new Set(resolveAssignedToAliases(db, ref).map((a) => a.toLowerCase()));
}

/** Build a case-insensitive `column IN (...)` clause matching any of `values`. */
export function lowerInClause(column: string, values: readonly string[], params: unknown[]): string {
  if (values.length === 0) return "1=0";
  params.push(...values.map((v) => v.toLowerCase()));
  return `LOWER(${column}) IN (${values.map(() => "?").join(",")})`;
}
