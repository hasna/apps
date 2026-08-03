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
     * Entry version — a monotonic counter bumped on every successful update,
     * used as the optimistic-concurrency guard (`--if-version` /
     * `expectedVersion`). On the Postgres-backed store it is owned by the
     * database (see db/pg-migrations.ts). The local JSON store tracks the same
     * counter itself (see `LocalItemStore` in item-store.ts), lock-protected
     * alongside the row, even though it retains no version HISTORY — that is a
     * separate capability (`supportsVersions`; see
     * {@link VersionHistoryUnsupportedError} in item-store.ts) covering
     * retained prior bodies, which the local store still does not keep. An item
     * written before the local counter existed simply has no field yet and is
     * read as version 1 the first time it is touched under this scheme.
     */
    version?: number;
}
/**
 * The one predicate behind every `--search` / `search:` free-text filter over stored
 * items — `knowledge list --search` and the `ok_list` MCP tool.
 *
 * It is a CASE-INSENSITIVE LITERAL SUBSTRING test, not a tokenised or semantic search.
 * `knowledge search` is the semantic verb and is a different code path entirely; this
 * one deliberately stays a cheap filter, because it has to compose with tag filtering,
 * sorting and pagination over a fully materialised list.
 *
 * IT MATCHES `id` AS WELL AS `title` AND `content`, and the id is the reason this
 * function exists. The filter used to read title and content only, so resolving an item
 * by its own slug — the dominant instructed use of the flag across the skill corpus, and
 * the DEDUPE path that decides whether an artefact already exists — returned `total: 0`
 * at exit 0 for an item that was demonstrably present. A false zero there reads as "no
 * existing item, safe to create", so the omission manufactured duplicate knowledge items.
 *
 * What hid it: an item whose CONTENT happens to quote its own slug matched anyway, so a
 * spot check could pass for entirely the wrong reason. Measured on the fleet store before
 * the fix — `hasna-loop-naming-convention` and `hasna-knowledge-taxonomy` both existed and
 * were both unfindable by their own ids, while `hasna-agent-identity-convention` was found
 * only because its body cites its own slug.
 *
 * `short_id` is deliberately NOT matched. It is an opaque short handle rather than the
 * slug agents are instructed to resolve, and widening identity matching further is a
 * separate decision from repairing the one that was broken.
 */
export declare function itemMatchesSearch(item: Pick<KnowledgeItem, 'id' | 'title' | 'content'>, needle: string): boolean;
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
