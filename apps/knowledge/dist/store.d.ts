export interface KnowledgeItem {
    id: string;
    short_id?: string | null;
    title: string;
    content: string;
    url: string | null;
    tags: string[];
    metadata?: Record<string, unknown>;
    archived?: boolean;
    created_at: string;
    updated_at: string;
}
export interface Store {
    items: KnowledgeItem[];
}
export declare function defaultStorePath(): string;
export declare function ensureStore(path: string): void;
export declare function loadStoreIfExists(path: string): Store & {
    exists: boolean;
};
export declare function loadStore(path: string): Store;
export declare function saveStore(path: string, store: Store): void;
export declare function withLock<T>(path: string, fn: () => T, options?: {
    createParent?: boolean;
}): T;
export declare function makeId(): string;
export declare function makeShortId(id: string): string;
