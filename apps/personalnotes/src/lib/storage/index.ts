// Barrel for the Personal Notes storage layer.
//
// Package export map (hasna-storage-standard, loops pattern):
//   ./storage                 → this barrel
//   ./storage/contract        → the backend-tagged interface + migration types
//   ./storage/sqlite          → SQLite implementation
//   ./storage/postgres        → Postgres migration engine + note storage
//   ./storage/postgres-schema → exported migrations + checksum (no app/conn needed)

export type {
  AppliedStorageMigration,
  NoteStorageBackend,
  NoteStorageContract,
  SchemaMigrationStorage,
  StorageMigration,
  StorageMigrationPlanItem,
  StorageMigrationResult,
} from "./contract.js";

export type {
  CreateNoteInput,
  LabelRecord,
  ListNotesQuery,
  ListNotesResult,
  NoteRecord,
  NoteStatus,
  NoteTitleSource,
  RawNoteRow,
  SettingRecord,
  UpdateNotePatch,
} from "./row.js";
export {
  applyNotePatch,
  DEFAULT_CONTENT_FORMAT,
  DEFAULT_TENANT_ID,
  DEFAULT_TRASH_RETENTION_DAYS,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_LIMIT,
  NOTE_STATUSES,
  normalizeCreateInput,
  normalizeLabels,
  parseLabels,
  rowToNote,
} from "./row.js";

export { checksumStorageSql } from "./checksum.js";

export { SqliteNoteStore } from "./store.js";
export { SqliteNoteStorage, createSqliteNoteStorage } from "./sqlite.js";
export { SQLITE_MIGRATION_LEDGER_TABLE, SQLITE_STORAGE_MIGRATIONS } from "./sqlite-schema.js";

export { PostgresStorage, createPostgresStorage } from "./postgres.js";
export type { PostgresQueryExecutor } from "./postgres.js";
export { PostgresNoteStorage, createPostgresNoteStorage } from "./postgres-note-storage.js";
export {
  POSTGRES_MIGRATION_ADVISORY_LOCK_SQL,
  POSTGRES_MIGRATION_LEDGER_TABLE,
  POSTGRES_STORAGE_MIGRATIONS,
} from "./postgres-schema.js";
export { PgPoolExecutor } from "./pg-executor.js";
export type { PgExecutorOptions } from "./pg-executor.js";

export {
  createNoteStorage,
  defaultSqlitePath,
  ENV_PREFIX,
  resolveStorageConfig,
  STORAGE_MODES,
} from "./env.js";
export type { StorageConfig, StorageMode } from "./env.js";
