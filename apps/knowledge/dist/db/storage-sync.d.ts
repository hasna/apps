import { PgAdapterAsync } from './remote-storage';
export declare const STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
export declare const KNOWLEDGE_STORAGE_TABLES: readonly ["sources", "wiki_pages", "source_revisions", "chunks", "chunk_embeddings", "wiki_backlinks", "citations", "knowledge_indexes", "runs", "run_events", "provider_usage", "redaction_findings", "storage_objects", "audit_events", "approval_gates", "vector_index_entries", "reindex_queue", "knowledge_machines", "knowledge_sync_snapshots", "knowledge_sync_changes", "knowledge_sync_conflicts", "knowledge_sync_table_clocks", "knowledge_sync_imports"];
type StorageTable = (typeof STORAGE_TABLES)[number];
export type StorageMode = 'local' | 'hybrid' | 'remote';
export interface StorageEnv {
    name: string;
}
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
export declare const KNOWLEDGE_STORAGE_ENV = "HASNA_KNOWLEDGE_DATABASE_URL";
export declare const KNOWLEDGE_STORAGE_FALLBACK_ENV = "KNOWLEDGE_DATABASE_URL";
export declare const KNOWLEDGE_STORAGE_MODE_ENV = "HASNA_KNOWLEDGE_STORAGE_MODE";
export declare const KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = "KNOWLEDGE_STORAGE_MODE";
export declare const STORAGE_DATABASE_ENV: readonly ["HASNA_KNOWLEDGE_DATABASE_URL", "KNOWLEDGE_DATABASE_URL"];
export declare const STORAGE_MODE_ENV: readonly ["HASNA_KNOWLEDGE_STORAGE_MODE", "KNOWLEDGE_STORAGE_MODE"];
export interface StorageStatus {
    configured: boolean;
    mode: StorageMode;
    env: typeof STORAGE_DATABASE_ENV;
    activeEnv: string | null;
    service: 'knowledge';
    scope: string;
    databasePath: string;
    tables: typeof STORAGE_TABLES;
    sync: SyncMeta[];
}
export declare function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null;
export declare function getStorageDatabaseEnv(): StorageEnv | null;
export declare function getStorageDatabaseUrl(): string | null;
export declare function getStorageMode(): StorageMode;
export declare function getStoragePg(): Promise<PgAdapterAsync>;
export declare function runStorageMigrations(remote: PgAdapterAsync): Promise<void>;
export declare function storagePush(options?: StorageSyncOptions): Promise<SyncResult[]>;
export declare function storagePull(options?: StorageSyncOptions): Promise<SyncResult[]>;
export declare function storageSync(options?: StorageSyncOptions): Promise<{
    pull: SyncResult[];
    push: SyncResult[];
}>;
export declare function getSyncMetaAll(options?: StorageStatusOptions): SyncMeta[];
export declare function getStorageStatus(options?: StorageStatusOptions): StorageStatus;
export declare function resolveTables(tables?: string[]): StorageTable[];
export declare function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined;
export {};
