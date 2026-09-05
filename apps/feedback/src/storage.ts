import { existsSync, mkdirSync } from "node:fs";
import { appendFile, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FeedbackItem, FeedbackStore } from "./types.js";
import { createTaskSink } from "./tasks.js";
import type { FeedbackTaskSink } from "./tasks.js";
import type { FeedbackLinkageDelta } from "./validation.js";
import { createDefaultFeedbackEventSink } from "./events.js";
import type { FeedbackEventSink } from "./events.js";
import {
  FeedbackStoreBase,
  FeedbackStoreBusyError,
  foldFeedbackRecords,
  serialiseFeedbackJsonl,
} from "./storage.base.js";
import {
  DEFAULT_FEEDBACK_FILE,
  ENV_PREFIX,
  readStorageEnv,
  resolveFeedbackDataDir,
  resolveFeedbackFilePath,
} from "./storage.paths.js";
import { SqliteFeedbackStore, resolveFeedbackSqlitePath } from "./storage.sqlite.js";

export { DEFAULT_FEEDBACK_FILE, ENV_PREFIX, resolveFeedbackDataDir, resolveFeedbackFilePath };
export {
  DEFAULT_SQLITE_FILE,
  SqliteFeedbackStore,
  migrateJsonlIntoSqlite,
  resolveFeedbackMigrationSource,
  resolveFeedbackSqlitePath,
} from "./storage.sqlite.js";
export type { FeedbackMigrationResult, SqliteFeedbackStoreOptions } from "./storage.sqlite.js";
export {
  FeedbackStoreBase,
  FeedbackStoreBusyError,
  applyFeedbackFilter,
  buildFeedbackSearchHaystack,
  computeFeedbackStats,
  serialiseFeedbackJsonl,
} from "./storage.base.js";

export interface LocalFeedbackStoreOptions {
  dataDir?: string;
  filePath?: string;
  /**
   * Sink for `feedback.created` / `feedback.triaged` event envelopes
   * (distribution event catalog). Defaults to emitting through
   * `@hasna/events`; pass `null` to disable emission.
   */
  eventSink?: FeedbackEventSink | null;
  /**
   * Sink that turns new feedback into a task an executor can pick up. Defaults
   * to the environment-resolved sink (`todos` when its CLI is present); pass
   * `null` to disable task creation.
   */
  taskSink?: FeedbackTaskSink | null;
}

/**
 * Where the store lives. `local` is on this machine; `cloud` is a
 * host-injected adapter.
 */
export type FeedbackStoreRuntimeMode = "local" | "cloud";
export type FeedbackStoreRuntimeDiagnosticMode = FeedbackStoreRuntimeMode | "invalid";

/**
 * Which backend holds the data. This is the axis the service contract names as
 * `storage.mode`, and it is separate from where the store lives: `sqlite` and
 * `jsonl` are both local.
 */
export type FeedbackStorageEngine = "sqlite" | "jsonl" | "postgres";

export interface FeedbackStoreRuntimeOptions {
  env?: Record<string, string | undefined>;
  local?: LocalFeedbackStoreOptions & { sqlitePath?: string };
  cloudStore?: FeedbackStore;
}

export interface FeedbackCloudRuntimeDiagnostics {
  provider: string;
  databaseUrlConfigured: boolean;
  resourceArnConfigured: boolean;
  secretArnConfigured: boolean;
  tableNameConfigured: boolean;
  adapterProvided: boolean;
  ready: boolean;
  blockers: string[];
}

export interface FeedbackStoreRuntimeDiagnostics {
  mode: FeedbackStoreRuntimeDiagnosticMode;
  requestedMode: FeedbackStoreRuntimeDiagnosticMode;
  /** Absent when the requested configuration is unsupported. */
  engine?: FeedbackStorageEngine;
  activeStore: "local-sqlite" | "local-jsonl" | "cloud-adapter" | "unavailable";
  ok: boolean;
  local?: {
    /** The file the active engine reads and writes. */
    dataFile: string;
    engine: "sqlite" | "jsonl";
    /** The legacy JSONL log, whether or not it is the active store. */
    jsonlPath: string;
  };
  cloud?: FeedbackCloudRuntimeDiagnostics;
  blockers: string[];
}

