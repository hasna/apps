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
export type StoreLockTestEvent = 'before-create' | 'after-lock-candidate-create' | 'after-lock-candidate-partial-write' | 'after-lock-publication' | 'after-create' | 'before-stale-remove' | 'before-witness-link' | 'before-owned-unlink' | 'before-store-atomic-install' | 'before-store-final-verify' | 'before-release';
export interface StoreLockTestDetail {
    readonly path: string;
    readonly owner: string;
    readonly token: string;
    readonly pid: number;
}
interface StoreLockTestControl {
    readonly monotonicNow?: () => number;
    readonly wait?: (milliseconds: number) => void;
    readonly onEvent?: (event: StoreLockTestEvent, detail: StoreLockTestDetail) => void;
}
/** Deterministic lock race control for repository tests; never exported by the package root. */
export declare function setStoreLockTestControl(control: StoreLockTestControl | undefined): void;
export declare function loadStore(path: string): Store;
export declare function saveStore(path: string, store: Store): void;
export declare function withLock<T>(path: string, fn: () => T, options?: {
    createParent?: boolean;
}): T;
export declare function makeId(): string;
export declare function makeShortId(id: string): string;
export {};
