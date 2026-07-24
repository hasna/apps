// Backend-tagged storage interface for Personal Notes.
//
// Every surface (CLI / MCP / HTTP API / SDK) consumes THIS interface, never a
// concrete engine, so the choice of SQLite vs PostgreSQL is a single factory
// decision (see `env.ts`). All methods are async — the SQLite backend wraps a
// synchronous store, the Postgres backend is natively async. (hasna-storage-standard)

import type {
  CreateNoteInput,
  LabelRecord,
  ListNotesQuery,
  ListNotesResult,
  NoteRecord,
  SettingRecord,
  UpdateNotePatch,
} from "./row.js";

export type NoteStorageBackend = "sqlite" | "postgres";

/**
 * The single storage contract shared by both engines. Implementations MUST be
 * at row-level parity: the same inputs produce the same {@link NoteRecord}s.
 */
export interface NoteStorageContract {
  readonly backend: NoteStorageBackend;

  // ---- notes ------------------------------------------------------------
  createNote(input: CreateNoteInput): Promise<NoteRecord>;
  getNote(id: string, tenantId?: string): Promise<NoteRecord | undefined>;
  listNotes(query?: ListNotesQuery): Promise<ListNotesResult>;
  updateNote(id: string, patch: UpdateNotePatch, tenantId?: string): Promise<NoteRecord | undefined>;
  deleteNote(id: string, tenantId?: string): Promise<boolean>;
  countNotes(query?: ListNotesQuery): Promise<number>;

  // ---- labels -----------------------------------------------------------
  listLabels(tenantId?: string): Promise<LabelRecord[]>;
  putLabel(name: string, color?: string, tenantId?: string): Promise<LabelRecord>;
  removeLabel(name: string, tenantId?: string): Promise<boolean>;

  // ---- settings (key/value) --------------------------------------------
  getSetting(key: string, tenantId?: string): Promise<SettingRecord | undefined>;
  setSetting(key: string, value: string, tenantId?: string): Promise<SettingRecord>;
  listSettings(tenantId?: string): Promise<SettingRecord[]>;

  // ---- migrations + lifecycle ------------------------------------------
  /** Run pending schema migrations (idempotent). `dryRun` reports the plan without writing. */
  migrate(opts?: { dryRun?: boolean; through?: string }): Promise<StorageMigrationResult>;
  listAppliedMigrations(): Promise<AppliedStorageMigration[]>;
  close(): Promise<void>;
}

// ---- migration types (co-located per the loops pattern) -----------------

export interface StorageMigration {
  readonly id: string;
  readonly checksum: string;
  readonly sql: string;
}

export interface AppliedStorageMigration {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
}

export interface StorageMigrationPlanItem {
  readonly migration: StorageMigration;
  readonly state: "already_applied" | "pending";
}

export interface StorageMigrationResult {
  readonly backend: NoteStorageBackend;
  readonly dryRun: boolean;
  readonly applied: AppliedStorageMigration[];
  readonly plan: StorageMigrationPlanItem[];
}

/** A store that can report and apply ledgered, checksummed schema migrations. */
export interface SchemaMigrationStorage {
  readonly backend: NoteStorageBackend;
  readonly migrations: readonly StorageMigration[];
  listAppliedMigrations(): Promise<AppliedStorageMigration[]>;
  migrate(opts?: { dryRun?: boolean; through?: string }): Promise<StorageMigrationResult>;
  close(): Promise<void>;
}
