/**
 * @hasna/knowledge — unified knowledge-item Store abstraction.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE interface, two transports:
 *   - LocalItemStore  -> on-box JSON store (db.json) behind a file lock.
 *   - ApiItemStore    -> HTTP `/v1` + bearer key (postgres backend) via
 *                        @hasna/contracts client transport.
 *
 * Mode resolver: an EXPLICIT mode var (`HASNA_KNOWLEDGE_STORAGE_MODE=postgres`)
 * selects the api transport; everything else
 * — including a machine whose shell exports HASNA_KNOWLEDGE_API_URL and
 * HASNA_KNOWLEDGE_API_KEY — is local. Presence of a URL or key is a pointer, not
 * a selection: it says where the API is, not that this process should write to
 * it. An explicit `--store` path override always pins to the local transport
 * (fully reversible).
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
  resolveKnowledgeCloudStore,
  fetchAllCloudItems,
  type KnowledgeCloudStore,
} from './cloud-store';
import { validateDescription, normalizeTaxonomyInput } from './knowledge-taxonomy';

export { KnowledgeVersionConflictError };

export interface ItemCreateInput {
  /** Optional caller-supplied id (upsert/import). Both transports honor it: the
   * local store persists it; the API transport forwards it and the server upserts
   * on it, so re-invocation updates the same row instead of duplicating. */
  id?: string;
  title: string;
  content: string;
  /**
   * REQUIRED at runtime by both transports — see `assertCreatable` below. It is
   * typed as required here so the compiler helps callers inside this package,
   * but the type is NOT the enforcement: this is a plain TypeScript interface,
   * erased at build time, and the MCP server (`mcp.js`) and any SDK consumer
   * reach `create` as untyped JavaScript. The runtime check is the floor.
   */
  description: string;
  /** Optional governance axes; validated against a closed vocabulary. */
  reach?: string | null;
  consequence?: string | null;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ItemPatch {
  title?: string;
  content?: string;
  /**
   * When present it must be VALID — a caller may not blank a description back
   * out once set. When absent the stored value is left untouched, so ordinary
   * edits (retag, retitle, archive) never have to restate it.
   */
  description?: string;
  reach?: string | null;
  consequence?: string | null;
  url?: string | null;
  /** Full replacement tag set (callers compute add/remove before patching). */
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

/**
 * The single runtime gate every create passes through, on BOTH transports.
 *
 * Placed here rather than in the CLI because the CLI is one of several callers:
 * the MCP server, the SDK facade, and `ingest`/import paths all reach the Store
 * directly. This is the same argument db/pg-migrations.ts makes for putting the
 * version bump in a trigger — the layer that sits below every writer is the
 * only one that cannot be bypassed by code nobody has written yet. For the
 * cloud transport the true floor is one level lower still (a Postgres CHECK),
 * because the serve process has write paths that never call this function.
 */
function assertCreatable(input: ItemCreateInput): {
  description: string;
  reach?: string;
  consequence?: string;
} {
  const description = validateDescription((input as { description?: unknown }).description);
  const axes = normalizeTaxonomyInput(input);
  return { description, ...axes };
}

/** The same gate for a patch: validate what is present, ignore what is absent. */
function assertPatchable(patch: ItemPatch): {
  description?: string;
  reach?: string;
  consequence?: string;
} {
  const result: { description?: string; reach?: string; consequence?: string } = {};
  if (patch.description !== undefined) result.description = validateDescription(patch.description);
  Object.assign(result, normalizeTaxonomyInput(patch));
  return result;
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

export interface ItemListResult {
  items: KnowledgeItem[];
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
        + 'Entry versioning lives in the Postgres-backed store: point this CLI at it '
        + '(HASNA_KNOWLEDGE_STORAGE_MODE=postgres plus the API url/key) and re-run.',
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
  /** Every item including archived; callers filter/sort/paginate. */
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
}

function matchesId(item: KnowledgeItem, idOrShort: string): boolean {
  return item.id === idOrShort || item.short_id === idOrShort;
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
    // Validate BEFORE taking the file lock: a refused write should not hold the
    // lock, and nothing should be written when the input is bad.
    const checked = assertCreatable(input);
    return withLock(this.storePath, () => {
      const db = loadStore(this.storePath);
      const now = new Date().toISOString();
      const id = input.id ?? makeId();
      const item: KnowledgeItem = {
        id,
        short_id: makeShortId(id),
        title: input.title,
        content: input.content,
        description: checked.description,
        // Absent stays absent — the defaults are a READ-side notion, so that
        // "the author chose nothing" remains distinguishable from "the author
        // chose self/reference". See knowledge-taxonomy.ts.
        ...(checked.reach ? { reach: checked.reach } : {}),
        ...(checked.consequence ? { consequence: checked.consequence } : {}),
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
    // Validate before the lock, and before any mutation, so a refused patch
    // leaves the stored row exactly as it was.
    const checked = assertPatchable(patch);
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
      if (checked.description !== undefined) item.description = checked.description;
      if (checked.reach !== undefined) item.reach = checked.reach;
      if (checked.consequence !== undefined) item.consequence = checked.consequence;
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
  constructor(private readonly cloud: KnowledgeCloudStore) {}

  async listVersions(idOrShort: string, options: { limit?: number; offset?: number } = {}) {
    return this.cloud.listVersions(idOrShort, options);
  }

  async getVersion(idOrShort: string, version: number) {
    return this.cloud.getVersion(idOrShort, version);
  }

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
    // Same gate as the local transport, so the two stores cannot disagree about
    // what is writable. The server re-checks independently (and Postgres checks
    // below that) — this one exists so the caller gets a useful message and a
    // clean refusal without a round trip.
    const checked = assertCreatable(input);
    return this.cloud.create({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      content: input.content,
      description: checked.description,
      ...(checked.reach ? { reach: checked.reach } : {}),
      ...(checked.consequence ? { consequence: checked.consequence } : {}),
      url: input.url ?? null,
      tags: input.tags ?? [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }

  async update(idOrShort: string, patch: ItemPatch, options: ItemUpdateOptions = {}): Promise<KnowledgeItem | null> {
    const checked = assertPatchable(patch);
    return this.cloud.update(
      idOrShort,
      { ...patch, ...checked },
      { expectedVersion: options.expectedVersion },
    );
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
 * only when the mode is explicitly postgres, otherwise the LocalItemStore. An
 * explicit `--store` override always yields the local transport so the flip
 * stays fully reversible.
 */
export function resolveItemStore(options: ResolveItemStoreOptions): ItemStore {
  const cloud = options.storePathOverridden ? null : resolveKnowledgeCloudStore(options.env ?? process.env);
  if (cloud) return new ApiItemStore(cloud);
  return new LocalItemStore(options.storePath);
}
