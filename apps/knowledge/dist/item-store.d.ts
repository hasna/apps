import { type KnowledgeItem, type KnowledgeItemVersion, type KnowledgeItemVersionList } from './store';
import { KnowledgeVersionConflictError } from './http-store';
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
export declare class VersionHistoryUnsupportedError extends Error {
    readonly location: string;
    readonly code = "version_history_unsupported";
    constructor(location: string);
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
    listVersions(idOrShort: string, options?: {
        limit?: number;
        offset?: number;
    }): Promise<KnowledgeItemVersionList | null>;
    /** One prior snapshot by version number. */
    getVersion(idOrShort: string, version: number): Promise<KnowledgeItemVersion | null>;
    /**
     * Permanently purge retained prior versions of an entry — the secret-hygiene
     * capability that makes a credential-bearing retained version stop being
     * reachable. `null` means NO SUCH ENTRY. Without `version`, every retained
     * prior version is deleted; with `version`, only that one. The live row is
     * never a target, and the operation never reads or returns the retained body.
     */
    purgeVersions(idOrShort: string, options?: {
        version?: number;
    }): Promise<{
        purged: number;
        current_version: number;
    } | null>;
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
export declare function resolveItemStore(options: ResolveItemStoreOptions): ItemStore;
