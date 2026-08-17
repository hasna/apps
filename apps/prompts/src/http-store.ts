/**
 * @hasna/prompts — HTTP API storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * When the canonical API URL and key are present, prompts reads and writes use
 * the server HTTP API. Without the canonical URL, callers use the on-box
 * SQLite store. A client never opens PostgreSQL directly and never receives
 * S3 credentials.
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only
 * inside the HTTP transport created by @hasna/contracts.
 */
import {
  createHasnaStorageClient,
  type HasnaStorageClient,
} from '@hasna/contracts/client/storage';
import { createHasnaHttpTransport } from '@hasna/contracts/client';
import {
  PROMPTS_API_KEY_ENV,
  PROMPTS_API_URL_ENV,
  PROMPTS_APP_SLUG,
  resolvePromptsClientTransport,
} from './client-transport.js';

export { PROMPTS_APP_SLUG };

/** Resource path served under /v1 by prompts-serve. */
export const PROMPTS_RESOURCE = 'prompts';

export interface PromptsHttpListOptions {
  collection?: string;
  tags?: string[];
  templates?: boolean;
  limit?: number;
  offset?: number;
}

export interface PromptsHttpSearchOptions {
  query: string;
  limit?: number;
  offset?: number;
}

export interface PromptsHttpSearchHit {
  item: Record<string, unknown>;
  rank: number;
}

export interface PromptsHttpCreateInput {
  title: string;
  body: string;
  slug?: string;
  description?: string | null;
  collection?: string;
  tags?: string[];
  source?: string;
}

export interface PromptsHttpPatch {
  title?: string;
  body?: string;
  description?: string | null;
  collection?: string;
  tags?: string[];
}

/** Storage status the server reports (backend + body store + counts). */
export interface PromptsHttpStorageStatus {
  backend: 'sqlite' | 'postgresql';
  prompts_total: number;
  versions_total: number;
  body_store?: { type: 'local' | 's3'; root: string; source: string };
}

export interface PromptsHttpRenderResult {
  id: string;
  body: string;
  missing_vars: string[];
  used_defaults: string[];
  vars: Record<string, string>;
}

/**
 * The prompts HTTP storage surface. Mirrors the operations the local store
 * supports so callers can use either behind one shape.
 */
export interface PromptsHttpStore {
  readonly baseUrl: string;
  list(options?: PromptsHttpListOptions): Promise<{ items: Record<string, unknown>[]; total: number }>;
  search(options: PromptsHttpSearchOptions): Promise<{ items: PromptsHttpSearchHit[]; total: number }>;
  get(idOrSlug: string): Promise<Record<string, unknown> | null>;
  create(input: PromptsHttpCreateInput): Promise<Record<string, unknown>>;
  update(idOrSlug: string, patch: PromptsHttpPatch): Promise<Record<string, unknown> | null>;
  delete(idOrSlug: string): Promise<boolean>;
  render(idOrSlug: string, vars?: Record<string, string>): Promise<PromptsHttpRenderResult>;
  use(idOrSlug: string): Promise<Record<string, unknown> | null>;
  storageStatus(): Promise<PromptsHttpStorageStatus>;
}

