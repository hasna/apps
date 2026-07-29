/**
 * @hasna/knowledge — unified knowledge-item Store abstraction.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE interface, two transports:
 *   - LocalItemStore  -> on-box JSON store (db.json) behind a file lock.
 *   - ApiItemStore    -> HTTP `/v1` + bearer key (cloud) via
 *                        @hasna/contracts client transport.
 *
 * Mode resolver: an EXPLICIT mode var (`HASNA_KNOWLEDGE_STORAGE_MODE=cloud` and
 * its aliases, see knowledge-mode.ts) selects the api transport; everything else
 * — including a machine whose shell exports HASNA_KNOWLEDGE_API_URL and
 * HASNA_KNOWLEDGE_API_KEY — is local. Presence of a URL or key is a pointer, not
 * a selection: it says where the cloud is, not that this process should write to
 * it. An explicit `--store` path override always pins to the local
 * transport (fully reversible).
 *
 * EVERY knowledge-item CLI command routes through this Store. No item command
 * touches the JSON file or the HTTP client directly — that is the split-brain
 * bug this abstraction eliminates.
 */
import { existsSync } from 'node:fs';
import {
  loadStore,
  loadStoreIfExists,
  saveStore,
  withLock,
  makeId,
  makeShortId,
  type KnowledgeItem,
} from './store';
import { resolveKnowledgeCloudStore, fetchAllCloudItems, type KnowledgeCloudStore } from './cloud-store';

export interface ItemCreateInput {
  /** Optional caller-supplied id (upsert/import). Both transports honor it: the
   * local store persists it; the API transport forwards it and the server upserts
   * on it, so re-invocation updates the same row instead of duplicating. */
  id?: string;
  title: string;
  content: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ItemPatch {
  title?: string;
  content?: string;
  url?: string | null;
  /** Full replacement tag set (callers compute add/remove before patching). */
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export interface ItemListResult {
  items: KnowledgeItem[];
  /** Whether the backing store exists (always true for the API transport). */
  exists: boolean;
}

/** The single knowledge-item storage surface every item command routes through. */
export interface ItemStore {
  readonly kind: 'local' | 'api';
  /** storePath (local) or `<origin>/v1` base URL (api) — never contains secrets. */
  readonly location: string;
  /** Whether the backing store currently exists (api transport is always true). */
  readonly exists: boolean;
  /** Every item including archived; callers filter/sort/paginate. */
  listAll(): Promise<ItemListResult>;
  get(idOrShort: string): Promise<KnowledgeItem | null>;
  create(input: ItemCreateInput): Promise<KnowledgeItem>;
  update(idOrShort: string, patch: ItemPatch): Promise<KnowledgeItem | null>;
  delete(idOrShort: string): Promise<boolean>;
  /** Delete many ids at once (prune/dedupe). Returns the count removed. */
  deleteMany(idsOrShorts: string[]): Promise<number>;
}

function matchesId(item: KnowledgeItem, idOrShort: string): boolean {
  return item.id === idOrShort || item.short_id === idOrShort;
}

class LocalItemStore implements ItemStore {
  readonly kind = 'local' as const;
  constructor(private readonly storePath: string) {}

  get location(): string {
    return this.storePath;
  }

  get exists(): boolean {
    return existsSync(this.storePath);
  }

  async listAll(): Promise<ItemListResult> {
    const store = loadStoreIfExists(this.storePath);
    return { items: store.items, exists: store.exists };
  }

  async get(idOrShort: string): Promise<KnowledgeItem | null> {
    const store = loadStoreIfExists(this.storePath);
    return store.items.find((item) => matchesId(item, idOrShort)) ?? null;
  }

  async create(input: ItemCreateInput): Promise<KnowledgeItem> {
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const now = new Date().toISOString();
      const id = input.id ?? makeId();
      const item: KnowledgeItem = {
        id,
        short_id: makeShortId(id),
        title: input.title,
        content: input.content,
        url: input.url ?? null,
        tags: input.tags ?? [],
        metadata: input.metadata ?? {},
        archived: false,
        created_at: now,
        updated_at: now,
      };
      db.items.push(item);
      saveStore(this.storePath, db);
      return item;
    }, { createParent: true });
  }

