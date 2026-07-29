/**
 * @hasna/knowledge — cloud (self_hosted) storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * This is the client-side piece that makes `mode=cloud` real for the knowledge
 * CLI/MCP. When the mode resolves to cloud, ALL knowledge-item reads and writes
 * are routed to the app's HTTP API (`/v1/notes`) with the bearer key — NOT the
 * local db.json store, NOT a raw DSN. Otherwise this returns `null` and the CLI
 * uses its local db.json store (fully reversible: set the mode back to local).
 *
 * MODE SELECTION LIVES IN knowledge-mode.ts AND IS EXPLICIT-ONLY. The presence
 * of `HASNA_KNOWLEDGE_API_URL` / `HASNA_KNOWLEDGE_API_KEY` does NOT select the
 * cloud backend — those two are pointers, and treating them as a selector is
 * what let an ambient pair of exported shell variables route a test suite's
 * writes to the live store. Every entry point below resolves the mode first and
 * hands the contracts resolver a mode-PINNED env, so the presence-inference
 * inside @hasna/contracts cannot pick a backend behind us either.
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts. Every transport this module
 * builds has the outbound request guard in front of its fetch, so a cloud
 * request that somehow resolves under `NODE_ENV=test` is refused at the socket
 * boundary instead of reaching the live store.
 */
import { resolveStorageClient, type HasnaStorageClient } from '@hasna/contracts/client/storage';
import type { KnowledgeItem, KnowledgeItemVersion, KnowledgeItemVersionList } from './store';
import {
  KNOWLEDGE_APP_SLUG,
  pinnedTransportEnv,
  resolveKnowledgeModeSelection,
} from './knowledge-mode.js';
import { guardedFetch, isNetworkGuardActive } from './net-guard.js';

export { KNOWLEDGE_APP_SLUG };

/**
 * Transport overrides applied to every cloud client this module builds.
 *
 * `fetchImpl` is the request-boundary guard and is installed unconditionally —
 * it decides per request, so a client constructed before `NODE_ENV` is set is
 * still guarded. `retry: false` only while the guard is armed: a refusal is not
 * a transient network error, and the contracts transport treats a thrown
 * fetch error as retryable, so without this each refused request would sleep
 * through two pointless backoffs before surfacing the same failure.
 */
function transportOverrides(env: NodeJS.ProcessEnv) {
  return {
    fetchImpl: guardedFetch,
    ...(isNetworkGuardActive(env) ? { retry: false as const } : {}),
  };
}

/** Cloud resource path served under /v1 by knowledge-serve. */
export const KNOWLEDGE_RESOURCE = 'notes';

