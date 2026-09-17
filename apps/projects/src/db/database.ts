import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runMigrations } from "./schema.js";
import { getProjectsHome } from "../lib/project-store-paths.js";

export const PROJECTS_DB_PATH_ENV = "HASNA_PROJECTS_DB_PATH";
export const LEGACY_WORKSPACES_DB_PATH_ENV = "HASNA_WORKSPACES_DB_PATH";

export function getDbPath(): string {
  if (process.env[PROJECTS_DB_PATH_ENV]) {
    return process.env[PROJECTS_DB_PATH_ENV];
  }
  if (process.env[LEGACY_WORKSPACES_DB_PATH_ENV]) {
    return process.env[LEGACY_WORKSPACES_DB_PATH_ENV];
  }
  return join(getProjectsHome(), "projects.db");
}

function ensureDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

let _db: Database | null = null;
let _dbPath: string | null = null;

/**
 * A process-wide refusal of the on-box SQLite store, installed by
 * `resolveProjectStore()` the moment the AMBIENT environment resolves a HOSTED
 * Projects authority (owner ruling 2026-09-07, hasna/apps#1720; pattern: todos
 * #1942).
 *
 * Why a choke point rather than a guard in every caller: 80+ call sites reach
 * `getDatabase()` from the CLI, the MCP server and the library helpers, and a
 * hand-maintained list of "local-only" verbs is exactly what let a hosted
 * station open `~/.hasna/projects/projects.db` for tmux profiles, a stray
 * `ensureCliAgent()`, `sessions`, or `~/.hasna/projects/data/<id>/project.db`
 * for data models, loop links and `store ensure`. Every registry open funnels
 * through here (and every project.db open through `assertLocalStoreAllowed`),
 * so refusing HERE makes "no local SQLite under a hosted credential" true by
 * construction. The refusal names only sources and the opt-in, never a value.
 */
let localStoreRefusal: string | null = null;

/** Refuse every on-box SQLite open for the rest of this process. */
export function refuseLocalStore(message: string): void {
  localStoreRefusal = message;
}

/** Lift a refusal installed by {@link refuseLocalStore}. Test seam (`__resetProjectStore`). */
export function allowLocalStore(): void {
  localStoreRefusal = null;
}

/** True while {@link refuseLocalStore} is in force for this process. */
export function isLocalStoreRefused(): boolean {
  return localStoreRefusal !== null;
}

/** The typed refusal: `REMOTE_COMMAND_UNSUPPORTED`, same code the hosted store uses for local-only verbs. */
export class LocalStoreRefusedError extends Error {
  readonly code = "REMOTE_COMMAND_UNSUPPORTED";
  constructor(message: string) {
    super(message);
    this.name = "LocalStoreRefusedError";
  }
}

/** Throw the installed refusal, if any. Called by every on-box SQLite opener. */
export function assertLocalStoreAllowed(): void {
  if (localStoreRefusal !== null) throw new LocalStoreRefusedError(localStoreRefusal);
}

export function getDb(): Database { return getDatabase(); }

export function getDatabase(path?: string): Database {
  // A hosted authority is being served by this process: nothing may open the
  // on-box registry, not even with an explicit path (HASNA_PROJECTS_DB_PATH is
  // still a local SQLite file). See refuseLocalStore. The one exception is an
  // in-memory scratch database (`:memory:`): nothing on disk, nothing served,
  // so it is not a local STORE — the hosted `create --dry-run` planner previews
  // against one instead of opening projects.db.
  if (path !== ":memory:") assertLocalStoreAllowed();
  if (path) {
    ensureDir(path);
    const db = new Database(path);
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA busy_timeout=5000");
    db.run("PRAGMA foreign_keys=ON");
    runMigrations(db);
    return db;
  }
  const dbPath = getDbPath();
  if (!_db || _dbPath !== dbPath) {
    if (_db) _db.close();
    ensureDir(dbPath);
    _db = new Database(dbPath);
    _dbPath = dbPath;
    _db.run("PRAGMA journal_mode=WAL");
    _db.run("PRAGMA busy_timeout=5000");
    _db.run("PRAGMA foreign_keys=ON");
    runMigrations(_db);
  }
  return _db;
}

export function closeDatabase(): void {
  if (_db) _db.close();
  _db = null;
  _dbPath = null;
}

export function now(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

export function uuid(): string {
  return crypto.randomUUID();
}

export function resolvePartialId(partial: string, db?: Database): string | null {
  const d = db || getDatabase();
  if (partial.length < 4) return null;
  const row = d
    .query("SELECT id FROM workspaces WHERE id LIKE ? OR slug = ? LIMIT 1")
    .get(`${partial}%`, partial) as { id: string } | null;
  return row?.id ?? null;
}
