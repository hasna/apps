/**
 * @hasna/knowledge — unified knowledge-item Store abstraction.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE interface, two transports:
 *   - LocalItemStore  -> on-box JSON store (db.json) behind a file lock.
 *   - ApiItemStore    -> HTTP `/v1` + bearer key via
 *                        @hasna/contracts client transport.
 *
 * A credential resolved through the shared @hasna/contracts chain (Keychain
 * item, ~/.hasna/knowledge/config/credentials, HASNA_KNOWLEDGE_API_KEY, or a
 * deliberate override/pointer) selects the HTTP transport, against
 * HASNA_KNOWLEDGE_API_URL or the fleet gateway. The on-box transport applies
 * only under the explicit `HASNA_KNOWLEDGE_LOCAL=1` opt-in (which says "local"
 * on stderr) or an explicit `--store` path override. With no credential and no
 * opt-in the invocation FAILS CLOSED instead of dropping here (see
 * client-transport.ts) — no sqlite, no local-fallback event.
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
  type KnowledgeItemVersion,
  type KnowledgeItemVersionList,
} from './store';
import {
  KnowledgeVersionConflictError,
  resolveKnowledgeHttpStore,
  fetchAllHttpItems,
  type KnowledgeHttpStore,
} from './http-store';

export { KnowledgeVersionConflictError };

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

export interface ItemUpdateOptions {
  /**
   * Optimistic concurrency guard — the version the caller last read. Honoured
   * by BOTH transports: the api store sends it as `If-Match` and the server
   * checks it against the row; the local JSON store checks it against the
   * same lock-protected counter it bumps on every successful write, so the
   * check and the write happen inside one file-lock acquisition. Omit it to
   * skip the check entirely (unconditional overwrite — the pre-existing
   * behaviour, unchanged, on both stores). A mismatch throws
   * {@link KnowledgeVersionConflictError} naming both the version the caller
   * expected and the version actually stored; nothing is written.
   */
  expectedVersion?: number;
}

export type ItemArchiveFilter = 'active' | 'archived' | 'all';
export type ItemListSort = 'created' | 'title';
export type ItemListDirection = 'asc' | 'desc';

/**
 * Bounded list query shared by the SQLite and HTTP transports.
 *
 * `search` is deliberately a literal case-insensitive match over full id,
 * title, and content. Ranked full-text/semantic retrieval is a separate
 * producer query and must not change the long-standing `knowledge list`
 * compatibility contract.
 */
export interface ItemListOptions {
  search?: string;
  tags?: string[];
  archive?: ItemArchiveFilter;
  sort?: ItemListSort;
  direction?: ItemListDirection;
  limit?: number;
  offset?: number;
}

export interface ItemListResult {
  items: KnowledgeItem[];
  total: number;
  /** Whether the backing store exists (always true for the API transport). */
  exists: boolean;
}

/**
 * Raised when version history is asked of a backend that does not keep any.
 *
 * This is an ERROR, deliberately, and not an empty list. An empty list would be
 * indistinguishable from "this entry has never been edited", which is exactly
 * how the sibling implementation reported a memory sitting at version 4 with
 * zero retained bodies — a true-looking answer that was not a measurement. A
 * store with no history must say so.
 */
export class VersionHistoryUnsupportedError extends Error {
  readonly code = 'version_history_unsupported';
  constructor(readonly location: string) {
    super(
      'Version history is not kept by the local JSON knowledge store '
        + `(${location}). It has no version line, so an empty history here would be a claim, not a measurement. `
        + 'Entry versioning lives behind the server API: set HASNA_KNOWLEDGE_API_URL '
        + 'and HASNA_KNOWLEDGE_API_KEY, then re-run.',
    );
    this.name = 'VersionHistoryUnsupportedError';
  }
}