export interface KnowledgeCloudListOptions {
  search?: string;
  tag?: string;
  includeArchived?: boolean;
  archivedOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface KnowledgeCloudCreateInput {
  /** Optional caller-supplied stable id. Forwarded to the server, which upserts
   * on it — giving `upsert --id`/import the same idempotency as the local store. */
  id?: string;
  title: string;
  content: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeCloudPatch {
  title?: string;
  content?: string;
  url?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
  archived?: boolean;
}

export interface KnowledgeCloudUpdateOptions {
  /**
   * Optimistic concurrency: send the version this caller last read, as
   * `If-Match`. The server applies the write only if the stored entry is still
   * at that version, so two agents editing the same entry cannot both "succeed"
   * with one silently overwritten.
   */
  expectedVersion?: number;
}

/**
 * Raised when the server refuses a write because the entry moved on. Surfaces
 * both numbers so a caller can judge whether re-reading and re-applying is safe
 * — never a blind retry, which overwrites the other writer while believing the
 * conflict was handled.
 */
export class KnowledgeVersionConflictError extends Error {
  readonly code = 'version_conflict';
  constructor(readonly expected: number, readonly current: number) {
    super(
      `version_conflict: this edit was written against version ${expected} but the stored entry is now at version ${current}. `
        + 'Nothing was written. Re-read the entry and re-apply only if the fields you are changing are untouched between the two versions.',
    );
    this.name = 'KnowledgeVersionConflictError';
  }
}

/**
 * The knowledge-item storage surface, cloud edition. Mirrors the operations the
 * local db.json store supports so the CLI can call either behind one shape.
 */
export interface KnowledgeCloudStore {
  /** `<origin>/v1` base URL the client targets. */
  readonly baseUrl: string;
  list(options?: KnowledgeCloudListOptions): Promise<{ items: KnowledgeItem[]; total: number | null }>;
  get(idOrShort: string): Promise<KnowledgeItem | null>;
  create(input: KnowledgeCloudCreateInput): Promise<KnowledgeItem>;
  update(
    idOrShort: string,
    patch: KnowledgeCloudPatch,
    options?: KnowledgeCloudUpdateOptions,
  ): Promise<KnowledgeItem | null>;
  delete(idOrShort: string): Promise<boolean>;
  /** Prior versions of an entry, newest first. `null` when the entry is absent. */
  listVersions(
    idOrShort: string,
    options?: { limit?: number; offset?: number },
  ): Promise<KnowledgeItemVersionList | null>;
  /** One prior snapshot by version number. */
  getVersion(idOrShort: string, version: number): Promise<KnowledgeItemVersion | null>;
}

function toQuery(options: KnowledgeCloudListOptions): Record<string, string | number | boolean | undefined> {
  const q: Record<string, string | number | boolean | undefined> = {};
  if (options.search) q.search = options.search;
  if (options.limit !== undefined) q.limit = options.limit;
  if (options.offset !== undefined) q.offset = options.offset;
  // The server filters archived server-side; request archived rows when either
  // "include archived" or "archived only" is asked for, then refine below.
  if (options.includeArchived || options.archivedOnly) q.includeArchived = true;
  return q;
}

function wrap(client: HasnaStorageClient): KnowledgeCloudStore {
  return {
    baseUrl: client.baseUrl,

    async list(options: KnowledgeCloudListOptions = {}) {
      // Pull enough rows to satisfy client-side tag/archived refinement; the
      // server caps at 200 per page, so page through when needed.
      const wantLimit = options.limit ?? 200;
      const query = toQuery({ ...options, limit: Math.min(Math.max(wantLimit, 1), 200) });
      const res = await client.list<KnowledgeItem>(KNOWLEDGE_RESOURCE, { query });
      let items = res.items;
      if (options.archivedOnly) items = items.filter((x) => x.archived === true);
      if (options.tag) {
        const t = options.tag.toLowerCase();
        items = items.filter((x) => (x.tags ?? []).some((tag) => tag.toLowerCase() === t));
      }
      return { items, total: res.total };
    },

    async get(idOrShort: string) {
      return client.get<KnowledgeItem>(KNOWLEDGE_RESOURCE, idOrShort);
    },

    async create(input: KnowledgeCloudCreateInput) {
      return client.create<KnowledgeItem>(KNOWLEDGE_RESOURCE, {
        ...(input.id ? { id: input.id } : {}),
        title: input.title,
        content: input.content,
        url: input.url ?? null,
        tags: input.tags ?? [],
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
    },

    async update(idOrShort: string, patch: KnowledgeCloudPatch, options: KnowledgeCloudUpdateOptions = {}) {
      try {
        return await client.update<KnowledgeItem>(KNOWLEDGE_RESOURCE, idOrShort, patch, {
          ...(options.expectedVersion !== undefined
            ? { headers: { 'if-match': String(options.expectedVersion) } }
            : {}),
        });
      } catch (error) {
        if (isNotFound(error)) return null;
        const conflict = asVersionConflict(error);
        if (conflict) throw conflict;
        throw error;
      }
    },

    async delete(idOrShort: string) {
      // Confirm existence first so callers can report "not found" like local.
      const existing = await client.get<KnowledgeItem>(KNOWLEDGE_RESOURCE, idOrShort);
      if (!existing) return false;
      await client.delete(KNOWLEDGE_RESOURCE, existing.id);
      return true;
    },

    // The version routes are sub-resources rather than top-level collections, so
    // they use the transport escape hatch the storage client documents for
    // exactly this — same base URL, same key, same outbound request guard.
    async listVersions(idOrShort: string, options: { limit?: number; offset?: number } = {}) {
      try {
        return await client.transport.get<KnowledgeItemVersionList>(
          `/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions`,
          { query: { limit: options.limit, offset: options.offset } },
        );
      } catch (error) {
        // A 404 here means NO SUCH ENTRY, and must not be flattened into an
        // empty history: "never edited" and "does not exist" are different
        // answers, and conflating them is what made the sibling implementation's
        // empty result unreadable as evidence.
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async getVersion(idOrShort: string, version: number) {
      try {
        return await client.transport.get<KnowledgeItemVersion>(
          `/${KNOWLEDGE_RESOURCE}/${encodeURIComponent(idOrShort)}/versions/${version}`,
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
  };
}

/**
 * Translate a server 409 into the typed conflict error, preserving both version
 * numbers. Anything else returns null so the original error propagates
 * unchanged — a conflict must never be swallowed into a generic failure, and a
 * generic failure must never be dressed up as a conflict.
 */
function asVersionConflict(error: unknown): KnowledgeVersionConflictError | null {
  if (!error || typeof error !== 'object') return null;
  if ((error as { status?: number }).status !== 409) return null;
  const body = (error as { body?: unknown }).body;
  const parsed = typeof body === 'string' ? safeJson(body) : body;
  const shape = (parsed ?? {}) as { error?: string; expected?: unknown; current?: unknown };
  if (shape.error !== 'version_conflict') return null;
  return new KnowledgeVersionConflictError(Number(shape.expected ?? 0), Number(shape.current ?? 0));
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: number }).status === 404);
}

/**
 * Resolve the cloud knowledge store from the environment. Returns a ready
 * {@link KnowledgeCloudStore} when the mode is explicitly cloud, else `null` so
 * the caller uses the local db.json store. Throws if cloud was requested but
 * misconfigured (never silent local drift).
 *
 * On the local path the contracts resolver is not called at all: no transport is
 * built, no key is read, and there is nothing for a second layer to infer from.
 */
export function resolveKnowledgeCloudStore(env: NodeJS.ProcessEnv = process.env): KnowledgeCloudStore | null {
  if (resolveKnowledgeModeSelection(env).mode !== 'cloud') return null;
  const resolved = resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(env, 'cloud'), transportOverrides(env));
  if (resolved.transport !== 'cloud-http') return null;
  return wrap(resolved.client);
}

/**
 * True when this process routes knowledge items to the cloud HTTP transport.
 * The single mode signal the whole client uses: item commands route to the
 * ApiStore, and the local sqlite catalog is refused (never a silent split-brain
 * write). Local — the default, and the answer whenever no mode var says
 * otherwise — returns false. Throws only when cloud was explicitly requested
 * but misconfigured, matching the item Store: never silent drift.
 */
export function isKnowledgeApiMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (resolveKnowledgeModeSelection(env).mode !== 'cloud') return false;
  return (
    resolveStorageClient(KNOWLEDGE_APP_SLUG, pinnedTransportEnv(env, 'cloud'), transportOverrides(env)).transport
    === 'cloud-http'
  );
}

/**
 * Fetch every knowledge item from the cloud (including archived), paging through
 * the server's 200-row cap. Used by list/export/stats which then filter/sort
 * client-side exactly as the local store path does.
 */
export async function fetchAllCloudItems(store: KnowledgeCloudStore): Promise<KnowledgeItem[]> {
  const pageSize = 200;
  const all: KnowledgeItem[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { items } = await store.list({ includeArchived: true, limit: pageSize, offset });
    all.push(...items);
    if (items.length < pageSize) break;
    if (offset > 100_000) break; // hard safety cap
  }
  return all;
}
