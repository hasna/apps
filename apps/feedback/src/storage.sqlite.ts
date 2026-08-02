import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { FeedbackItem } from "./types.js";
import type { FeedbackLinkageDelta } from "./validation.js";
import { parseStoredFeedbackItem } from "./validation.js";
import { createTaskSink } from "./tasks.js";
import type { FeedbackTaskSink } from "./tasks.js";
import { createDefaultFeedbackEventSink } from "./events.js";
import type { FeedbackEventSink } from "./events.js";
import {
  FeedbackStoreBase,
  FeedbackStoreBusyError,
  applyLinkageDelta,
  foldFeedbackRecords,
} from "./storage.base.js";
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

/**
 * SQLite reports contention as a driver error whose text and `code` a caller
 * has to recognise. Left untranslated it reaches the HTTP layer as an
 * unclassified throw, and `api.ts` reports a retryable server-side condition
 * to the client as a 400 — an instruction NOT to retry, which is precisely
 * backwards. {@link FeedbackStoreBusyError} exists to prevent that, and the
 * JSONL store already raises it on the same condition.
 */
function isSqliteBusy(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && (code === "SQLITE_BUSY" || code.startsWith("SQLITE_BUSY_"))) return true;
  if (code === 5 || code === 6) return true; // SQLITE_BUSY / SQLITE_LOCKED
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /database (?:table )?is locked|database is busy/i.test(message);
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
  /**
   * Where the one-time "imported N items" notice goes. `false` silences it;
   * the default writes to stderr so it cannot be mistaken for command output.
   */
  notify?: ((message: string) => void) | false;
}

export function resolveFeedbackSqlitePath(options: { dataDir?: string; sqlitePath?: string } = {}): string {
  return options.sqlitePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_SQLITE_FILE);
}

/**
 * Where the automatic import looks for a legacy `feedback.jsonl`.
 *
 * The DATA DIR is the primary candidate, not the database's own directory.
 * Those two are the same path in the default layout, which is why keying only
 * on the database directory looked correct — but the moment someone sets
 * `HASNA_FEEDBACK_SQLITE_PATH` to somewhere else, the source moves out from
 * under the lookup and the import reports `no-source`. That outcome is
 * indistinguishable from "this user never had any feedback", so the failure is
 * silent and reads as an empty store rather than as a skipped migration.
 *
 * The database's directory is kept as a second candidate so that a layout
 * which only ever worked because of the old behaviour still migrates.
 */
export function resolveFeedbackMigrationSource(options: {
  dataDir?: string;
  databasePath: string;
}): string {
  const candidates = [
    join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE),
    join(dirname(options.databasePath), DEFAULT_FEEDBACK_FILE),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
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
        : migrateJsonlIntoSqlite(
            this,
            resolveFeedbackMigrationSource({ dataDir: options.dataDir, databasePath: this.databasePath }),
          );

    // Announce a migration once, on the open that performed it. Rolling back to
    // the JSONL store is non-destructive but NOT lossless — anything written
    // after this point lands in SQLite only, and the source log will not have
    // it. A README paragraph is not where someone looks at the moment that
    // becomes true.
    if (this.migration.ran && this.migration.migrated > 0 && options.notify !== false) {
      const notify = options.notify ?? ((message: string) => console.error(message));
      notify(
        `[feedback] Imported ${this.migration.migrated} item(s) from ${this.migration.source} into ${this.databasePath}. ` +
          `The source log is left untouched, so HASNA_FEEDBACK_STORE=jsonl still works — but feedback recorded from now on ` +
          `goes to SQLite only and will not appear in the JSONL log.`,
      );
    }
  }

  /**
   * Two stores on ONE database file must share a mutation chain.
   *
   * `mutate` holds `BEGIN IMMEDIATE` across an `await`, and `bun:sqlite` is
   * synchronous. So a second CONNECTION's `BEGIN` blocks the single event loop
   * for the whole `busy_timeout`, and the first connection's `COMMIT` — which
   * can only run on that same loop — cannot complete. Self-deadlock, resolved
   * only by the timeout firing and the write being lost.
   *
   * Measured on the merged default shape, four ordinary writes over two stores:
   * before, `fulfilled=2 rejected=2 elapsed=10051ms`; after, 4/0 in tens of ms.
   * It is reachable by default because `createFeedbackHandler()` and
   * `buildFeedbackMcpTools()` each call `createFeedbackStore()`.
   */
  protected override serialisationKey(): string {
    return `sqlite:${resolvePath(this.databasePath)}`;
  }

  /** Run driver work, translating contention into the typed, retryable error. */
  private guard<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (isSqliteBusy(error)) {
        throw new FeedbackStoreBusyError(
          `Timed out waiting for the feedback SQLite write lock: ${this.databasePath}`,
        );
      }
      throw error;
    }
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
    const row = this.guard(() => this.db.query("SELECT value FROM feedback_meta WHERE key = ?").get(key)) as
      | { value: string }
      | undefined
      | null;
    return row?.value ?? null;
  }

  writeMeta(key: string, value: string): void {
    this.guard(() =>
      this.db.run(
        "INSERT INTO feedback_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value,
      ),
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
    return this.guard(() => {
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
    });
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
    // Serialised even though one INSERT is already atomic, because the hazard
    // here is not a torn write — it is the event loop. If another instance on
    // this database is mid-`mutate`, it holds `BEGIN IMMEDIATE` across an
    // await; a bare INSERT from here would block SYNCHRONOUSLY on that write
    // lock for the whole `busy_timeout`, and the holder's COMMIT runs on the
    // loop this call is occupying. That is the same self-deadlock `mutate`
    // suffered, reached through the create path instead.
    await this.serialise(async () => this.guard(() => this.insertRow(item)));
  }

  protected async putItem(item: FeedbackItem): Promise<void> {
    this.assertOpen();
    this.guard(() => this.insertRow(item));
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
      this.guard(() => this.db.run("BEGIN IMMEDIATE"));
      try {
        const result = await run();
        this.guard(() => this.db.run("COMMIT"));
        return result;
      } catch (error) {
        // A failed BEGIN leaves no transaction to roll back, and ROLLBACK then
        // throws "cannot rollback - no transaction is active", masking the real
        // cause. Best-effort so the original error is what reaches the caller.
        try {
          this.db.run("ROLLBACK");
        } catch {
          /* no active transaction */
        }
        throw error;
      }
    });
  }

  async readAll(): Promise<FeedbackItem[]> {
    this.assertOpen();
    const rows = this.guard(() =>
      this.db.query("SELECT item FROM feedback_items ORDER BY created_at DESC").all(),
    ) as { item: string }[];
    return rows.map((row) => parseStoredFeedbackItem(JSON.parse(row.item)));
  }

  protected override async readItem(id: string): Promise<FeedbackItem | null> {
    this.assertOpen();
    const row = this.guard(() => this.db.query("SELECT item FROM feedback_items WHERE id = ?").get(id)) as
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
