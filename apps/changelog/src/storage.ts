import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ChangelogCreateOptions,
  ChangelogEntry,
  ChangelogEntryInput,
  ChangelogEntryListFilter,
  ChangelogEntryUpdate,
  ChangelogStats,
  ChangelogStore,
} from "./types.js";
import {
  changelogKinds,
  parseChangelogEntryInput,
  parseChangelogEntryUpdate,
  parseStoredChangelogEntry,
} from "./validation.js";

export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "changelog");
export const DEFAULT_CHANGELOG_FILE = "entries.jsonl";

export interface LocalChangelogStoreOptions {
  dataDir?: string;
  filePath?: string;
}

export function resolveChangelogDataDir(dataDir = process.env["CHANGELOG_DATA_DIR"]): string {
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export function resolveChangelogFilePath(options: LocalChangelogStoreOptions = {}): string {
  return options.filePath ?? join(resolveChangelogDataDir(options.dataDir), DEFAULT_CHANGELOG_FILE);
}

function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function emptyStats(): ChangelogStats {
  return {
    total: 0,
    byApp: {},
    byVersion: {},
    byKind: Object.fromEntries(changelogKinds.map((kind) => [kind, 0])) as ChangelogStats["byKind"],
  };
}

function applyFilter(items: ChangelogEntry[], filter: ChangelogEntryListFilter = {}): ChangelogEntry[] {
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  const kind = filter.kind ?? filter.category;
  return items
    .filter((item) => !filter.appId || item.appId === filter.appId)
    .filter((item) => !filter.version || item.version === filter.version)
    .filter((item) => !kind || item.kind === kind)
    .filter((item) => !filter.tag || item.tags.includes(filter.tag.toLowerCase()))
    .sort((a, b) => `${b.date}T${b.createdAt}`.localeCompare(`${a.date}T${a.createdAt}`))
    .slice(0, limit);
}

export class LocalChangelogStore implements ChangelogStore {
  readonly filePath: string;

  constructor(options: LocalChangelogStoreOptions = {}) {
    this.filePath = resolveChangelogFilePath(options);
    ensureParentDir(this.filePath);
  }

  async createEntry(input: ChangelogEntryInput, options: ChangelogCreateOptions = {}): Promise<ChangelogEntry> {
    const now = options.now ?? new Date();
    const timestamp = now.toISOString();
    const parsed = parseChangelogEntryInput(input, now);
    const item: ChangelogEntry = {
      ...parsed,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      source: options.source ?? "server",
    };
    await appendFile(this.filePath, `${JSON.stringify(item)}\n`, "utf8");
    return item;
  }

  async listEntries(filter: ChangelogEntryListFilter = {}): Promise<ChangelogEntry[]> {
    return applyFilter(await this.readAll(), filter);
  }

  async getEntry(id: string): Promise<ChangelogEntry | null> {
    return (await this.readAll()).find((item) => item.id === id) ?? null;
  }

  async updateEntry(id: string, update: ChangelogEntryUpdate): Promise<ChangelogEntry | null> {
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const current = items[index]!;
    const parsedUpdate = parseChangelogEntryUpdate(update);
    const parsed = parseChangelogEntryInput({
      appId: parsedUpdate.appId ?? current.appId,
      version: parsedUpdate.version ?? current.version,
      kind: parsedUpdate.kind ?? parsedUpdate.category ?? current.kind,
      title: parsedUpdate.title ?? current.title,
      message: parsedUpdate.message ?? current.message,
      details: parsedUpdate.details ?? parsedUpdate.body ?? current.details,
      date: parsedUpdate.date ?? current.date,
      author: parsedUpdate.author ?? current.author,
      tags: parsedUpdate.tags ?? current.tags,
      links: parsedUpdate.links ?? current.links,
      commits: parsedUpdate.commits ?? current.commits,
      tasks: parsedUpdate.tasks ?? current.tasks,
      metadata: parsedUpdate.metadata ?? current.metadata,
    });
    const updated: ChangelogEntry = {
      ...current,
      ...parsed,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      source: current.source,
    };
    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  async stats(): Promise<ChangelogStats> {
    const stats = emptyStats();
    for (const item of await this.readAll()) {
      stats.total += 1;
      stats.byApp[item.appId] = (stats.byApp[item.appId] ?? 0) + 1;
      stats.byVersion[item.version] = (stats.byVersion[item.version] ?? 0) + 1;
      stats.byKind[item.kind] += 1;
    }
    return stats;
  }

  async exportJsonl(filter: ChangelogEntryListFilter = {}): Promise<string> {
    const items = await this.listEntries({ ...filter, limit: filter.limit ?? 500 });
    return items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : "");
  }

  async readAll(): Promise<ChangelogEntry[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseStoredChangelogEntry(JSON.parse(line)));
  }

  private async writeAll(items: ChangelogEntry[]): Promise<void> {
    ensureParentDir(this.filePath);
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, items.map((item) => JSON.stringify(item)).join("\n") + (items.length ? "\n" : ""), "utf8");
    await rename(tmpPath, this.filePath);
  }
}

