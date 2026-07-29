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
    /**
     * Entry version, owned by the database (see db/pg-migrations.ts). Present on
     * items read from the Postgres-backed store; absent on the local JSON store,
     * which has no version line at all — and that absence is deliberately visible
     * rather than defaulted to 1, so a caller cannot mistake "this store does not
     * version" for "this entry has never been edited".
     */
    version?: number;
}
/**
 * An immutable snapshot of an entry as it stood BEFORE the edit that produced
 * the next version. Written only by the database trigger (see
 * db/pg-migrations.ts) — never by application code, on any surface.
 *
 * Defined here, alongside {@link KnowledgeItem}, because both the serve layer
 * that produces these rows and the CLI/SDK clients that read them need the
 * shape, and neither should have to import the other.
 */
export interface KnowledgeItemVersion {
    id: string;
    item_id: string;
    tenant_id: string | null;
    version: number;
    title: string;
    content: string | null;
    /** Set when the body was offloaded out of Postgres; null while inline. */
    body_uri: string | null;
    /** sha256 of the full body. Always present, so drift checks need no network. */
    content_hash: string;
    content_bytes: number;
    url: string | null;
    tags: string[];
    metadata: Record<string, unknown>;
    archived: boolean;
    actor: string | null;
    reason: string | null;
    valid_from: string | null;
    valid_to: string;
}
export interface KnowledgeItemVersionList {
    item_id: string;
    /** The version the entry is at NOW; every snapshot in `items` is prior to it. */
    current_version: number;
    /** Total snapshots retained, independent of limit/offset. */
    total: number;
    items: KnowledgeItemVersion[];
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
