import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  ChangelogCreateOptions,
  ChangelogEntry,
  ChangelogEntryInput,
  ChangelogEntryListFilter,
  ChangelogReleaseOptions,
  ChangelogReleaseResult,
  ChangelogEntryUpdate,
  ChangelogStats,
  ChangelogStore,
  ParsedChangelogEntryInput,
} from "./types.js";
import {
  changelogKinds,
  parseChangelogDate,
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

export function fingerprintChangelogEntry(input: ParsedChangelogEntryInput | ChangelogEntry): string {
  const payload = {
    appId: input.appId,
    version: input.version,
    kind: input.kind,
    title: input.title,
    commits: input.commits,
    tasks: input.tasks,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
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
    const fingerprint = fingerprintChangelogEntry(parsed);
    if (!options.allowDuplicate) {
      const duplicate = (await this.readAll()).find((item) =>
        item.appId === parsed.appId && (item.fingerprint ?? fingerprintChangelogEntry(item)) === fingerprint
      );
      if (duplicate) throw new Error(`Duplicate changelog entry: ${duplicate.id}`);
    }
    const item: ChangelogEntry = {
      ...parsed,
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      source: options.source ?? "server",
      fingerprint,
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
      fingerprint: fingerprintChangelogEntry(parsed),
    };
    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  async releaseEntries(options: ChangelogReleaseOptions): Promise<ChangelogReleaseResult> {
    const now = options.now ?? new Date();
    const date = parseChangelogDate(options.date, now);
    const fromVersion = options.fromVersion ?? "Unreleased";
    const parsedVersion = options.version.trim();
    if (!parsedVersion) throw new Error("version is required");
    if (!options.appId.trim()) throw new Error("appId is required");

    const items = await this.readAll();
    const sourceEntries = items.filter((item) => item.appId === options.appId && item.version === fromVersion);
    const candidateFingerprints = new Set<string>();
    for (const item of sourceEntries) {
      const candidate: ChangelogEntry = {
        ...item,
        version: parsedVersion,
        date,
      };
      const candidateFingerprint = fingerprintChangelogEntry(candidate);
      if (candidateFingerprints.has(candidateFingerprint)) {
        throw new Error(`Duplicate changelog entry would be released: ${item.id}`);
      }
      candidateFingerprints.add(candidateFingerprint);
      const existing = items.find((existingItem) =>
        existingItem.appId === options.appId &&
        existingItem.version === parsedVersion &&
        existingItem.id !== item.id &&
        (existingItem.fingerprint ?? fingerprintChangelogEntry(existingItem)) === candidateFingerprint
      );
      if (existing) throw new Error(`Duplicate released changelog entry: ${existing.id}`);
    }

    const released: ChangelogEntry[] = [];
    const timestamp = now.toISOString();
    const updatedItems = items.map((item) => {
      if (item.appId !== options.appId || item.version !== fromVersion) return item;
      const updated: ChangelogEntry = {
        ...item,
        version: parsedVersion,
        date,
        updatedAt: timestamp,
      };
      updated.fingerprint = fingerprintChangelogEntry(updated);
      released.push(updated);
      return updated;
    });
    if (released.length > 0) await this.writeAll(updatedItems);
    return {
      appId: options.appId,
      fromVersion,
      version: parsedVersion,
      date,
      updated: released.length,
      entries: released,
    };
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