  async update(idOrShort: string, patch: ItemPatch): Promise<KnowledgeItem | null> {
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const idx = db.items.findIndex((item) => matchesId(item, idOrShort));
      if (idx === -1) return null;
      const item = db.items[idx];
      if (patch.title !== undefined) item.title = patch.title;
      if (patch.content !== undefined) item.content = patch.content;
      if (patch.url !== undefined) item.url = patch.url;
      if (patch.tags !== undefined) item.tags = patch.tags;
      if (patch.metadata !== undefined) item.metadata = patch.metadata;
      if (patch.archived !== undefined) item.archived = patch.archived;
      item.updated_at = new Date().toISOString();
      db.items[idx] = item;
      saveStore(this.storePath, db);
      return item;
    }, { createParent: true });
  }

  async delete(idOrShort: string): Promise<boolean> {
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const before = db.items.length;
      db.items = db.items.filter((item) => !matchesId(item, idOrShort));
      const removed = before !== db.items.length;
      if (removed) saveStore(this.storePath, db);
      return removed;
    }, { createParent: true });
  }

  async deleteMany(idsOrShorts: string[]): Promise<number> {
    if (idsOrShorts.length === 0) return 0;
    const targets = new Set(idsOrShorts);
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const before = db.items.length;
      db.items = db.items.filter((item) => !targets.has(item.id) && !(item.short_id != null && targets.has(item.short_id)));
      const removed = before - db.items.length;
      if (removed > 0) saveStore(this.storePath, db);
      return removed;
    }, { createParent: true });
  }
}

class ApiItemStore implements ItemStore {
  readonly kind = 'api' as const;
  readonly exists = true;
  constructor(private readonly cloud: KnowledgeCloudStore) {}

  get location(): string {
    return this.cloud.baseUrl;
  }

  async listAll(): Promise<ItemListResult> {
    return { items: await fetchAllCloudItems(this.cloud), exists: true };
  }

  async get(idOrShort: string): Promise<KnowledgeItem | null> {
    return this.cloud.get(idOrShort);
  }

  async create(input: ItemCreateInput): Promise<KnowledgeItem> {
    // A caller-supplied `id` (upsert / import) IS forwarded: the server upserts
    // on it, so `upsert --id <stable>` re-finds and updates the same row instead
    // of creating a duplicate — identical to the local store. When absent, the
    // server assigns the id.
    return this.cloud.create({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      content: input.content,
      url: input.url ?? null,
      tags: input.tags ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  async update(idOrShort: string, patch: ItemPatch): Promise<KnowledgeItem | null> {
    return this.cloud.update(idOrShort, patch);
  }

  async delete(idOrShort: string): Promise<boolean> {
    return this.cloud.delete(idOrShort);
  }

  async deleteMany(idsOrShorts: string[]): Promise<number> {
    let removed = 0;
    for (const id of idsOrShorts) {
      if (await this.cloud.delete(id)) removed += 1;
    }
    return removed;
  }
}

export interface ResolveItemStoreOptions {
  storePath: string;
  /** When the caller passed an explicit `--store`, pin to the local transport. */
  storePathOverridden: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the single item Store for this invocation. Returns the ApiItemStore
 * only when the mode is explicitly cloud, otherwise the LocalItemStore. An
 * explicit `--store` override always yields the local transport so the flip
 * stays fully reversible.
 */
export function resolveItemStore(options: ResolveItemStoreOptions): ItemStore {
  const cloud = options.storePathOverridden ? null : resolveKnowledgeCloudStore(options.env ?? process.env);
  if (cloud) return new ApiItemStore(cloud);
  return new LocalItemStore(options.storePath);
}
