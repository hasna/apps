import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { ActionAuditEvent, ActionManifest, ActionRun } from "./types.js";
import { getActionsHome, HASNA_ACTIONS_DIR_ENV, HASNA_ACTIONS_HOME_ENV } from "./core/app-home.js";

export { HASNA_ACTIONS_DIR_ENV, HASNA_ACTIONS_HOME_ENV } from "./core/app-home.js";
export const ACTIONS_DATABASE_FILENAME = "actions.db";
/** Metadata key recording that the one-time import of the legacy JSON files finished. */
export const ACTIONS_JSON_MIGRATION_KEY = "json-store-migration-v1";

/**
 * Resolve the actions data directory, honoring (in order) an explicit override
 * (CLI `--dir`), the exact-app overrides `HASNA_ACTIONS_DIR` then
 * `HASNA_ACTIONS_HOME`, the @hasna/paths XDG data home once adopted
 * (`HASNA_DATA_HOME` set or the store already migrated there), and finally the
 * legacy `~/.hasna/actions` default.
 */
export function getActionsDataDir(override?: string): string {
  if (override) return override;
  return getActionsHome();
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

/**
 * Serializes a read-modify-write cycle with an atomic `mkdir` lock. The JSON store
 * writes whole files, so two processes appending disjoint records without a lock
 * both read the old file and the later rename silently drops the earlier writer's
 * records. A stale lock (holder died mid-cycle) is broken on age rather than
 * blocking the next writer forever.
 */
async function withJsonStoreLock<T>(dataDir: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, JSON_STORE_LOCK_DIRNAME);
  const deadline = Date.now() + JSON_STORE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > JSON_STORE_LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
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
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
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
