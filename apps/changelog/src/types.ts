export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type ChangelogKind = "added" | "changed" | "deprecated" | "removed" | "fixed" | "security" | "other";
export type ChangelogCategory = ChangelogKind;
export type ChangelogSource = "api" | "cli" | "sdk" | "mcp" | "server";

export interface ChangelogLink {
  label?: string;
  url: string;
}

export interface ChangelogEntryInput {
  appId: string;
  version?: string;
  kind?: ChangelogKind;
  category?: ChangelogCategory;
  title: string;
  message?: string;
  details?: string;
  body?: string;
  date?: string;
  author?: string;
  tags?: string[];
  links?: ChangelogLink[];
  commits?: string[];
  tasks?: string[];
  metadata?: JsonObject;
}

export interface ParsedChangelogEntryInput extends ChangelogEntryInput {
  appId: string;
  version: string;
  kind: ChangelogKind;
  category: ChangelogCategory;
  title: string;
  date: string;
  tags: string[];
  links: ChangelogLink[];
  commits: string[];
  tasks: string[];
}

export interface ChangelogEntry extends ParsedChangelogEntryInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  source: ChangelogSource;
}

export interface ChangelogEntryUpdate {
  appId?: string;
  version?: string;
  kind?: ChangelogKind;
  category?: ChangelogCategory;
  title?: string;
  message?: string;
  details?: string;
  body?: string;
  date?: string;
  author?: string;
  tags?: string[];
  links?: ChangelogLink[];
  commits?: string[];
  tasks?: string[];
  metadata?: JsonObject;
}

export interface ChangelogEntryListFilter {
  appId?: string;
  version?: string;
  kind?: ChangelogKind;
  category?: ChangelogCategory;
  tag?: string;
  limit?: number;
}

export interface ChangelogStats {
  total: number;
  byApp: Record<string, number>;
  byVersion: Record<string, number>;
  byKind: Record<ChangelogKind, number>;
}

export interface ChangelogCreateOptions {
  source?: ChangelogSource;
  now?: Date;
}

export interface ChangelogStore {
  createEntry(input: ChangelogEntryInput, options?: ChangelogCreateOptions): Promise<ChangelogEntry>;
  listEntries(filter?: ChangelogEntryListFilter): Promise<ChangelogEntry[]>;
  getEntry(id: string): Promise<ChangelogEntry | null>;
  updateEntry(id: string, update: ChangelogEntryUpdate): Promise<ChangelogEntry | null>;
  stats(): Promise<ChangelogStats>;
  exportJsonl(filter?: ChangelogEntryListFilter): Promise<string>;
}

export interface GenerateChangelogOptions {
  appId?: string;
  version?: string;
  kind?: ChangelogKind;
  category?: ChangelogCategory;
  tag?: string;
  limit?: number;
  title?: string;
  includeIntro?: boolean;
}

export interface PublishChangelogOptions extends GenerateChangelogOptions {
  store?: ChangelogStore;
  entries?: ChangelogEntry[];
  targetPath?: string;
  cwd?: string;
  write?: boolean;
}

export interface PublishChangelogResult {
  mode: "dry-run" | "write";
  targetPath: string;
  markdown: string;
  changed: boolean;
  bytes: number;
}