function boundedInteger(value: number | undefined, fallback: number, field: string, min: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}.`);
  }
  return resolved;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { status?: number }).status === 404);
}

function wrap(client: HasnaStorageClient): PromptsHttpStore {
  return {
    baseUrl: client.baseUrl,

    async list(options: PromptsHttpListOptions = {}) {
      const limit = boundedInteger(options.limit, 20, 'limit', 1, 200);
      const offset = boundedInteger(options.offset, 0, 'offset', 0, 10_000);
      const query: Record<string, string | number | boolean | undefined> = {
        collection: options.collection,
        tags: options.tags?.length ? options.tags.join(',') : undefined,
        templates: options.templates,
        limit,
        offset,
      };
      const res = await client.list<Record<string, unknown>>(PROMPTS_RESOURCE, { query });
      if (!Number.isInteger(res.total) || Number(res.total) < 0) {
        throw new Error('prompts HTTP list response is missing a valid producer total.');
      }
      return { items: res.items, total: Number(res.total) };
    },

    async search(options: PromptsHttpSearchOptions) {
      const limit = boundedInteger(options.limit, 20, 'limit', 1, 200);
      const offset = boundedInteger(options.offset, 0, 'offset', 0, 10_000);
      const response = await client.transport.get<{ items: PromptsHttpSearchHit[]; total: number }>(
        '/search',
        { query: { q: options.query, limit, offset } },
      );
      if (
        !Number.isInteger(response.total)
        || response.total < 0
        || !Array.isArray(response.items)
      ) {
        throw new Error('prompts HTTP search response is missing producer total evidence.');
      }
      return { items: response.items, total: response.total };
    },

    async get(idOrSlug: string) {
      try {
        return await client.get<Record<string, unknown>>(PROMPTS_RESOURCE, idOrSlug);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async create(input: PromptsHttpCreateInput) {
      return client.create<Record<string, unknown>>(PROMPTS_RESOURCE, {
        title: input.title,
        body: input.body,
        slug: input.slug ?? undefined,
        description: input.description ?? null,
        collection: input.collection ?? undefined,
        tags: input.tags ?? undefined,
        source: input.source ?? undefined,
      });
    },

    async update(idOrSlug: string, patch: PromptsHttpPatch) {
      try {
        return await client.update<Record<string, unknown>>(PROMPTS_RESOURCE, idOrSlug, patch, {
          method: 'PUT',
        });
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(idOrSlug: string) {
      const existing = await this.get(idOrSlug);
      if (!existing) return false;
      await client.delete(PROMPTS_RESOURCE, existing.id as string);
      return true;
    },

    async render(idOrSlug: string, vars: Record<string, string> = {}) {
      try {
        return await client.transport.post<PromptsHttpRenderResult>(
          `/${PROMPTS_RESOURCE}/${encodeURIComponent(idOrSlug)}/render`,
          { vars },
        );
      } catch (error) {
        if (isNotFound(error)) throw new Error(`prompt not found: ${idOrSlug}`);
        throw error;
      }
    },

    async use(idOrSlug: string) {
      try {
        return await client.transport.post<Record<string, unknown> & { prompt?: Record<string, unknown> }>(
          `/${PROMPTS_RESOURCE}/${encodeURIComponent(idOrSlug)}/use`,
        );
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async storageStatus() {
      return client.transport.get<PromptsHttpStorageStatus>('/storage/status');
    },
  };
}

/**
 * Resolve the HTTP prompts store from the environment. The canonical API URL
 * selects HTTP; without it the caller uses the on-box SQLite store. An API URL
 * without its key fails closed.
 */
export function resolvePromptsHttpStore(env: NodeJS.ProcessEnv = process.env): PromptsHttpStore | null {
  const client = resolvePromptsHttpClient(env);
  return client ? wrap(client) : null;
}

function resolvePromptsHttpClient(env: NodeJS.ProcessEnv = process.env): HasnaStorageClient | null {
  if (resolvePromptsClientTransport(env).transport !== 'http') return null;
  const apiUrl = env[PROMPTS_API_URL_ENV]?.trim();
  const apiKey = env[PROMPTS_API_KEY_ENV]?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error('prompts HTTP transport configuration changed during resolution');
  }
  return createHasnaStorageClient(
    PROMPTS_APP_SLUG,
    createHasnaHttpTransport({
      name: PROMPTS_APP_SLUG,
      baseUrl: apiUrl,
      apiKey,
    }),
  );
}

/** True when this process routes prompts through the server HTTP API. */
export function usesPromptsHttpTransport(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolvePromptsClientTransport(env).transport === 'http';
}

/** Build a client from explicit values (SDK path). */
export function createPromptsHttpStore(
  apiUrl: string,
  apiKey: string,
): PromptsHttpStore {
  const client = createHasnaStorageClient(
    PROMPTS_APP_SLUG,
    createHasnaHttpTransport({ name: PROMPTS_APP_SLUG, baseUrl: apiUrl, apiKey }),
  );
  return wrap(client);
}
