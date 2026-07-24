// SQLite implementation of the async `NoteStorageContract`.
//
// A thin async wrapper over the synchronous `SqliteNoteStore` so all four
// surfaces can consume one uniform async interface regardless of engine.

import type {
  AppliedStorageMigration,
  NoteStorageContract,
  StorageMigrationResult,
} from "./contract.js";
import { SqliteNoteStore } from "./store.js";
import type {
  CreateNoteInput,
  LabelRecord,
  ListNotesQuery,
  ListNotesResult,
  NoteRecord,
  SettingRecord,
  UpdateNotePatch,
} from "./row.js";

export class SqliteNoteStorage implements NoteStorageContract {
  readonly backend = "sqlite" as const;

  constructor(readonly store: SqliteNoteStore = new SqliteNoteStore()) {}

  async createNote(input: CreateNoteInput): Promise<NoteRecord> {
    return this.store.createNote(input);
  }

  async getNote(id: string, tenantId?: string): Promise<NoteRecord | undefined> {
    return this.store.getNote(id, tenantId);
  }

  async listNotes(query?: ListNotesQuery): Promise<ListNotesResult> {
    return this.store.listNotes(query);
  }

  async updateNote(
    id: string,
    patch: UpdateNotePatch,
    tenantId?: string,
  ): Promise<NoteRecord | undefined> {
    return this.store.updateNote(id, patch, tenantId);
  }

  async deleteNote(id: string, tenantId?: string): Promise<boolean> {
    return this.store.deleteNote(id, tenantId);
  }

  async countNotes(query?: ListNotesQuery): Promise<number> {
    return this.store.countNotes(query);
  }

  async listLabels(tenantId?: string): Promise<LabelRecord[]> {
    return this.store.listLabels(tenantId);
  }

  async putLabel(name: string, color?: string, tenantId?: string): Promise<LabelRecord> {
    return this.store.putLabel(name, color, tenantId);
  }

  async removeLabel(name: string, tenantId?: string): Promise<boolean> {
    return this.store.removeLabel(name, tenantId);
  }

  async getSetting(key: string, tenantId?: string): Promise<SettingRecord | undefined> {
    return this.store.getSetting(key, tenantId);
  }

  async setSetting(key: string, value: string, tenantId?: string): Promise<SettingRecord> {
    return this.store.setSetting(key, value, tenantId);
  }

  async listSettings(tenantId?: string): Promise<SettingRecord[]> {
    return this.store.listSettings(tenantId);
  }

  async migrate(opts?: { dryRun?: boolean; through?: string }): Promise<StorageMigrationResult> {
    return this.store.migrate(opts);
  }

  async listAppliedMigrations(): Promise<AppliedStorageMigration[]> {
    return this.store.listAppliedMigrations();
  }

  async close(): Promise<void> {
    this.store.close();
  }
}

export function createSqliteNoteStorage(path?: string): SqliteNoteStorage {
  return new SqliteNoteStorage(new SqliteNoteStore(path));
}
