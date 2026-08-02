import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { FeedbackItem } from "./types.js";
import type { FeedbackLinkageDelta } from "./validation.js";
import { parseStoredFeedbackItem } from "./validation.js";
import { createTaskSink } from "./tasks.js";
import type { FeedbackTaskSink } from "./tasks.js";
import { createDefaultFeedbackEventSink } from "./events.js";
import type { FeedbackEventSink } from "./events.js";
import { FeedbackStoreBase, applyLinkageDelta, foldFeedbackRecords } from "./storage.base.js";
import { DEFAULT_FEEDBACK_FILE, resolveFeedbackDataDir } from "./storage.paths.js";

export const DEFAULT_SQLITE_FILE = "feedback.db";

/** Bumped only when the on-disk schema changes in a way a reader must know about. */
const SCHEMA_VERSION = 1;
const MIGRATION_MARKER = "jsonl_migration";

/**
 * `bun:sqlite` is loaded lazily rather than imported at module scope.
 *
 * A top-level `import` would make this module — and therefore the package
 * root, which re-exports it — unloadable anywhere other than Bun. Nothing here
 * touches the driver until someone actually constructs a SQLite store, so a
 * consumer importing types or the JSONL store keeps working unchanged.
 */
const nodeRequire = createRequire(import.meta.url);

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  run(sql: string, ...params: unknown[]): unknown;
  query(sql: string): SqliteStatement;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteDatabaseConstructor {
  new (path: string, options?: { create?: boolean }): SqliteDatabase;
}

function loadDatabaseConstructor(): SqliteDatabaseConstructor {
  try {
    return (nodeRequire("bun:sqlite") as { Database: SqliteDatabaseConstructor }).Database;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The SQLite feedback store requires Bun's built-in bun:sqlite driver, which is unavailable in this runtime (${message}). ` +
        `Run under Bun, or select the JSONL store with HASNA_FEEDBACK_STORE=jsonl.`,
    );
  }
}

export interface SqliteFeedbackStoreOptions {
  dataDir?: string;
  /** Explicit database path. Overrides `dataDir`. */
  sqlitePath?: string;
  eventSink?: FeedbackEventSink | null;
  taskSink?: FeedbackTaskSink | null;
  /**
   * Skip the automatic `feedback.jsonl` import. The import is on by default
   * because flipping the storage default without it would make an existing
   * user's feedback appear to vanish.
   */
  migrate?: boolean;
}

export function resolveFeedbackSqlitePath(options: { dataDir?: string; sqlitePath?: string } = {}): string {
  return options.sqlitePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_SQLITE_FILE);
}

export interface FeedbackMigrationResult {
  /** Whether an import pass actually ran over a source file. */
  ran: boolean;
  /** Items inserted by this pass. */
  migrated: number;
  /** Items in the source that the database already held, and so were left alone. */
  alreadyPresent: number;
  /** The source file, when one was found. */
  source: string | null;
  reason?: "already-migrated" | "no-source" | "empty-source";
}

/**
 * Import an append-only `feedback.jsonl` log into a SQLite store.
 *
 * Non-destructive by construction: the source file is never written, renamed
 * or removed, so a rollback is "set HASNA_FEEDBACK_STORE=jsonl" and nothing
 * else. Idempotent in two independent ways — a marker row records that the
 * import ran, and the insert itself ignores ids the database already holds, so
 * even a forced re-run cannot duplicate.
 */
export function migrateJsonlIntoSqlite(
  store: SqliteFeedbackStore,
  sourcePath: string,
  options: { force?: boolean } = {},
): FeedbackMigrationResult {
  const base: FeedbackMigrationResult = { ran: false, migrated: 0, alreadyPresent: 0, source: null };

  if (!options.force && store.readMeta(MIGRATION_MARKER)) {
    return { ...base, reason: "already-migrated" };
  }
  if (!existsSync(sourcePath)) {
    return { ...base, reason: "no-source" };
  }

  const raw = readFileSync(sourcePath, "utf8");
  if (!raw.trim()) {
    return { ...base, source: sourcePath, reason: "empty-source" };
  }

  // Deliberately unguarded: a parse failure here means the source log is
  // damaged. Swallowing it would import a silently truncated subset and then
  // mark the migration done, which is the one outcome that loses data
  // irrecoverably from the reader's point of view.
  const items = foldFeedbackRecords(raw);
  const result = store.importItems(items);
  store.writeMeta(
    MIGRATION_MARKER,
    JSON.stringify({ source: sourcePath, migratedAt: new Date().toISOString(), count: result.migrated }),
  );
  return { ran: true, migrated: result.migrated, alreadyPresent: result.alreadyPresent, source: sourcePath };
}

/**
 * SQLite-backed {@link FeedbackStore} — the local default.
 *
 * Rows carry the full item as JSON alongside a few projected columns. The JSON
 * is the source of truth, which is what makes `exportJsonl` byte-identical to
 * the JSONL store's and keeps forward-compatibility when the item shape grows a
 * field this schema does not name.
 *
 * Reads load and then route through the shared `applyFeedbackFilter` rather
 * than pushing predicates into SQL. That is a deliberate correctness-first
 * choice: the filter semantics (lowercased tag match, folded free-text
 * haystack, the 1..500 clamp) are the contract other backends are tested
 * against, and a hand-written WHERE clause that drifts from them would fail
 * quietly. Pushing predicates down is a later optimisation to make against
 * these tests, not before them.
 */
