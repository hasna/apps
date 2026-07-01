import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
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

export function resolveFeedbackDataDir(dataDir = process.env["FEEDBACK_DATA_DIR"]): string {
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export function resolveFeedbackFilePath(options: LocalFeedbackStoreOptions = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
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

function applyFilter(items: FeedbackItem[], filter: FeedbackListFilter = {}): FeedbackItem[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  return items
    .filter((item) => !filter.appId || item.appId === filter.appId)
    .filter((item) => !filter.status || item.status === filter.status)
    .filter((item) => !filter.tag || item.tags.includes(filter.tag.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
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
    await appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    return item;
  }

  async listFeedback(filter: FeedbackListFilter = {}): Promise<FeedbackItem[]> {
    return applyFilter(await this.readAll(), filter);
  }

  async getFeedback(id: string): Promise<FeedbackItem | null> {
    return (await this.readAll()).find((item) => item.id === id) ?? null;
  }

  async updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<FeedbackItem | null> {
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
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
    await rename(tmpPath, this.filePath);
  }
}