/** The single knowledge-item storage surface every item command routes through. */
export interface ItemStore {
  readonly kind: 'local' | 'api';
  /** storePath (local) or `<origin>/v1` base URL (api) — never contains secrets. */
  readonly location: string;
  /** Whether the backing store currently exists (api transport is always true). */
  readonly exists: boolean;
  /** Whether this transport retains entry history at all. */
  readonly supportsVersions: boolean;
  /** Bounded, producer-side list query. */
  list(options?: ItemListOptions): Promise<ItemListResult>;
  /** Every item including archived; retained only for genuine bulk operations. */
  listAll(): Promise<ItemListResult>;
  get(idOrShort: string): Promise<KnowledgeItem | null>;
  create(input: ItemCreateInput): Promise<KnowledgeItem>;
  update(idOrShort: string, patch: ItemPatch, options?: ItemUpdateOptions): Promise<KnowledgeItem | null>;
  delete(idOrShort: string): Promise<boolean>;
  /** Delete many ids at once (prune/dedupe). Returns the count removed. */
  deleteMany(idsOrShorts: string[]): Promise<number>;
  /**
   * Prior versions of an entry, newest first. `null` means NO SUCH ENTRY; an
   * entry that exists but was never edited yields an empty `items` array.
   * Throws {@link VersionHistoryUnsupportedError} on a store without history.
   */
  listVersions(
    idOrShort: string,
    options?: { limit?: number; offset?: number },
  ): Promise<KnowledgeItemVersionList | null>;
  /** One prior snapshot by version number. */
  getVersion(idOrShort: string, version: number): Promise<KnowledgeItemVersion | null>;
  /**
   * Permanently purge retained prior versions of an entry — the secret-hygiene
   * capability that makes a credential-bearing retained version stop being
   * reachable. `null` means NO SUCH ENTRY. Without `version`, every retained
   * prior version is deleted; with `version`, only that one. The live row is
   * never a target, and the operation never reads or returns the retained body.
   */
  purgeVersions(
    idOrShort: string,
    options?: { version?: number },
  ): Promise<{ purged: number; current_version: number } | null>;
}

function matchesId(item: KnowledgeItem, idOrShort: string): boolean {
  return item.id === idOrShort || item.short_id === idOrShort;
}

function itemMatchesLiteralSearch(item: KnowledgeItem, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return (
    item.id.toLowerCase().includes(query)
    || item.title.toLowerCase().includes(query)
    || item.content.toLowerCase().includes(query)
  );
}

function itemMatchesTagFilters(item: KnowledgeItem, rawFilters: readonly string[]): boolean {
  if (rawFilters.length === 0) return true;
  const itemTags = new Set((item.tags ?? []).map((tag) => tag.toLowerCase()));
  return rawFilters.every((raw) => {
    const whole = raw.trim().toLowerCase();
    const parts = raw
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    return (whole.length > 0 && itemTags.has(whole))
      || (parts.length > 0 && parts.every((tag) => itemTags.has(tag)));
  });
}

function compareItems(
  left: KnowledgeItem,
  right: KnowledgeItem,
  sort: ItemListSort,
  direction: ItemListDirection,
): number {
  const primary = sort === 'title'
    ? left.title.localeCompare(right.title)
    : left.created_at.localeCompare(right.created_at);
  const deterministic = primary === 0 ? left.id.localeCompare(right.id) : primary;
  return direction === 'desc' ? -deterministic : deterministic;
}

function boundedListInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return resolved;
}

function boundedLocalList(items: readonly KnowledgeItem[], options: ItemListOptions): {
  items: KnowledgeItem[];
  total: number;
} {
  const archive = options.archive ?? 'active';
  const sort = options.sort ?? 'created';
  const direction = options.direction ?? 'asc';
  const limit = boundedListInteger(options.limit, 50, 'limit', 1, 200);
  const offset = boundedListInteger(options.offset, 0, 'offset', 0, 10_000);
  let filtered = items.filter((item) => (
    archive === 'all'
    || (archive === 'archived' ? item.archived === true : item.archived !== true)
  ));
  if (options.search) {
    filtered = filtered.filter((item) => itemMatchesLiteralSearch(item, options.search!));
  }
  if (options.tags?.length) {
    filtered = filtered.filter((item) => itemMatchesTagFilters(item, options.tags!));
  }
  filtered.sort((left, right) => compareItems(left, right, sort, direction));
  return {
    total: filtered.length,
    items: filtered.slice(offset, offset + limit),
  };
}

class LocalItemStore implements ItemStore {
  readonly kind = 'local' as const;
  readonly supportsVersions = false;
  constructor(private readonly storePath: string) {}

  async listVersions(): Promise<KnowledgeItemVersionList | null> {
    throw new VersionHistoryUnsupportedError(this.storePath);
  }

  async getVersion(): Promise<KnowledgeItemVersion | null> {
    throw new VersionHistoryUnsupportedError(this.storePath);
  }

  async purgeVersions(): Promise<{ purged: number; current_version: number } | null> {
    throw new VersionHistoryUnsupportedError(this.storePath);
  }

  get location(): string {
    return this.storePath;
  }

  get exists(): boolean {
    return existsSync(this.storePath);
  }

  async list(options: ItemListOptions = {}): Promise<ItemListResult> {
    const store = loadStoreIfExists(this.storePath);
    const result = boundedLocalList(store.items, options);
    return { ...result, exists: store.exists };
  }

