// On-box, read-only knowledge.db storage status helpers. Clients reach the
// server only through the HTTP ApiStore.
export {
  KNOWLEDGE_STORAGE_TABLES,
  STORAGE_TABLES,
  getStorageStatus,
  getSyncMetaAll,
  parseStorageTables,
  resolveTables,
} from './db/storage-sync.js';
export type {
  StorageStatus,
  StorageStatusOptions,
  StorageSyncOptions,
  SyncMeta,
  SyncResult,
} from './db/storage-sync.js';
