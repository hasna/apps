import type { KnowledgeItem } from './store';
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
    update(idOrShort: string, patch: KnowledgeCloudPatch): Promise<KnowledgeItem | null>;
    delete(idOrShort: string): Promise<boolean>;
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
export declare function resolveKnowledgeCloudStore(env?: NodeJS.ProcessEnv): KnowledgeCloudStore | null;
/**
 * True when this process routes knowledge items to the cloud HTTP transport.
 * The single mode signal the whole client uses: item commands route to the
 * ApiStore, and the local sqlite catalog is refused (never a silent split-brain
 * write). Local — the default, and the answer whenever no mode var says
 * otherwise — returns false. Throws only when cloud was explicitly requested
 * but misconfigured, matching the item Store: never silent drift.
 */
export declare function isKnowledgeApiMode(env?: NodeJS.ProcessEnv): boolean;
/**
 * Fetch every knowledge item from the cloud (including archived), paging through
 * the server's 200-row cap. Used by list/export/stats which then filter/sort
 * client-side exactly as the local store path does.
 */
export declare function fetchAllCloudItems(store: KnowledgeCloudStore): Promise<KnowledgeItem[]>;