export class SqliteFeedbackStore extends FeedbackStoreBase {
  readonly databasePath: string;
  /** What the automatic `feedback.jsonl` import did at construction time. */
  readonly migration: FeedbackMigrationResult;
  private readonly db: SqliteDatabase;
  private closed = false;

  constructor(options: SqliteFeedbackStoreOptions = {}) {
    super(
      options.eventSink === null ? null : options.eventSink ?? createDefaultFeedbackEventSink(),
      options.taskSink === null ? null : options.taskSink ?? createTaskSink(),
    );
    this.databasePath = resolveFeedbackSqlitePath(options);
    mkdirSync(dirname(this.databasePath), { recursive: true });
    const Database = loadDatabaseConstructor();
    this.db = new Database(this.databasePath, { create: true });
    // WAL keeps a reader from blocking the writer, which matters because the
    // CLI, the MCP server and the HTTP server all open the same file.
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA busy_timeout = 5000");
    this.db.run("PRAGMA foreign_keys = ON");
    this.initSchema();

    this.migration =
      options.migrate === false
        ? { ran: false, migrated: 0, alreadyPresent: 0, source: null, reason: "no-source" }
        : migrateJsonlIntoSqlite(this, join(dirname(this.databasePath), DEFAULT_FEEDBACK_FILE));
  }

  private initSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS feedback_items (
        id         TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        app_id     TEXT NOT NULL,
        status     TEXT NOT NULL,
        kind       TEXT NOT NULL,
        severity   TEXT,
        item       TEXT NOT NULL
      )
    `);
    this.db.run("CREATE INDEX IF NOT EXISTS feedback_items_created_at ON feedback_items (created_at DESC)");
    this.db.run("CREATE TABLE IF NOT EXISTS feedback_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    this.writeMeta("schema_version", String(SCHEMA_VERSION));
  }

  readMeta(key: string): string | null {
    const row = this.db.query("SELECT value FROM feedback_meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined
      | null;
    return row?.value ?? null;
  }

  writeMeta(key: string, value: string): void {
    this.db.run(
      "INSERT INTO feedback_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  /**
   * Insert items that are not already present. Returns how many landed and how
   * many were already there, so a migration can report the difference instead
   * of claiming credit for rows it did not write.
   */
  importItems(items: readonly FeedbackItem[]): { migrated: number; alreadyPresent: number } {
    let migrated = 0;
    let alreadyPresent = 0;
    this.db.run("BEGIN IMMEDIATE");
    try {
      const exists = this.db.prepare("SELECT 1 FROM feedback_items WHERE id = ?");
      for (const item of items) {
        if (exists.get(item.id)) {
          alreadyPresent += 1;
          continue;
        }
        this.insertRow(item);
        migrated += 1;
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
    return { migrated, alreadyPresent };
  }

  private insertRow(item: FeedbackItem): void {
    this.db.run(
      `INSERT INTO feedback_items (id, created_at, updated_at, app_id, status, kind, severity, item)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         app_id     = excluded.app_id,
         status     = excluded.status,
         kind       = excluded.kind,
         severity   = excluded.severity,
         item       = excluded.item`,
      item.id,
      item.createdAt,
      item.updatedAt,
      item.appId,
      item.status,
      item.kind,
      item.severity ?? null,
      JSON.stringify(item),
    );
  }

  protected async appendNew(item: FeedbackItem): Promise<void> {
    this.assertOpen();
    this.insertRow(item);
  }

  protected async putItem(item: FeedbackItem): Promise<void> {
    this.assertOpen();
    this.insertRow(item);
  }

  protected async patchItem(delta: FeedbackLinkageDelta): Promise<void> {
    this.assertOpen();
    await this.mutate(async () => {
      const current = await this.readItem(delta.id);
      // A patch for an item we do not hold has nothing to merge onto — the
      // same no-op the JSONL fold performs for an orphaned delta line.
      if (!current) return;
      this.insertRow(applyLinkageDelta(current, delta));
    });
  }

  /**
   * In-process ordering first, then the transaction. `BEGIN IMMEDIATE` guards
   * other PROCESSES; it does not stop two concurrent awaits on this same
   * connection from interleaving a read-modify-write, and SQLite rejects a
   * nested BEGIN on one connection outright.
   */
  protected async mutate<T>(run: () => Promise<T>): Promise<T> {
    this.assertOpen();
    return this.serialise(async () => {
      this.db.run("BEGIN IMMEDIATE");
      try {
        const result = await run();
        this.db.run("COMMIT");
        return result;
      } catch (error) {
        this.db.run("ROLLBACK");
        throw error;
      }
    });
  }

  async readAll(): Promise<FeedbackItem[]> {
    this.assertOpen();
    const rows = this.db.query("SELECT item FROM feedback_items ORDER BY created_at DESC").all() as {
      item: string;
    }[];
    return rows.map((row) => parseStoredFeedbackItem(JSON.parse(row.item)));
  }

  protected override async readItem(id: string): Promise<FeedbackItem | null> {
    this.assertOpen();
    const row = this.db.query("SELECT item FROM feedback_items WHERE id = ?").get(id) as
      | { item: string }
      | undefined
      | null;
    return row ? parseStoredFeedbackItem(JSON.parse(row.item)) : null;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error(`The feedback SQLite store at ${this.databasePath} is closed.`);
  }

  /** Release the database handle. Safe to call more than once. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
