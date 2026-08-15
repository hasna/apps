import type { Database } from 'bun:sqlite';
import { migrateKnowledgeDb, openKnowledgeDb } from '../knowledge-db';
import { ensureKnowledgeWorkspace, resolveScopedWorkspace } from '../workspace';

/**
 * Durable knowledge.db catalog tables. Retained as metadata for `db storage
 * status` and schema documentation.
 *
 * The removed client-side PostgreSQL sync engine connected fleet machines
 * directly to a database URL. Clients now reach the server only through the
 * HTTP ApiStore. This module keeps only on-box,
 * read-only status helpers.
 */
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

function openScopedDb(options: StorageStatusOptions = {}): { db: Database; path: string; scope: string } {
  const workspace = ensureKnowledgeWorkspace(resolveScopedWorkspace(options.scope, options.cwd).home);
  migrateKnowledgeDb(workspace.knowledgeDbPath);
  return {
    db: openKnowledgeDb(workspace.knowledgeDbPath),
    path: workspace.knowledgeDbPath,
    scope: options.scope ?? 'global',
  };
}

export function getSyncMetaAll(options: StorageStatusOptions = {}): SyncMeta[] {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    return local.db.query('SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction').all() as SyncMeta[];
  } finally {
    local.db.close();
  }
}

export function getStorageStatus(options: StorageStatusOptions = {}): StorageStatus {
  const local = openScopedDb(options);
  try {
    ensureSyncMetaTable(local.db);
    const sync = local.db.query('SELECT table_name, last_synced_at, direction FROM _knowledge_sync_meta ORDER BY table_name, direction').all() as SyncMeta[];
    return {
      backend: 'sqlite',
      service: 'knowledge',
      scope: local.scope,
      databasePath: local.path,
      tables: STORAGE_TABLES,
      sync,
    };
  } finally {
    local.db.close();
  }
}

export function resolveTables(tables?: string[]): StorageTable[] {
  if (!tables || tables.length === 0) return [...STORAGE_TABLES];
  const allowed = new Set<string>(STORAGE_TABLES);
  const requested = tables.map((table) => table.trim()).filter(Boolean);
  const invalid = requested.filter((table) => !allowed.has(table));
  if (invalid.length > 0) throw new Error(`Unknown knowledge sync table(s): ${invalid.join(', ')}`);
  return requested as StorageTable[];
}

export function parseStorageTables(value?: string | string[] | null): StorageTable[] | undefined {
  if (!value) return undefined;
  return resolveTables(Array.isArray(value) ? value : value.split(','));
}

function ensureSyncMetaTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _knowledge_sync_meta (
      table_name TEXT NOT NULL,
      last_synced_at TEXT,
      direction TEXT NOT NULL CHECK(direction IN ('push', 'pull')),
      PRIMARY KEY (table_name, direction)
    )
  `);
}
