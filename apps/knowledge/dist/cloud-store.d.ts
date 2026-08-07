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
import { type HasnaStorageClient } from '@hasna/contracts/client/storage';
import type { KnowledgeItem, KnowledgeItemVersion, KnowledgeItemVersionList } from './store';
import { KNOWLEDGE_APP_SLUG } from './knowledge-mode.js';
export { KNOWLEDGE_APP_SLUG };
/** Cloud resource path served under /v1 by knowledge-serve. */
export declare const KNOWLEDGE_RESOURCE = "notes";
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
export declare class KnowledgeVersionConflictError extends Error {
    readonly expected: number;
    readonly current: number;
    readonly code = "version_conflict";
    constructor(expected: number, current: number);
}
/**
 * The knowledge-item storage surface, cloud edition. Mirrors the operations the
 * local db.json store supports so the CLI can call either behind one shape.
 */
export interface KnowledgeCloudStore {
    /** `<origin>/v1` base URL the client targets. */
    readonly baseUrl: string;
    list(options?: KnowledgeCloudListOptions): Promise<{
        items: KnowledgeItem[];
        total: number | null;
    }>;
    get(idOrShort: string): Promise<KnowledgeItem | null>;
    create(input: KnowledgeCloudCreateInput): Promise<KnowledgeItem>;
    update(idOrShort: string, patch: KnowledgeCloudPatch, options?: KnowledgeCloudUpdateOptions): Promise<KnowledgeItem | null>;
    delete(idOrShort: string): Promise<boolean>;
    /** Prior versions of an entry, newest first. `null` when the entry is absent. */
    listVersions(idOrShort: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<KnowledgeItemVersionList | null>;
    /** One prior snapshot by version number. */
    getVersion(idOrShort: string, version: number): Promise<KnowledgeItemVersion | null>;
}
/**
 * Resolve the cloud knowledge store from the environment. Returns a ready
 * {@link KnowledgeCloudStore} when the backend is explicitly postgres, else
 * `null` so the caller uses the local db.json store. Throws if postgres was
 * requested but
 * misconfigured (never silent local drift).
 *
 * On the local path the contracts resolver is not called at all: no transport is
 * built, no key is read, and there is nothing for a second layer to infer from.
 */
export declare function resolveKnowledgeCloudStore(env?: NodeJS.ProcessEnv): KnowledgeCloudStore | null;
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
 * True when this process routes knowledge items to the cloud HTTP transport.
 * The single mode signal the whole client uses: item commands route to the
 * ApiStore, and the local sqlite catalog is refused (never a silent split-brain
 * write). Local — the default, and the answer whenever no mode var says
 * otherwise — returns false. Throws only when postgres was explicitly requested
 * but misconfigured, matching the item Store: never silent drift.
 */
export declare function isKnowledgeApiMode(env?: NodeJS.ProcessEnv): boolean;
/**
 * Fetch every knowledge item from the cloud (including archived), paging through
 * the server's 200-row cap. Used by list/export/stats which then filter/sort
 * client-side exactly as the local store path does.
 */
export declare function fetchAllCloudItems(store: KnowledgeCloudStore): Promise<KnowledgeItem[]>;