/**
 * Resolve the configured storage engine.
 *
 * SQLite is the default when nothing is set — that is the storage migration
 * this repo's contract-conformance doc calls item 1. An EXPLICIT setting is
 * never reinterpreted: `local`, `file` and `jsonl` all keep meaning the
 * append-only JSONL log, so a user who pinned the old behaviour still gets it.
 * Only the unset default moved.
 */
function engineFromEnv(env: Record<string, string | undefined>): FeedbackStorageEngine | "invalid" {
  const raw = (readStorageEnv(env, "STORE", ["FEEDBACK_STORAGE_BACKEND", `${ENV_PREFIX}STORAGE_BACKEND`]) ?? "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "sqlite" || raw === "db") return "sqlite";
  if (raw === "jsonl" || raw === "file" || raw === "local") return "jsonl";
  if (raw === "cloud" || raw === "rds" || raw === "postgres" || raw === "postgresql") return "postgres";
  return "invalid";
}

function cloudDiagnostics(options: FeedbackStoreRuntimeOptions): FeedbackCloudRuntimeDiagnostics {
  const env = options.env ?? process.env;
  const adapterProvided = Boolean(options.cloudStore);
  const provider = env["FEEDBACK_CLOUD_PROVIDER"]?.trim() || "custom";
  const databaseUrlConfigured = Boolean(env["FEEDBACK_CLOUD_DATABASE_URL"]?.trim());
  const resourceArnConfigured = Boolean(env["FEEDBACK_CLOUD_RESOURCE_ARN"]?.trim());
  const secretArnConfigured = Boolean(env["FEEDBACK_CLOUD_SECRET_ARN"]?.trim());
  const tableNameConfigured = Boolean(env["FEEDBACK_CLOUD_TABLE"]?.trim());
  const blockers: string[] = [];

  if (!adapterProvided) {
    blockers.push("Cloud storage mode requires a host-provided FeedbackStore adapter.");
  }

  return {
    provider,
    databaseUrlConfigured,
    resourceArnConfigured,
    secretArnConfigured,
    tableNameConfigured,
    adapterProvided,
    ready: blockers.length === 0,
    blockers,
  };
}

export function describeFeedbackStoreRuntime(
  options: FeedbackStoreRuntimeOptions = {},
): FeedbackStoreRuntimeDiagnostics {
  const env = options.env ?? process.env;
  const engine = engineFromEnv(env);

  if (engine === "sqlite" || engine === "jsonl") {
    const dataDir = options.local?.dataDir ?? readStorageEnv(env, "DATA_DIR");
    const jsonlPath = resolveFeedbackFilePath({ dataDir, filePath: options.local?.filePath });
    const dataFile =
      engine === "sqlite"
        ? resolveFeedbackSqlitePath({
            dataDir,
            sqlitePath: options.local?.sqlitePath ?? readStorageEnv(env, "SQLITE_PATH"),
          })
        : jsonlPath;
    return {
      mode: "local",
      requestedMode: "local",
      engine,
      activeStore: engine === "sqlite" ? "local-sqlite" : "local-jsonl",
      ok: true,
      local: { dataFile, engine, jsonlPath },
      blockers: [],
    };
  }

  if (engine === "postgres") {
    const cloud = cloudDiagnostics(options);
    return {
      mode: "cloud",
      requestedMode: "cloud",
      engine: "postgres",
      activeStore: cloud.adapterProvided ? "cloud-adapter" : "unavailable",
      ok: cloud.ready,
      cloud,
      blockers: cloud.blockers,
    };
  }

  return {
    mode: "invalid",
    requestedMode: "invalid",
    activeStore: "unavailable",
    ok: false,
    blockers: [
      "Unsupported FEEDBACK_STORE/FEEDBACK_STORAGE_BACKEND value. Use \"sqlite\", \"jsonl\", or \"postgres\".",
    ],
  };
}

export function createFeedbackStore(options: FeedbackStoreRuntimeOptions = {}): FeedbackStore {
  const env = options.env ?? process.env;
  const runtime = describeFeedbackStoreRuntime(options);

  if (runtime.engine === "sqlite") {
    return new SqliteFeedbackStore({
      dataDir: options.local?.dataDir ?? readStorageEnv(env, "DATA_DIR"),
      sqlitePath: options.local?.sqlitePath ?? readStorageEnv(env, "SQLITE_PATH"),
      eventSink: options.local?.eventSink,
      taskSink: options.local?.taskSink,
    });
  }
  if (runtime.engine === "jsonl") {
    return new LocalFeedbackStore({
      dataDir: options.local?.dataDir ?? readStorageEnv(env, "DATA_DIR"),
      filePath: options.local?.filePath,
      eventSink: options.local?.eventSink,
      taskSink: options.local?.taskSink,
    });
  }
  if (runtime.mode === "cloud" && options.cloudStore) {
    return options.cloudStore;
  }
  throw new Error(runtime.blockers.join(" "));
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withFileLock<T>(filePath: string, run: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.close();
      try {
        return await run();
      } finally {
        await rm(lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > 30_000) await rm(lockPath, { force: true });
      } catch {
        // Lock disappeared between attempts.
      }
      if (Date.now() > deadline) throw new FeedbackStoreBusyError(`Timed out waiting for feedback data lock: ${lockPath}`);
      await delay(50);
    }
  }
}

