import { chmod, link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { ActionAuditEvent, ActionManifest, ActionRun } from "./types.js";

export const HASNA_ACTIONS_DIR_ENV = "HASNA_ACTIONS_DIR";
export const HASNA_ACTIONS_HOME_ENV = "HASNA_ACTIONS_HOME";
export const ACTIONS_DATABASE_FILENAME = "actions.db";
/** Metadata key recording that the one-time import of the legacy JSON files finished. */
export const ACTIONS_JSON_MIGRATION_KEY = "json-store-migration-v1";

export function getActionsDataDir(override?: string): string {
  return override || process.env[HASNA_ACTIONS_DIR_ENV] || process.env[HASNA_ACTIONS_HOME_ENV] || join(homedir(), ".hasna", "actions");
}

export function getActiveActionsDirEnv(): typeof HASNA_ACTIONS_DIR_ENV | typeof HASNA_ACTIONS_HOME_ENV | null {
  if (process.env[HASNA_ACTIONS_DIR_ENV]) return HASNA_ACTIONS_DIR_ENV;
  if (process.env[HASNA_ACTIONS_HOME_ENV]) return HASNA_ACTIONS_HOME_ENV;
  return null;
}

export interface ActionsStatus {
  service: "actions";
  schemaVersion: "1.0";
  dataDir: string;
  storage: {
    engine: "sqlite";
    database: { path: string; exists: boolean };
  };
  env: {
    primary: typeof HASNA_ACTIONS_DIR_ENV;
    fallback: typeof HASNA_ACTIONS_HOME_ENV;
    active: typeof HASNA_ACTIONS_DIR_ENV | typeof HASNA_ACTIONS_HOME_ENV | null;
  };
  files: {
    manifests: { path: string; exists: boolean; records: number };
    runs: { path: string; exists: boolean; records: number };
    auditEvents: { path: string; exists: boolean; records: number };
  };
  counts: {
    manifests: number;
    runs: number;
    auditEvents: number;
  };
}

export interface ActionsStore {
  dataDir: string;
  init(): Promise<void>;
  saveManifest(manifest: ActionManifest): Promise<ActionManifest>;
  listManifests(): Promise<ActionManifest[]>;
  getManifest(id: string): Promise<ActionManifest | undefined>;
  createRun(run: ActionRun): Promise<ActionRun>;
  updateRun(run: ActionRun): Promise<ActionRun>;
  getRun(id: string): Promise<ActionRun | undefined>;
  listRuns(options?: { actionId?: string; status?: string; limit?: number }): Promise<ActionRun[]>;
  findRunByIdempotencyKey(actionId: string, idempotencyKey: string): Promise<ActionRun | undefined>;
  appendAuditEvent(event: ActionAuditEvent): Promise<ActionAuditEvent>;
  listAuditEvents(options?: { runId?: string; actionId?: string; limit?: number }): Promise<ActionAuditEvent[]>;
}

interface JsonRow {
  json: string;
}

function parseJsonRow<T>(row: JsonRow | null): T | undefined {
  return row ? JSON.parse(row.json) as T : undefined;
}

let cachedDatabaseConstructor: typeof Database | undefined;

/**
 * `bun:sqlite` is loaded on demand so that importing the package entry stays runtime
 * agnostic; only callers that actually open a SQLite store need the Bun runtime.
 */
async function loadDatabaseConstructor(): Promise<typeof Database> {
  if (cachedDatabaseConstructor) return cachedDatabaseConstructor;
  let module: typeof import("bun:sqlite");
  try {
    module = await import("bun:sqlite");
  } catch (error) {
    throw new Error(
      "SQLiteActionsStore requires the Bun runtime because bun:sqlite is unavailable; use JsonActionsStore instead",
      { cause: error },
    );
  }
  cachedDatabaseConstructor = module.Database;
  return cachedDatabaseConstructor;
}

/**
 * Restrictive permissions are best effort. Shared data dirs, container bind mounts, and
 * volumes without POSIX modes reject chmod, and the JSON store has always tolerated that.
 */
function hardenPath(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch {
    // Ignore: the store stays usable even when the mode cannot be tightened.
  }
}

function readMigrationArray<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Expected a JSON array in ${path}`);
  return parsed as T[];
}

interface MigrationSource<T> {
  records: T[];
  readable: boolean;
}

/**
 * A legacy file the migration cannot read must never block the store: truncated writes,
 * hand edits, and half-synced data dirs are exactly when a recovery command is needed.
 * The offending path is reported on stderr and the remaining files still import; the
 * migration is left unmarked so a repaired file is picked up on a later open.
 */
function readMigrationSource<T>(path: string): MigrationSource<T> {
  try {
    return { records: readMigrationArray<T>(path), readable: true };
  } catch (error) {
    console.error(
      `actions: skipping unreadable legacy store file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { records: [], readable: false };
  }
}

