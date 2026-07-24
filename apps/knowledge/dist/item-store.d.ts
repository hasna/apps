import { type KnowledgeItem } from './store';
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
export interface ItemListResult {
    items: KnowledgeItem[];
    /** Whether the backing store exists (always true for the API transport). */
    exists: boolean;
}
/** The single knowledge-item storage surface every item command routes through. */
export interface ItemStore {
    readonly kind: 'local' | 'api';
    /** storePath (local) or `<origin>/v1` base URL (api) — never contains secrets. */
    readonly location: string;
    /** Whether the backing store currently exists (api transport is always true). */
    readonly exists: boolean;
    /** Every item including archived; callers filter/sort/paginate. */
    listAll(): Promise<ItemListResult>;
    get(idOrShort: string): Promise<KnowledgeItem | null>;
    create(input: ItemCreateInput): Promise<KnowledgeItem>;
    update(idOrShort: string, patch: ItemPatch): Promise<KnowledgeItem | null>;
    delete(idOrShort: string): Promise<boolean>;
    /** Delete many ids at once (prune/dedupe). Returns the count removed. */
    deleteMany(idsOrShorts: string[]): Promise<number>;
}
export interface ResolveItemStoreOptions {
    storePath: string;
    /** When the caller passed an explicit `--store`, pin to the local transport. */
    storePathOverridden: boolean;
    env?: NodeJS.ProcessEnv;
}
/**
 * Resolve the single item Store for this invocation. Returns the ApiItemStore
 * when the client-flip resolves to the cloud HTTP transport, otherwise the
 * LocalItemStore. An explicit `--store` override always yields the local
 * transport so the flip stays fully reversible.
 */
export declare function resolveItemStore(options: ResolveItemStoreOptions): ItemStore;
