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
export interface LegacyGlobalStoreImportOptions {
    dryRun?: boolean;
    now?: Date;
}
export interface LegacyGlobalStoreImportResult {
    ok: boolean;
    dry_run: boolean;
    legacy_path: string;
    canonical_path: string;
    legacy_exists: boolean;
    canonical_existed: boolean;
    canonical_created: boolean;
    would_create_canonical: boolean;
    imported: number;
    skipped_existing: number;
    skipped_invalid: number;
    backup_path: string | null;
    report_path: string | null;
    errors: string[];
    message: string;
}
export declare function defaultStorePath(): string;
export declare function ensureStore(path: string): void;
/**
 * Merge the legacy `~/.open-knowledge/db.json` store into the canonical global store.
 * The legacy file is treated as a read-only source: it is never moved, rewritten, or
 * deleted. Canonical records win on `id`/`short_id` collisions. When an existing
 * canonical store is changed a pre-import backup is written under the exports dir and
 * an import report is written under the runs dir.
 */
export declare function importLegacyGlobalStore(options?: LegacyGlobalStoreImportOptions): LegacyGlobalStoreImportResult;
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
