import { existsSync, mkdirSync } from "node:fs";
import { appendFile, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  FeedbackCreateOptions,
  FeedbackInput,
  FeedbackItem,
  FeedbackListFilter,
  FeedbackStats,
  FeedbackStatus,
  FeedbackStore,
} from "./types.js";
import { feedbackKinds, feedbackStatuses, parseFeedbackInput, parseStoredFeedbackItem } from "./validation.js";

export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "feedback");
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

export interface LocalFeedbackStoreOptions {
  dataDir?: string;
  filePath?: string;
}

export type FeedbackStoreRuntimeMode = "local" | "cloud";
export type FeedbackStoreRuntimeDiagnosticMode = FeedbackStoreRuntimeMode | "invalid";

export interface FeedbackStoreRuntimeOptions {
  env?: Record<string, string | undefined>;
  local?: LocalFeedbackStoreOptions;
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
  activeStore: "local-jsonl" | "cloud-adapter" | "unavailable";
  ok: boolean;
  local?: {
    dataFile: string;
  };
  cloud?: FeedbackCloudRuntimeDiagnostics;
  blockers: string[];
}

export function resolveFeedbackDataDir(dataDir = process.env["FEEDBACK_DATA_DIR"]): string {
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export function resolveFeedbackFilePath(options: LocalFeedbackStoreOptions = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
}

function runtimeModeFromEnv(env: Record<string, string | undefined>): FeedbackStoreRuntimeDiagnostics["mode"] {
  const rawMode = (env["FEEDBACK_STORE"] ?? env["FEEDBACK_STORAGE_BACKEND"] ?? "local").trim().toLowerCase();
  if (!rawMode || rawMode === "local" || rawMode === "jsonl" || rawMode === "file") return "local";
  if (rawMode === "cloud" || rawMode === "rds" || rawMode === "postgres" || rawMode === "postgresql") return "cloud";
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

export function describeFeedbackStoreRuntime(options: FeedbackStoreRuntimeOptions = {}): FeedbackStoreRuntimeDiagnostics {
  const env = options.env ?? process.env;
  const mode = runtimeModeFromEnv(env);
  const requestedMode = mode;

  if (mode === "local") {
    const dataFile = resolveFeedbackFilePath({
      dataDir: options.local?.dataDir ?? env["FEEDBACK_DATA_DIR"],
      filePath: options.local?.filePath,
    });
    return {
      mode,
      requestedMode,
      activeStore: "local-jsonl",
      ok: true,
      local: { dataFile },
      blockers: [],
    };
  }

  if (mode === "cloud") {
    const cloud = cloudDiagnostics(options);
    return {
      mode,
      requestedMode,
      activeStore: cloud.adapterProvided ? "cloud-adapter" : "unavailable",
      ok: cloud.ready,
      cloud,
      blockers: cloud.blockers,
    };
  }

  return {
    mode,
    requestedMode,
    activeStore: "unavailable",
    ok: false,
    blockers: [
      "Unsupported FEEDBACK_STORE/FEEDBACK_STORAGE_BACKEND value. Use \"local\" or \"cloud\".",
    ],
  };
}

export function createFeedbackStore(options: FeedbackStoreRuntimeOptions = {}): FeedbackStore {
  const runtime = describeFeedbackStoreRuntime(options);
  if (runtime.mode === "local") {
    return new LocalFeedbackStore({
      dataDir: options.local?.dataDir ?? options.env?.["FEEDBACK_DATA_DIR"],
      filePath: options.local?.filePath,
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

function emptyStats(): FeedbackStats {
  return {
    total: 0,
    byApp: {},
    byKind: Object.fromEntries(feedbackKinds.map((kind) => [kind, 0])) as FeedbackStats["byKind"],
    byStatus: Object.fromEntries(feedbackStatuses.map((status) => [status, 0])) as FeedbackStats["byStatus"],
    bySeverity: {},
  };
}

function parseDateFilter(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function searchHaystack(item: FeedbackItem): string {
  return [
    item.appId,
    item.message,
    item.kind,
    item.severity,
    item.status,
    item.userId,
    item.email,
    item.url,
    item.tags.join(" "),
    item.context ? JSON.stringify(item.context) : "",
    item.metadata ? JSON.stringify(item.metadata) : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function applyFilter(items: FeedbackItem[], filter: FeedbackListFilter = {}): FeedbackItem[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  const since = parseDateFilter(filter.since);
  const until = parseDateFilter(filter.until);
  const search = filter.search?.trim().toLowerCase();
  return items
    .filter((item) => !filter.appId || item.appId === filter.appId)
    .filter((item) => !filter.status || item.status === filter.status)
    .filter((item) => !filter.tag || item.tags.includes(filter.tag.toLowerCase()))
    .filter((item) => !since || item.createdAt >= since)
    .filter((item) => !until || item.createdAt <= until)
    .filter((item) => !search || searchHaystack(item).includes(search))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
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
      if (Date.now() > deadline) throw new Error(`Timed out waiting for feedback data lock: ${lockPath}`);
      await delay(50);
    }
  }
}

export class LocalFeedbackStore implements FeedbackStore {
  readonly filePath: string;

  constructor(options: LocalFeedbackStoreOptions = {}) {
    this.filePath = resolveFeedbackFilePath(options);
    ensureParentDir(this.filePath);
  }

  async createFeedback(input: FeedbackInput, options: FeedbackCreateOptions = {}): Promise<FeedbackItem> {
    const now = (options.now ?? new Date()).toISOString();
    const parsed = parseFeedbackInput(input);
    const item: FeedbackItem = {
      ...parsed,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      status: "new",
      source: options.source ?? "server",
      kind: parsed.kind ?? "other",
      tags: parsed.tags ?? [],
    };
    await withFileLock(this.filePath, async () => {
      await appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    });
    return item;
  }

  async listFeedback(filter: FeedbackListFilter = {}): Promise<FeedbackItem[]> {
    return applyFilter(await this.readAll(), filter);
  }

  async getFeedback(id: string): Promise<FeedbackItem | null> {
    return (await this.readAll()).find((item) => item.id === id) ?? null;
  }

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null> {
    return withFileLock(this.filePath, async () => {
      const items = await this.readAll();
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      const current = items[index]!;
      const updated: FeedbackItem = {
        ...current,
        status,
        updatedAt: new Date().toISOString(),
      };
      items[index] = updated;
      await this.writeAll(items);
      return updated;
    });
  }

  async stats(): Promise<FeedbackStats> {
    const stats = emptyStats();
    for (const item of await this.readAll()) {
      stats.total += 1;
      stats.byApp[item.appId] = (stats.byApp[item.appId] ?? 0) + 1;
      stats.byKind[item.kind] += 1;
      stats.byStatus[item.status] += 1;
      if (item.severity) stats.bySeverity[item.severity] = (stats.bySeverity[item.severity] ?? 0) + 1;
    }
    return stats;
  }

  async exportJsonl(filter: FeedbackListFilter = {}): Promise<string> {
    const items = await this.listFeedback({ ...filter, limit: filter.limit ?? 500 });
    return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
  }

  async readAll(): Promise<FeedbackItem[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseStoredFeedbackItem(JSON.parse(line)));
  }

  private async writeAll(items: FeedbackItem[]): Promise<void> {
    ensureParentDir(this.filePath);
    const tmpPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmpPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
    await rename(tmpPath, this.filePath);
  }
}
