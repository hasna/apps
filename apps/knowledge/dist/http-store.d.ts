/**
 * @hasna/knowledge — HTTP API storage resolver.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * When a credential resolves through the shared @hasna/contracts client chain,
 * all knowledge-item reads and writes use the server HTTP API. With nothing
 * configured anywhere, callers use the on-box store. A client never opens
 * PostgreSQL directly.
 *
 * SAFETY: never logs, returns, or embeds the API key. The key lives only inside
 * the HTTP transport created by @hasna/contracts. Every transport this module
 * builds has the outbound request guard in front of its fetch, so an HTTP
 * request that somehow resolves under `NODE_ENV=test` is refused at the socket
 * boundary instead of reaching the live store.
 */
import { type HasnaStorageClient } from '@hasna/contracts/client/storage';
import type { KnowledgeItem, KnowledgeItemVersion, KnowledgeItemVersionList } from './store';
import { KNOWLEDGE_APP_SLUG } from './client-transport.js';
import { KNOWLEDGE_BOUNDED_QUERY_CAPABILITY } from './query-contract.js';
export { KNOWLEDGE_APP_SLUG, KNOWLEDGE_BOUNDED_QUERY_CAPABILITY };
/** Resource path served under /v1 by knowledge-serve. */
export declare const KNOWLEDGE_RESOURCE = "notes";
export interface KnowledgeHttpListOptions {
    /** Literal id/title/content filter used by `knowledge list`. */
    search?: string;
    tags?: string[];
    archive?: 'active' | 'archived' | 'all';
    sort?: 'created' | 'title';
    direction?: 'asc' | 'desc';
    limit?: number;
    offset?: number;
}
export interface KnowledgeHttpSearchOptions {
    query: string;
    /** Archive scope forwarded to the server; defaults to active. */
    archive?: 'active' | 'archived' | 'all';
    limit?: number;
    offset?: number;
}
export interface KnowledgeHttpSearchHit {
    item: KnowledgeItem;
    /** Producer-computed PostgreSQL ts_rank_cd score. */
    rank: number;
}
export interface KnowledgeHttpCreateInput {
    /** Optional caller-supplied stable id. Forwarded to the server, which upserts
     * on it — giving `upsert --id`/import the same idempotency as the local store. */
    id?: string;
    title: string;
    content: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
}
export interface KnowledgeHttpPatch {
    title?: string;
    content?: string;
    url?: string | null;
    tags?: string[];
    metadata?: Record<string, unknown>;
    archived?: boolean;
}
export interface KnowledgeHttpUpdateOptions {
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
export declare class KnowledgeVersionConflictError extends Error {
    readonly expected: number;
    readonly current: number;
    readonly code = "version_conflict";
    constructor(expected: number, current: number);
}
/**
 * Raised when the server response cannot prove that it applied a bounded query
 * field that older servers silently ignored.
 */
export declare class KnowledgeBoundedQueryCapabilityError extends Error {
    readonly operation: 'list' | 'search';
    readonly fields: readonly string[];
    readonly code = "bounded_query_capability_required";
    constructor(operation: 'list' | 'search', fields: readonly string[]);
}
/**
 * The knowledge-item HTTP storage surface. Mirrors the operations the
 * local db.json store supports so the CLI can call either behind one shape.
 */
export interface KnowledgeHttpStore {
    /** `<origin>/v1` base URL the client targets. */
    readonly baseUrl: string;
    list(options?: KnowledgeHttpListOptions): Promise<{
        items: KnowledgeItem[];
        total: number;
    }>;
    /** Ranked producer-side PostgreSQL full-text query. */
    search(options: KnowledgeHttpSearchOptions): Promise<{
        items: KnowledgeHttpSearchHit[];
        total: number;
    }>;
    get(idOrShort: string): Promise<KnowledgeItem | null>;
    create(input: KnowledgeHttpCreateInput): Promise<KnowledgeItem>;
    update(idOrShort: string, patch: KnowledgeHttpPatch, options?: KnowledgeHttpUpdateOptions): Promise<KnowledgeItem | null>;
    delete(idOrShort: string): Promise<boolean>;
    /** Prior versions of an entry, newest first. `null` when the entry is absent. */
    listVersions(idOrShort: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<KnowledgeItemVersionList | null>;
    /** One prior snapshot by version number. */
    getVersion(idOrShort: string, version: number): Promise<KnowledgeItemVersion | null>;
    /**
     * Secret-hygiene purge of retained prior versions. `null` when the entry is
     * absent. Without `version`, every retained prior version is deleted; with
     * `version`, only that one. The live row is never a target, and the operation
     * never reads or returns the retained body.
     */
    purgeVersions(idOrShort: string, options?: {
        version?: number;
    }): Promise<{
        ok: boolean;
        purged: number;
        current_version: number;
    } | null>;
}
/**
 * Resolve the HTTP knowledge store from the environment. A credential from any
 * tier of the shared @hasna/contracts chain selects HTTP (against the fleet
 * gateway unless an authority is configured); with nothing configured anywhere
 * the caller uses the on-box db.json store. A configured authority whose
 * credential does not resolve throws rather than falling back.
 */
export declare function resolveKnowledgeHttpStore(env?: NodeJS.ProcessEnv): KnowledgeHttpStore | null;
/**
 * Package-internal production transport resolver used by guarded-write
 * sub-resources. It intentionally has no local fallback: an FCAME-1 producer
 * that cannot resolve the authenticated HTTP authority fails closed before it
 * can touch the local JSON/SQLite stores.
 *
 * Not re-exported from the package root; consumers use
 * `createKnowledgeGuardedWriter()` rather than the raw transport.
 */
export declare function resolveKnowledgeGuardedTransport(env?: NodeJS.ProcessEnv): HasnaStorageClient['transport'] | null;
/**
 * True when this process routes knowledge items through the server HTTP API.
 * This is the single client transport signal used by item commands and the
 * local-catalog guard.
 */
export declare function usesKnowledgeHttpTransport(env?: NodeJS.ProcessEnv): boolean;
/**
 * Fetch every knowledge item through HTTP (including archived), paging through
 * the server's 200-row cap. Used by list/export/stats which then filter/sort
 * client-side exactly as the local store path does.
 */
export declare function fetchAllHttpItems(store: KnowledgeHttpStore): Promise<KnowledgeItem[]>;
