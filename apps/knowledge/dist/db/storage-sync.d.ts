/**
 * Durable knowledge.db catalog tables. Retained as metadata for `db storage
 * status` and schema documentation.
 *
 * NOTE: the client-side Postgres sync engine (getStoragePg / storagePush /
 * storagePull / storageSync + the PgAdapterAsync DSN adapter) has been REMOVED.
 * That was a forbidden DSN-on-client path: it connected fleet machines straight
 * to the shared RDS from a HASNA_KNOWLEDGE_DATABASE_URL. Clients now reach the
 * shared store only through the HTTP ApiStore. This module keeps only local,
 * read-only status helpers.
 */
export declare const STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
export declare const KNOWLEDGE_STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
type StorageTable = (typeof STORAGE_TABLES)[number];
/**
 * Runtime storage mode per Amendment A1 (PURE REMOTE):
 *   - `local`: SQLite knowledge.db is authoritative.
 *   - `cloud`: the shared store is reached through the HTTP ApiStore.
 * The legacy words `hybrid`, `remote`, and `self_hosted` are accepted only as
 * deprecated aliases that normalize to `cloud`.
 */
export type StorageMode = 'local' | 'cloud';
export interface StorageSyncOptions {
    tables?: string[];
    scope?: string;
    cwd?: string;
}
export interface StorageStatusOptions {
    scope?: string;
    cwd?: string;
}
export interface SyncResult {
    table: string;
    rowsRead: number;
    rowsWritten: number;
    errors: string[];
}
export interface SyncMeta {
    table_name: string;
    last_synced_at: string | null;
    direction: 'push' | 'pull';
}
export declare const KNOWLEDGE_STORAGE_MODE_ENV = "HASNA_KNOWLEDGE_STORAGE_MODE";
export declare const KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = "KNOWLEDGE_STORAGE_MODE";
export declare const STORAGE_MODE_ENV: readonly ["HASNA_KNOWLEDGE_STORAGE_MODE", "KNOWLEDGE_STORAGE_MODE"];
export interface StorageStatus {
    mode: StorageMode;
    service: 'knowledge';
    scope: string;
    databasePath: string;
    tables: typeof STORAGE_TABLES;
    sync: SyncMeta[];
}
export declare function getStorageMode(): StorageMode;
export declare function getSyncMetaAll(options?: StorageStatusOptions): SyncMeta[];
export declare function getStorageStatus(options?: StorageStatusOptions): StorageStatus;
export declare function resolveTables(tables?: string[]): StorageTable[];
export declare function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined;
export {};