/**
 * The append-only JSONL store. No longer the default — see
 * {@link SqliteFeedbackStore} — but still fully supported, and selected with
 * `HASNA_FEEDBACK_STORE=jsonl`.
 */
export class LocalFeedbackStore extends FeedbackStoreBase {
  readonly filePath: string;

  constructor(options: LocalFeedbackStoreOptions = {}) {
    super(
      options.eventSink === null ? null : options.eventSink ?? createDefaultFeedbackEventSink(),
      options.taskSink === null ? null : options.taskSink ?? createTaskSink(),
    );
    this.filePath = resolveFeedbackFilePath(options);
    ensureParentDir(this.filePath);
  }

  /**
   * Append one record. The create path must stay append-only: rewriting the
   * whole file under the lock is O(n) and, under concurrency, blew the lock
   * deadline and dropped reports outright.
   */
  protected async appendNew(item: FeedbackItem): Promise<void> {
    await this.appendRecord(item);
  }

  /**
   * Record task linkage as a field-level patch. Never append a whole-item
   * snapshot for this: the snapshot predates task creation, and folding it as
   * a full record would revert any status change that landed meanwhile.
   */
  protected async patchItem(delta: FeedbackLinkageDelta): Promise<void> {
    await this.appendRecord(delta);
  }

  private async appendRecord(record: FeedbackItem | FeedbackLinkageDelta): Promise<void> {
    await withFileLock(this.filePath, async () => {
      await appendFile(this.filePath, `${JSON.stringify(record)}\n`, "utf8");
    });
  }

  /** Rewrite the log with this item folded in, compacting it to one record per item. */
  protected async putItem(item: FeedbackItem): Promise<void> {
    const items = await this.readAll();
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index === -1) items.push(item);
    else items[index] = item;
    await this.writeAll(items);
  }

  /**
   * In-process ordering first, then the cross-process lock file. The lock file
   * alone cannot serialise two concurrent awaits from this same process.
   */
  protected async mutate<T>(run: () => Promise<T>): Promise<T> {
    return this.serialise(() => withFileLock(this.filePath, run));
  }

  async readAll(): Promise<FeedbackItem[]> {
    if (!existsSync(this.filePath)) return [];
    return foldFeedbackRecords(await readFile(this.filePath, "utf8"));
  }

  private async writeAll(items: FeedbackItem[]): Promise<void> {
    ensureParentDir(this.filePath);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, serialiseFeedbackJsonl(items), "utf8");
    await rename(tmpPath, this.filePath);
  }
}
