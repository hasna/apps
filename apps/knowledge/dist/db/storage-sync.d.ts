/**
 * Durable knowledge.db catalog tables. Retained as metadata for `db storage
 * status` and schema documentation.
 *
 * The removed client-side PostgreSQL sync engine connected fleet machines
 * directly to a database URL. Clients now reach the server only through the
 * HTTP ApiStore. This module keeps only on-box,
 * read-only status helpers.
 */
export declare const STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
export declare const KNOWLEDGE_STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
type StorageTable = (typeof STORAGE_TABLES)[number];
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
export interface StorageStatus {
    backend: 'sqlite';
    service: 'knowledge';
    scope: string;
    databasePath: string;
    tables: typeof STORAGE_TABLES;
    sync: SyncMeta[];
}
export declare function getSyncMetaAll(options?: StorageStatusOptions): SyncMeta[];
export declare function getStorageStatus(options?: StorageStatusOptions): StorageStatus;
export declare function resolveTables(tables?: string[]): StorageTable[];
export declare function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined;
export {};
