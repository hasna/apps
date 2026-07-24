import { KnowledgeContainmentError, assertKnowledgeLocalRuntime } from '../runtime-role.js';

export const STORAGE_TABLES = [
  'sources',
  'wiki_pages',
  'source_revisions',
  'chunks',
  'chunk_embeddings',
  'wiki_backlinks',
  'citations',
  'knowledge_indexes',
  'runs',
  'run_events',
  'provider_usage',
  'redaction_findings',
  'storage_objects',
  'audit_events',
  'approval_gates',
  'vector_index_entries',
  'reindex_queue',
  'knowledge_machines',
  'knowledge_sync_snapshots',
  'knowledge_sync_changes',
  'knowledge_sync_conflicts',
  'knowledge_sync_table_clocks',
  'knowledge_sync_imports',
] as const;

export const KNOWLEDGE_STORAGE_TABLES = STORAGE_TABLES;

type StorageTable = (typeof STORAGE_TABLES)[number];

export type StorageMode = 'local' | 'cloud';

export interface StorageEnv {
  name: string;
}

export interface StorageSyncOptions {
  tables?: string[];
  scope?: string;
  cwd?: string;
  remote?: StorageRemoteAdapter;
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

export interface StorageRemoteAdapter {
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
  all(sql: string, ...params: unknown[]): Promise<unknown[]>;
  get?(sql: string, ...params: unknown[]): Promise<unknown | null>;
  close(): Promise<void>;
}

export const KNOWLEDGE_STORAGE_ENV = 'HASNA_KNOWLEDGE_DATABASE_URL';
export const KNOWLEDGE_STORAGE_FALLBACK_ENV = 'KNOWLEDGE_DATABASE_URL';
export const KNOWLEDGE_STORAGE_MODE_ENV = 'HASNA_KNOWLEDGE_STORAGE_MODE';
export const KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV = 'KNOWLEDGE_STORAGE_MODE';
export const STORAGE_DATABASE_ENV = [KNOWLEDGE_STORAGE_ENV, KNOWLEDGE_STORAGE_FALLBACK_ENV] as const;
export const STORAGE_MODE_ENV = [KNOWLEDGE_STORAGE_MODE_ENV, KNOWLEDGE_STORAGE_MODE_FALLBACK_ENV] as const;

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

function containedStorage(): never {
  throw new KnowledgeContainmentError(
    'KNOWLEDGE_HOSTED_CONTAINED',
    503,
    'hosted-client',
    'public-api',
    'database synchronization is unavailable during Stage A',
  );
}

export function getStorageDatabaseEnvName(): (typeof STORAGE_DATABASE_ENV)[number] | null {
  return null;
}

export function getStorageDatabaseEnv(): StorageEnv | null {
  return null;
}

export function getStorageDatabaseUrl(): string | null {
  return null;
}

export function getStorageMode(): StorageMode {
  return 'local';
}

export async function getStoragePg(): Promise<StorageRemoteAdapter> {
  return containedStorage();
}

export async function runStorageMigrations(remote: StorageRemoteAdapter): Promise<void> {
  return containedStorage();
}

export function storagePush(options?: StorageSyncOptions): Promise<SyncResult[]>;
export async function storagePush(): Promise<SyncResult[]> {
  return containedStorage();
}

export function storagePull(options?: StorageSyncOptions): Promise<SyncResult[]>;
export async function storagePull(): Promise<SyncResult[]> {
  return containedStorage();
}

export function storageSync(options?: StorageSyncOptions): Promise<{ pull: SyncResult[]; push: SyncResult[] }>;
export async function storageSync(): Promise<{ pull: SyncResult[]; push: SyncResult[] }> {
  return containedStorage();
}

export function getSyncMetaAll(options?: StorageStatusOptions): SyncMeta[];
export function getSyncMetaAll(): SyncMeta[] {
  return [];
}

export function getStorageStatus(options?: StorageStatusOptions): StorageStatus;
export function getStorageStatus(): StorageStatus {
  return {
    configured: false,
    mode: 'local',
    env: STORAGE_DATABASE_ENV,
    activeEnv: null,
    service: 'knowledge',
    scope: 'contained',
    databasePath: '[contained-zero-io]',
    tables: STORAGE_TABLES,
    sync: [],
  };
}

export function resolveTables(tables?: string[]): StorageTable[] {
  assertKnowledgeLocalRuntime({ surface: 'public-api', env: process.env });
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error('Unknown knowledge sync table selection.');
  return requested as StorageTable[];
}

export function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined {
  assertKnowledgeLocalRuntime({ surface: 'public-api', env: process.env });
  if (!value) return undefined;
  return resolveTables(Array.isArray(value) ? value : value.split(','));
}
