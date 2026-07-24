/**
 * @hasna/knowledge — cloud (self_hosted) storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Stage A intentionally contains every hosted client path before transport
 * construction. Explicit local intent keeps the compatibility JSON store;
 * hosted, partial, unknown, or conflicting intent throws a typed deterministic
 * containment error without importing or constructing an HTTP client.
 */
import type { KnowledgeItem } from './store';
import { assertKnowledgeLocalRuntime } from './runtime-role.js';

/** App slug used for the client-flip env keys (HASNA_KNOWLEDGE_*). */
export const KNOWLEDGE_APP_SLUG = 'knowledge';

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

/**
 * Stage-A resolver. A local role returns `null` for the compatibility store;
 * every hosted or invalid role throws before any transport can be constructed.
 */
export function resolveKnowledgeCloudStore(env: NodeJS.ProcessEnv = process.env): KnowledgeCloudStore | null {
  assertKnowledgeLocalRuntime({ surface: 'public-api', env });
  return null;
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
