/**
 * @hasna/knowledge — cloud (self_hosted) storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * This is the client-side piece that makes `mode=self_hosted` real for the
 * knowledge CLI/MCP. When the client-flip contract resolves to `cloud-http`
 * (i.e. HASNA_KNOWLEDGE_STORAGE_MODE=self_hosted AND HASNA_KNOWLEDGE_API_URL +
 * HASNA_KNOWLEDGE_API_KEY are set), ALL knowledge-item reads and writes are
 * routed to the app's cloud HTTP API (`https://knowledge.hasna.xyz/v1/notes`)
 * with the bearer key — NOT the local db.json store, NOT a raw DSN.
 *
 * When the flip does not resolve to cloud, this returns `null` and the CLI uses
 * its local db.json store exactly as before (fully reversible: unset the env
 * vars -> local).
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts.
 */
import { resolveStorageClient, type HasnaStorageClient } from '@hasna/contracts/client/storage';
import type { KnowledgeItem } from './store';

/** App slug used for the client-flip env keys (HASNA_KNOWLEDGE_*). */
export const KNOWLEDGE_APP_SLUG = 'knowledge';

/**
 * Storage-mode env keys the contracts client-flip inspects, in priority order.
 * Mirrors `clientTransportEnvKeys('knowledge')` in @hasna/contracts.
 */
const MODE_ENV_KEYS = [
  'HASNA_KNOWLEDGE_STORAGE_MODE',
  'HASNA_KNOWLEDGE_MODE',
  'KNOWLEDGE_STORAGE_MODE',
  'KNOWLEDGE_MODE',
] as const;
const API_URL_ENV_KEYS = ['HASNA_KNOWLEDGE_API_URL', 'KNOWLEDGE_API_URL'] as const;
const API_KEY_ENV_KEYS = ['HASNA_KNOWLEDGE_API_KEY', 'KNOWLEDGE_API_KEY'] as const;

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: readonly string[]): boolean {
  return keys.some((k) => (env[k] ?? '').trim().length > 0);
}

/**
 * The fleet flip writes exactly two vars per app —
 * `HASNA_KNOWLEDGE_API_URL` + `HASNA_KNOWLEDGE_API_KEY` — and no STORAGE_MODE.
 * Presence of BOTH is the self_hosted trigger. When no explicit storage-mode
 * var is present we infer `cloud` so the contracts resolver routes every
 * read/write to the HTTP client. An explicit storage-mode var always wins
 * (e.g. `...STORAGE_MODE=local` pins local), so the cloud flip stays fully
 * reversible: unset either the API URL or the API key -> local db.json.
 */
function withInferredCloudMode(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (hasAnyEnv(env, MODE_ENV_KEYS)) return env; // explicit mode wins
  if (hasAnyEnv(env, API_URL_ENV_KEYS) && hasAnyEnv(env, API_KEY_ENV_KEYS)) {
    return { ...env, HASNA_KNOWLEDGE_STORAGE_MODE: 'cloud' };
  }
  return env;
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
  update(idOrShort: string, patch: KnowledgeCloudPatch): Promise<KnowledgeItem | null>;
  delete(idOrShort: string): Promise<boolean>;
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
        title: input.title,
        content: input.content,
        url: input.url ?? null,
        tags: input.tags ?? [],
        ...(input.metadata ? { metadata: input.metadata } : {}),
      });
    },

    async update(idOrShort: string, patch: KnowledgeCloudPatch) {
      try {
        return await client.update<KnowledgeItem>(KNOWLEDGE_RESOURCE, idOrShort, patch);
      } catch (error) {
        if (isNotFound(error)) return null;
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
  };
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: number }).status === 404);
}

/**
 * Resolve the cloud knowledge store from the environment. Returns a ready
 * {@link KnowledgeCloudStore} when the client-flip resolves to cloud-http, else
 * `null` so the caller uses the local db.json store. Throws if cloud was
 * requested but misconfigured (never silent local drift).
 */
export function resolveKnowledgeCloudStore(env: NodeJS.ProcessEnv = process.env): KnowledgeCloudStore | null {
  const resolved = resolveStorageClient(KNOWLEDGE_APP_SLUG, withInferredCloudMode(env));
  if (resolved.transport !== 'cloud-http') return null;
  return wrap(resolved.client);
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
