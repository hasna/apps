/**
 * @hasna/prompts — ./sdk surface.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * `createPromptsClient()` selects the same two connections as the CLI: the
 * hosted HTTP API when HASNA_PROMPTS_API_URL and HASNA_PROMPTS_API_KEY are
 * set (an API URL without its key fails closed), otherwise the on-box SQLite
 * store. A client never opens PostgreSQL directly.
 */
import { PromptsV1Client } from './generated/v1/client.js'
import {
  PROMPTS_API_KEY_ENV,
  resolvePromptsClientTransport,
  assertNoRetiredPromptsStorageSelector,
} from './client-transport.js'
import { resolvePromptsHttpStore, type PromptsHttpStore } from './http-store.js'
import { getPrompt, listPrompts, requirePrompt } from './db/prompts.js'
import { searchPrompts } from './lib/search.js'
import type { SearchResult } from './types/index.js'
import { renderTemplate } from './lib/template.js'
import { storageStatus } from './storage/status.js'

export { PromptsV1Client, ApiError } from './generated/v1/client.js'

/**
 * Local SDK surface: the same operations the HTTP store exposes, backed by
 * the on-box SQLite store plus the local markdown body folder.
 */
export interface LocalPromptsSdk {
  readonly transport: 'sqlite'
  list(options?: { collection?: string; tags?: string[]; templates?: boolean; limit?: number; offset?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number }>
  search(options: { query: string; limit?: number; offset?: number }): Promise<{ items: Array<{ item: Record<string, unknown>; rank: number }>; total: number }>
  get(idOrSlug: string): Promise<Record<string, unknown> | null>
  create(input: { title: string; body: string; slug?: string; description?: string | null; collection?: string; tags?: string[]; source?: string }): Promise<Record<string, unknown>>
  update(idOrSlug: string, patch: { title?: string; body?: string; description?: string | null; collection?: string; tags?: string[] }): Promise<Record<string, unknown> | null>
  delete(idOrSlug: string): Promise<boolean>
  render(idOrSlug: string, vars?: Record<string, string>): Promise<{ id: string; body: string; missing_vars: string[]; used_defaults: string[]; vars: Record<string, string> }>
  storageStatus(): Promise<Record<string, unknown>>
}

/** Hosted SDK surface backed by the generated /v1 client. */
export interface HttpPromptsSdk {
  readonly transport: 'http'
  readonly baseUrl: string
  readonly client: PromptsV1Client
}

export type PromptsSdk = LocalPromptsSdk | HttpPromptsSdk

export function createLocalPromptsSdk(): LocalPromptsSdk {
  return {
    transport: 'sqlite',

    async list(options = {}) {
      const filter = {
        collection: options.collection,
        tags: options.tags,
        is_template: options.templates ? true : undefined,
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
      }
      const items = listPrompts(filter)
      return { items: items as unknown as Array<Record<string, unknown>>, total: items.length }
    },

    async search(options) {
      const results = searchPrompts(options.query, { limit: options.limit, offset: options.offset })
      return {
        items: results.map((r: SearchResult) => ({ item: r.prompt as unknown as Record<string, unknown>, rank: r.score })),
        total: results.length,
      }
    },

    async get(idOrSlug) {
      const prompt = getPrompt(idOrSlug)
      return prompt ? (prompt as unknown as Record<string, unknown>) : null
    },

    async create(input) {
      const { createPrompt } = await import('./db/prompts.js')
      const prompt = await createPrompt({
        title: input.title,
        body: input.body,
        slug: input.slug,
        description: input.description ?? undefined,
        collection: input.collection,
        tags: input.tags,
        source: (input.source as 'manual' | 'ai-session' | 'imported' | undefined) ?? 'manual',
      })
      return prompt as unknown as Record<string, unknown>
    },

    async update(idOrSlug, patch) {
      const { updatePrompt } = await import('./db/prompts.js')
      const prompt = await updatePrompt(idOrSlug, {
        title: patch.title,
        body: patch.body,
        description: patch.description ?? undefined,
        collection: patch.collection,
        tags: patch.tags,
      })
      return prompt as unknown as Record<string, unknown>
    },

    async delete(idOrSlug) {
      const { deletePrompt } = await import('./db/prompts.js')
      const existing = getPrompt(idOrSlug)
      if (!existing) return false
      deletePrompt(idOrSlug)
      return true
    },

    async render(idOrSlug, vars = {}) {
      const prompt = requirePrompt(idOrSlug)
      const result = renderTemplate(prompt.body, vars)
      return { id: prompt.id, body: result.rendered, missing_vars: result.missing_vars, used_defaults: result.used_defaults, vars }
    },

    async storageStatus() {
      return storageStatus() as unknown as Record<string, unknown>
    },
  }
}

export function createHttpPromptsSdk(store: PromptsHttpStore, env: NodeJS.ProcessEnv = process.env): HttpPromptsSdk {
  const client = new PromptsV1Client({
    baseUrl: store.baseUrl.replace(/\/v1$/, ''),
    apiKey: env[PROMPTS_API_KEY_ENV]?.trim(),
  })
  return { transport: 'http', baseUrl: store.baseUrl, client }
}

/**
 * Select the client from canonical environment variables. An API URL without
 * its key fails closed instead of drifting to the on-box store.
 */
export function createPromptsClient(env: NodeJS.ProcessEnv = process.env): PromptsSdk {
  assertNoRetiredPromptsStorageSelector(env)
  const transport = resolvePromptsClientTransport(env)
  if (transport.transport === 'http') {
    const store = resolvePromptsHttpStore(env)
    if (!store) throw new Error('prompts HTTP transport resolution failed')
    return createHttpPromptsSdk(store)
  }
  return createLocalPromptsSdk()
}

export type { PromptsHttpStore, PromptsHttpListOptions, PromptsHttpSearchOptions, PromptsHttpCreateInput, PromptsHttpPatch } from './http-store.js'
export { PROMPTS_API_URL_ENV, PROMPTS_API_KEY_ENV } from './client-transport.js'