export class SQLiteActionsStore implements ActionsStore {
  dataDir: string;
  readonly databasePath: string;
  private database?: Database;

  constructor(dataDir = getActionsDataDir()) {
    this.dataDir = dataDir;
    this.databasePath = join(dataDir, ACTIONS_DATABASE_FILENAME);
  }

  async init(): Promise<void> {
    await this.getDatabase();
  }

  async saveManifest(manifest: ActionManifest): Promise<ActionManifest> {
    (await this.getDatabase()).query(`
      INSERT INTO action_manifests (id, json)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET json = excluded.json
    `).run(manifest.id, JSON.stringify(manifest));
    return manifest;
  }

  async listManifests(): Promise<ActionManifest[]> {
    const rows = (await this.getDatabase()).query("SELECT json FROM action_manifests ORDER BY rowid ASC").all() as JsonRow[];
    return rows.map((row) => JSON.parse(row.json) as ActionManifest);
  }

  async getManifest(id: string): Promise<ActionManifest | undefined> {
    const row = (await this.getDatabase()).query("SELECT json FROM action_manifests WHERE id = ?").get(id) as JsonRow | null;
    return parseJsonRow<ActionManifest>(row);
  }

  async createRun(run: ActionRun): Promise<ActionRun> {
    (await this.getDatabase()).query(`
      INSERT INTO action_runs (id, action_id, status, idempotency_key, created_at, updated_at, json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      run.id,
      run.actionId,
      run.status,
      run.idempotencyKey ?? null,
      run.createdAt,
      run.updatedAt,
      JSON.stringify(run),
    );
    return run;
  }

  async updateRun(run: ActionRun): Promise<ActionRun> {
    (await this.getDatabase()).query(`
      INSERT INTO action_runs (id, action_id, status, idempotency_key, created_at, updated_at, json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        action_id = excluded.action_id,
        status = excluded.status,
        idempotency_key = excluded.idempotency_key,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        json = excluded.json
    `).run(
      run.id,
      run.actionId,
      run.status,
      run.idempotencyKey ?? null,
      run.createdAt,
      run.updatedAt,
      JSON.stringify(run),
    );
    return run;
  }

  async getRun(id: string): Promise<ActionRun | undefined> {
    const row = (await this.getDatabase()).query("SELECT json FROM action_runs WHERE id = ?").get(id) as JsonRow | null;
    return parseJsonRow<ActionRun>(row);
  }

  async listRuns(options: { actionId?: string; status?: string; limit?: number } = {}): Promise<ActionRun[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.actionId) {
      conditions.push("action_id = ?");
      values.push(options.actionId);
    }
    if (options.status) {
      conditions.push("status = ?");
      values.push(options.status);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const limit = typeof options.limit === "number" ? " LIMIT ?" : "";
    if (limit) values.push(Math.max(0, options.limit!));
    const rows = (await this.getDatabase())
      .query(`SELECT json FROM action_runs${where} ORDER BY created_at DESC, rowid DESC${limit}`)
      .all(...values) as JsonRow[];
    return rows.map((row) => JSON.parse(row.json) as ActionRun);
  }

  async findRunByIdempotencyKey(actionId: string, idempotencyKey: string): Promise<ActionRun | undefined> {
    const row = (await this.getDatabase()).query(`
      SELECT json
      FROM action_runs
      WHERE action_id = ? AND idempotency_key = ?
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(actionId, idempotencyKey) as JsonRow | null;
    return parseJsonRow<ActionRun>(row);
  }

  async appendAuditEvent(event: ActionAuditEvent): Promise<ActionAuditEvent> {
    (await this.getDatabase()).query(`
      INSERT INTO action_audit_events (id, run_id, action_id, time, json)
      VALUES (?, ?, ?, ?, ?)
    `).run(event.id, event.runId ?? null, event.actionId, event.time, JSON.stringify(event));
    return event;
  }

  async listAuditEvents(options: { runId?: string; actionId?: string; limit?: number } = {}): Promise<ActionAuditEvent[]> {
    const conditions: string[] = [];
    const values: Array<string | number> = [];
    if (options.runId) {
      conditions.push("run_id = ?");
      values.push(options.runId);
    }
    if (options.actionId) {
      conditions.push("action_id = ?");
      values.push(options.actionId);
    }
    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const limit = typeof options.limit === "number" ? " LIMIT ?" : "";
    if (limit) values.push(Math.max(0, options.limit!));
    const rows = (await this.getDatabase())
      .query(`SELECT json FROM action_audit_events${where} ORDER BY time DESC, rowid DESC${limit}`)
      .all(...values) as JsonRow[];
    return rows.map((row) => JSON.parse(row.json) as ActionAuditEvent);
  }

  private async getDatabase(): Promise<Database> {
    if (this.database) return this.database;
    const DatabaseConstructor = await loadDatabaseConstructor();
    if (this.database) return this.database;

    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    hardenPath(this.dataDir, 0o700);
    const database = new DatabaseConstructor(this.databasePath, { create: true });
    try {
      hardenPath(this.databasePath, 0o600);
      // `busy_timeout` must be armed before anything that takes a lock. `journal_mode`
      // acquires one, so opening the store while another process writes raises
      // SQLITE_BUSY unless the busy handler is already installed on this connection.
      database.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = DELETE;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS actions_metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS action_manifests (
          id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS action_runs (
          id TEXT PRIMARY KEY,
          action_id TEXT NOT NULL,
          status TEXT NOT NULL,
          idempotency_key TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS action_runs_action_id ON action_runs (action_id);
        CREATE INDEX IF NOT EXISTS action_runs_idempotency ON action_runs (action_id, idempotency_key);
        CREATE TABLE IF NOT EXISTS action_audit_events (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          action_id TEXT NOT NULL,
          time TEXT NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS action_audit_events_run_id ON action_audit_events (run_id);
        CREATE INDEX IF NOT EXISTS action_audit_events_action_id ON action_audit_events (action_id);
      `);
      this.migrateJsonFiles(database);
      this.database = database;
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  private migrateJsonFiles(database: Database): void {
    const migrationKey = ACTIONS_JSON_MIGRATION_KEY;
    if (database.query("SELECT value FROM actions_metadata WHERE key = ?").get(migrationKey)) return;

    const manifests = readMigrationSource<ActionManifest>(join(this.dataDir, "manifests.json"));
    const runs = readMigrationSource<ActionRun>(join(this.dataDir, "runs.json"));
    const auditEvents = readMigrationSource<ActionAuditEvent>(join(this.dataDir, "audit-events.json"));
    const complete = manifests.readable && runs.readable && auditEvents.readable;
    const migrate = database.transaction(() => {
      if (database.query("SELECT value FROM actions_metadata WHERE key = ?").get(migrationKey)) return;

      const insertManifest = database.query("INSERT OR IGNORE INTO action_manifests (id, json) VALUES (?, ?)");
      for (const manifest of manifests.records) insertManifest.run(manifest.id, JSON.stringify(manifest));

      const insertRun = database.query(`
        INSERT OR IGNORE INTO action_runs
          (id, action_id, status, idempotency_key, created_at, updated_at, json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const run of runs.records) {
        insertRun.run(
          run.id,
          run.actionId,
          run.status,
          run.idempotencyKey ?? null,
          run.createdAt,
          run.updatedAt,
          JSON.stringify(run),
        );
      }

      const insertAuditEvent = database.query(`
        INSERT OR IGNORE INTO action_audit_events (id, run_id, action_id, time, json)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const event of auditEvents.records) {
        insertAuditEvent.run(event.id, event.runId ?? null, event.actionId, event.time, JSON.stringify(event));
      }
      // Only a fully readable set may close the migration; otherwise the skipped file
      // gets another chance once it is repaired, and the re-import stays idempotent.
      if (complete) {
        database.query("INSERT OR IGNORE INTO actions_metadata (key, value) VALUES (?, ?)").run(migrationKey, "completed");
      }
    });
    migrate.immediate();
  }
}

/** Lock directory serializing read-modify-write cycles across processes. */
export const JSON_STORE_LOCK_DIRNAME = ".actions-write.lock";
const JSON_STORE_LOCK_TIMEOUT_MS = 15_000;
const JSON_STORE_LOCK_STALE_MS = 30_000;
/** File inside the lock directory identifying the current holder. */
export const JSON_STORE_LOCK_OWNER_FILE = "owner.json";

/**
 * Holder identity written into the lock directory. The token is unique per acquire;
 * pid + host identify the process that created it. The write lock is only ever removed
 * by the holder that created it, and a stale lock is only broken when its recorded
 * process is no longer alive — so a suspended or slow writer keeps its lock and a
 * successor can never overlap it (overlapping whole-file renames is the audit-record
 * loss the lock exists to prevent).
 */
export interface JsonStoreLockOwner {
  token: string;
  pid: number;
  host: string;
  startedAt: string;
}

async function readOwnerFile(path: string): Promise<JsonStoreLockOwner | null> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as JsonStoreLockOwner;
    if (typeof parsed.token !== "string" || typeof parsed.pid !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readLockOwner(lockPath: string): Promise<JsonStoreLockOwner | null> {
  return readOwnerFile(join(lockPath, JSON_STORE_LOCK_OWNER_FILE));
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by another user: alive.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Restores a moved lock-owner file ATOMICALLY and NON-CLOBBERING: the canonical
 * owner path is recreated only while it is still absent. A successor that
 * reacquired a released lock in the meantime has installed its own owner file; a
 * replacing `rename` would overwrite that live successor's owner with a stale one
 * (dead pid), letting a later breaker take over a live writer's lock — overlapping
 * whole-file writes, i.e. record loss. `fs.link` fails EEXIST when the target
 * already exists, so the restore either recreates the moved file or leaves a
 * successor's owner untouched — never both, and with no window between the check
 * and the act. The quarantine path and the lock directory both live under the
 * same dataDir, so the hard link cannot cross a filesystem boundary (EXDEV).
 *
 * @returns true when the moved file was restored to the canonical path; false
 *          when it was disposed as an orphan (a successor's owner was already in
 *          place, or the lock directory itself vanished — the holder released
 *          concurrently and the moved file belongs to a released lock).
 */
export async function restoreMovedOwnerFile(lockPath: string, quarantinePath: string): Promise<boolean> {
  const ownerFile = join(lockPath, JSON_STORE_LOCK_OWNER_FILE);
  try {
    await link(quarantinePath, ownerFile);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") {
      // EEXIST: a successor's owner file is already installed (or is being
      // installed right now) — the moved file is an orphan of a superseded owner.
      // ENOENT: the lock directory vanished — the holder released concurrently;
      // the moved file is an orphan of a released lock. Either way, dispose the
      // moved file; never clobber, never leak the quarantine.
      await rm(quarantinePath, { recursive: true, force: true }).catch(() => undefined);
      return false;
    }
    throw error;
  }
  await rm(quarantinePath, { force: true }).catch(() => undefined);
  return true;
}

/**
 * Atomically takes over a validated stale lock WITHOUT ever emptying the canonical
 * lock path. POSIX offers no conditional delete, so a plain `rm` after a stale check
 * has a check-then-act window: a waiter preempted between its validation and its
 * removal could delete a successor's FRESH lock. Only the owner FILE is moved
 * (renamed to the quarantine path) — the lock DIRECTORY itself never leaves the
 * canonical path, so a third writer's `mkdir` keeps failing EEXIST at every instant
 * and nobody can acquire into a gap while a live owner continues. The moved file is
 * re-verified: if it is exactly the validated dead owner, the caller's owner is
 * installed and the takeover is complete; anything else — a live successor's owner
 * file moved by a delayed breaker — is restored atomically and NON-CLOBBERING
 * (restoreMovedOwnerFile): if a successor has already installed its owner in the
 * meanwhile (release + reacquire), the moved file is an orphan and is disposed,
 * never overwriting the successor's owner. An owner file that vanishes first
 * (ENOENT) or is unreadable is never grounds for takeover.
 *
 * @returns true when the caller now holds the lock; false when the takeover did not
 *          land (owner vanished first, or the moved file was not the validated dead
 *          owner) and the caller must retry its acquire.
 */
export async function takeOverJsonStoreLock(
  lockPath: string,
  validatedOwner: JsonStoreLockOwner,
  myOwner: JsonStoreLockOwner,
  quarantinePath: string,
): Promise<boolean> {
  const ownerFile = join(lockPath, JSON_STORE_LOCK_OWNER_FILE);
  try {
    await rename(ownerFile, quarantinePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  // The moved artifact is the owner FILE itself at the quarantine path (the lock
  // directory never moves), so read the quarantine path directly.
  const moved = await readOwnerFile(quarantinePath);
  if (moved !== null && moved.token === validatedOwner.token) {
    // The file we moved is exactly the validated stale owner: install ours. If the
    // install cannot land, restore the dead owner's file so a later breaker can
    // retry, then surface the failure (fail closed: no takeover without an owner).
    // The restore is non-clobbering: no successor can be in this directory while
    // we hold the moved dead owner, but the helper's EEXIST/ENOENT handling makes
    // even an impossible race fail closed instead of overwriting.
    try {
      await writeFile(ownerFile, JSON.stringify(myOwner));
    } catch (error) {
      await restoreMovedOwnerFile(lockPath, quarantinePath);
      throw error;
    }
    await rm(quarantinePath, { recursive: true, force: true }).catch(() => undefined);
    return true;
  }
  // We moved something else — a live successor's owner file, or one with no readable
  // owner. Restore it non-clobbering; never delete a lock we cannot prove dead, and
  // never overwrite a successor's owner in a recreated lock directory: the release
  // path may have removed the directory and a successor may have reacquired it
  // while we were delayed — their installed owner file must win, and the moved file
  // is then an orphan of a superseded owner, safe to dispose of (the helper handles
  // both EEXIST and ENOENT the same way).
  await restoreMovedOwnerFile(lockPath, quarantinePath);
  return false;
}

/**
 * Removes the lock directory only while it is still owned by `token`. A holder whose
 * lock was broken and re-acquired by a successor must never delete the successor's
 * lock — that would recreate concurrent writers.
 */
export async function releaseJsonStoreLockIfOwned(lockPath: string, token: string): Promise<void> {
  const owner = await readLockOwner(lockPath);
  if (owner === null || owner.token !== token) return;
  await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Serializes a read-modify-write cycle with an atomic `mkdir` lock. The JSON store
 * writes whole files, so two processes appending disjoint records without a lock
 * both read the old file and the later rename silently drops the earlier writer's
 * records. A stale lock (holder died mid-cycle) is taken over on age when the
 * holder's process is no longer alive; a stale lock whose holder is still alive is
 * never broken, a lock whose owner file is missing or unreadable is never taken
 * over, the canonical lock path never empties during a takeover (only the owner
 * file moves), and release only ever removes a lock this process still owns.
 */
async function withJsonStoreLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, JSON_STORE_LOCK_DIRNAME);
  const token = randomUUID();
  const owner: JsonStoreLockOwner = {
    token,
    pid: process.pid,
    host: hostname(),
    startedAt: new Date().toISOString(),
  };
  const deadline = Date.now() + JSON_STORE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      try {
        await writeFile(join(lockPath, JSON_STORE_LOCK_OWNER_FILE), JSON.stringify(owner));
      } catch (error) {
        // The lock was acquired but its owner file could not be written: remove the
        // fresh lock so it cannot wedge the store, then surface the failure.
        await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > JSON_STORE_LOCK_STALE_MS) {
          const existing = await readLockOwner(lockPath);
          // A lock whose owner file is missing or unreadable is never broken: the
          // owner can be momentarily absent inside another breaker's takeover
          // window, and a missing owner is never grounds to enter a live critical
          // section. Only a provably dead recorded holder may be taken over.
          if (existing !== null && !isProcessAlive(existing.pid)) {
            const tookOver = await takeOverJsonStoreLock(
              lockPath,
              existing,
              owner,
              join(dataDir, `${JSON_STORE_LOCK_DIRNAME}.quarantine-${token}`),
            );
            // The takeover installs our owner file and leaves the lock directory in
            // place, so retrying `mkdir` would spin on EEXIST forever: holding the
            // lock is the terminal success of this acquire attempt.
            if (tookOver) break;
          }
        }
      } catch {
        // The holder released between stat and now; retry the acquire.
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the actions JSON store write lock at ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 20)));
    }
  }
  try {
    return await fn();
  } finally {
    await releaseJsonStoreLockIfOwned(lockPath, token);
  }
}

export class JsonActionsStore implements ActionsStore {
  dataDir: string;
  private manifestsPath: string;
  private runsPath: string;
  private eventsPath: string;

  constructor(dataDir = getActionsDataDir()) {
    this.dataDir = dataDir;
    this.manifestsPath = join(dataDir, "manifests.json");
    this.runsPath = join(dataDir, "runs.json");
    this.eventsPath = join(dataDir, "audit-events.json");
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await chmod(this.dataDir, 0o700).catch(() => undefined);
    await this.ensureArrayFile(this.manifestsPath);
    await this.ensureArrayFile(this.runsPath);
    await this.ensureArrayFile(this.eventsPath);
  }

  async saveManifest(manifest: ActionManifest): Promise<ActionManifest> {
    return withJsonStoreLock(this.dataDir, async () => {
      await this.init();
      const manifests = await this.readJson<ActionManifest[]>(this.manifestsPath, []);
      const index = manifests.findIndex((item) => item.id === manifest.id);
      if (index >= 0) manifests[index] = manifest;
      else manifests.push(manifest);
      await this.writeJson(this.manifestsPath, manifests);
      return manifest;
    });
  }

  async listManifests(): Promise<ActionManifest[]> {
    await this.init();
    return this.readJson<ActionManifest[]>(this.manifestsPath, []);
  }

  async getManifest(id: string): Promise<ActionManifest | undefined> {
    const manifests = await this.listManifests();
    return manifests.find((manifest) => manifest.id === id);
  }

  async createRun(run: ActionRun): Promise<ActionRun> {
    return withJsonStoreLock(this.dataDir, async () => {
      await this.init();
      const runs = await this.readJson<ActionRun[]>(this.runsPath, []);
      runs.push(run);
      await this.writeJson(this.runsPath, runs);
      return run;
    });
  }

  async updateRun(run: ActionRun): Promise<ActionRun> {
    return withJsonStoreLock(this.dataDir, async () => {
      await this.init();
      const runs = await this.readJson<ActionRun[]>(this.runsPath, []);
      const index = runs.findIndex((item) => item.id === run.id);
      if (index >= 0) runs[index] = run;
      else runs.push(run);
      await this.writeJson(this.runsPath, runs);
      return run;
    });
  }

  async getRun(id: string): Promise<ActionRun | undefined> {
    const runs = await this.listRuns();
    return runs.find((run) => run.id === id);
  }

  async listRuns(options: { actionId?: string; status?: string; limit?: number } = {}): Promise<ActionRun[]> {
    await this.init();
    let runs = await this.readJson<ActionRun[]>(this.runsPath, []);
    if (options.actionId) runs = runs.filter((run) => run.actionId === options.actionId);
    if (options.status) runs = runs.filter((run) => run.status === options.status);
    runs = runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return typeof options.limit === "number" ? runs.slice(0, Math.max(0, options.limit)) : runs;
  }

  async findRunByIdempotencyKey(actionId: string, idempotencyKey: string): Promise<ActionRun | undefined> {
    const runs = await this.listRuns({ actionId });
    return runs.find((run) => run.idempotencyKey === idempotencyKey);
  }

  async appendAuditEvent(event: ActionAuditEvent): Promise<ActionAuditEvent> {
    return withJsonStoreLock(this.dataDir, async () => {
      await this.init();
      const events = await this.readJson<ActionAuditEvent[]>(this.eventsPath, []);
      events.push(event);
      await this.writeJson(this.eventsPath, events);
      return event;
    });
  }

  async listAuditEvents(options: { runId?: string; actionId?: string; limit?: number } = {}): Promise<ActionAuditEvent[]> {
    await this.init();
    let events = await this.readJson<ActionAuditEvent[]>(this.eventsPath, []);
    if (options.runId) events = events.filter((event) => event.runId === options.runId);
    if (options.actionId) events = events.filter((event) => event.actionId === options.actionId);
    events = events.sort((a, b) => b.time.localeCompare(a.time));
    return typeof options.limit === "number" ? events.slice(0, Math.max(0, options.limit)) : events;
  }

  private async ensureArrayFile(path: string): Promise<void> {
    if (!existsSync(path)) {
      await writeFile(path, "[]\n", { encoding: "utf-8", mode: 0o600 });
    }
    await chmod(path, 0o600).catch(() => undefined);
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(path, "utf-8");
      if (!raw.trim()) return fallback;
      return JSON.parse(raw) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw error;
    }
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    await rename(tempPath, path);
    await chmod(path, 0o600).catch(() => undefined);
  }
}

export async function getActionsStatus(dataDir?: string): Promise<ActionsStatus> {
  const store = new SQLiteActionsStore(dataDir);
  await store.init();
  const [manifests, runs, auditEvents] = await Promise.all([
    store.listManifests(),
    store.listRuns(),
    store.listAuditEvents(),
  ]);

  return {
    service: "actions",
    schemaVersion: "1.0",
    dataDir: store.dataDir,
    storage: {
      engine: "sqlite",
      database: {
        path: store.databasePath,
        exists: existsSync(store.databasePath),
      },
    },
    env: {
      primary: HASNA_ACTIONS_DIR_ENV,
      fallback: HASNA_ACTIONS_HOME_ENV,
      active: getActiveActionsDirEnv(),
    },
    files: {
      manifests: statusDatabaseTable(store.databasePath, manifests.length),
      runs: statusDatabaseTable(store.databasePath, runs.length),
      auditEvents: statusDatabaseTable(store.databasePath, auditEvents.length),
    },
    counts: {
      manifests: manifests.length,
      runs: runs.length,
      auditEvents: auditEvents.length,
    },
  };
}

function statusDatabaseTable(databasePath: string, records: number): { path: string; exists: boolean; records: number } {
  return { path: databasePath, exists: existsSync(databasePath), records };
}