  async listAll(): Promise<ItemListResult> {
    const store = loadStoreIfExists(this.storePath);
    return { items: store.items, total: store.items.length, exists: store.exists };
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
        // Optimistic-concurrency counter — see the field's doc in store.ts.
        // Distinct from version HISTORY (supportsVersions stays false: no
        // retained prior bodies), this is just a number this same class bumps
        // on every write, so `--if-version` has something real to check.
        version: 1,
      };
      db.items.push(item);
      saveStore(this.storePath, db);
      return item;
    }, { createParent: true });
  }

  async update(idOrShort: string, patch: ItemPatch, options: ItemUpdateOptions = {}): Promise<KnowledgeItem | null> {
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const idx = db.items.findIndex((item) => matchesId(item, idOrShort));
      if (idx === -1) return null;
      const item = db.items[idx];
      // Pre-existing items written before this counter existed carry no
      // `version` field at all; read them as version 1 (never edited under
      // this scheme yet) rather than defaulting the CHECK away. The check and
      // the write below both happen inside this one file-lock acquisition, so
      // two local processes racing on the same db.json cannot both "succeed"
      // against the same expected version.
      const storedVersion = item.version ?? 1;
      if (options.expectedVersion !== undefined && options.expectedVersion !== storedVersion) {
        throw new KnowledgeVersionConflictError(options.expectedVersion, storedVersion);
      }
      if (patch.title !== undefined) item.title = patch.title;
      if (patch.content !== undefined) item.content = patch.content;
      if (patch.url !== undefined) item.url = patch.url;
      if (patch.tags !== undefined) item.tags = patch.tags;
      if (patch.metadata !== undefined) item.metadata = patch.metadata;
      if (patch.archived !== undefined) item.archived = patch.archived;
      item.updated_at = new Date().toISOString();
      item.version = storedVersion + 1;
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
  readonly supportsVersions = true;
  constructor(private readonly http: KnowledgeHttpStore) {}

  async listVersions(idOrShort: string, options: { limit?: number; offset?: number } = {}) {
    return this.http.listVersions(idOrShort, options);
  }

  async getVersion(idOrShort: string, version: number) {
    return this.http.getVersion(idOrShort, version);
  }

  async purgeVersions(idOrShort: string, options: { version?: number } = {}) {
    return this.http.purgeVersions(idOrShort, options);
  }

  get location(): string {
    return this.http.baseUrl;
  }

  async list(options: ItemListOptions = {}): Promise<ItemListResult> {
    const result = await this.http.list({
      search: options.search,
      tags: options.tags,
      archive: options.archive,
      sort: options.sort,
      direction: options.direction,
      limit: options.limit,
      offset: options.offset,
    });
    return {
      items: result.items,
      total: result.total,
      exists: true,
    };
  }

  async listAll(): Promise<ItemListResult> {
    const items = await fetchAllHttpItems(this.http);
    return { items, total: items.length, exists: true };
  }

  async get(idOrShort: string): Promise<KnowledgeItem | null> {
    return this.http.get(idOrShort);
  }

  async create(input: ItemCreateInput): Promise<KnowledgeItem> {
    // A caller-supplied `id` (upsert / import) IS forwarded: the server upserts
    // on it, so `upsert --id <stable>` re-finds and updates the same row instead
    // of creating a duplicate — identical to the local store. When absent, the
    // server assigns the id.
    return this.http.create({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      content: input.content,
      url: input.url ?? null,
      tags: input.tags ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  async update(idOrShort: string, patch: ItemPatch, options: ItemUpdateOptions = {}): Promise<KnowledgeItem | null> {
    return this.http.update(idOrShort, patch, { expectedVersion: options.expectedVersion });
  }

  async delete(idOrShort: string): Promise<boolean> {
    return this.http.delete(idOrShort);
  }

  async deleteMany(idsOrShorts: string[]): Promise<number> {
    let removed = 0;
    for (const id of idsOrShorts) {
      if (await this.http.delete(id)) removed += 1;
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
 * when the shared chain resolves a credential, otherwise the LocalItemStore —
 * which is reachable only because the caller already opted in (explicit
 * `HASNA_KNOWLEDGE_LOCAL=1` or an explicit `--store` path override); without
 * either, `resolveKnowledgeHttpStore` throws and this fails closed. An
 * explicit `--store` override always yields the local transport so the flip
 * stays fully reversible.
 */
export function resolveItemStore(options: ResolveItemStoreOptions): ItemStore {
  const http = options.storePathOverridden ? null : resolveKnowledgeHttpStore(options.env ?? process.env);
  if (http) return new ApiItemStore(http);
  return new LocalItemStore(options.storePath);
}
