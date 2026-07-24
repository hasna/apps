// PostgreSQL implementation of the async `NoteStorageContract`.
//
// Row-parity with the SQLite backend: it reuses the SAME row mappers and input
// normalizers from `row.ts`, so a note created on Postgres is identical (modulo
// storage) to one created on SQLite. Migrations are handled by the composed
// `PostgresStorage` engine.

import type {
  AppliedStorageMigration,
  NoteStorageContract,
  StorageMigration,
  StorageMigrationResult,
} from "./contract.js";
import { PostgresStorage, type PostgresQueryExecutor } from "./postgres.js";
import { POSTGRES_STORAGE_MIGRATIONS } from "./postgres-schema.js";
import {
  applyNotePatch,
  clampLimit,
  clampOffset,
  DEFAULT_TENANT_ID,
  normalizeCreateInput,
  rowToNote,
  type CreateNoteInput,
  type LabelRecord,
  type ListNotesQuery,
  type ListNotesResult,
  type NoteRecord,
  type RawNoteRow,
  type SettingRecord,
  type UpdateNotePatch,
} from "./row.js";

function likeContains(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export class PostgresNoteStorage extends PostgresStorage implements NoteStorageContract {
  constructor(
    executor: PostgresQueryExecutor,
    migrations: readonly StorageMigration[] = POSTGRES_STORAGE_MIGRATIONS,
  ) {
    super(executor, migrations);
  }

  private get exec(): PostgresQueryExecutor {
    return this.executor;
  }

  async createNote(input: CreateNoteInput): Promise<NoteRecord> {
    const note = normalizeCreateInput(input);
    await this.exec.execute(
      `INSERT INTO notes (
         id, tenant_id, title, body, labels, status, folder, content_format,
         title_locked, title_source, title_content_fingerprint, author, agent,
         created_by_actor_type, created_by_name, created_at, updated_at,
         archived_at, trashed_at, trash_expires_at, restored_at
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17,
         $18, $19, $20, $21
       )`,
      [
        note.id,
        note.tenantId,
        note.title,
        note.body,
        JSON.stringify(note.labels),
        note.status,
        note.folder,
        note.contentFormat,
        note.titleLocked,
        note.titleSource,
        note.titleContentFingerprint,
        note.author,
        note.agent,
        note.createdByActorType,
        note.createdByName,
        note.createdAt,
        note.updatedAt,
        note.archivedAt,
        note.trashedAt,
        note.trashExpiresAt,
        note.restoredAt,
      ],
    );
    return note;
  }

  async getNote(id: string, tenantId = DEFAULT_TENANT_ID): Promise<NoteRecord | undefined> {
    const rows = await this.exec.query<RawNoteRow>(
      "SELECT * FROM notes WHERE id = $1 AND tenant_id = $2",
      [id, tenantId],
    );
    return rows[0] ? rowToNote(rows[0]) : undefined;
  }

  private buildFilter(query: ListNotesQuery): { where: string; params: unknown[] } {
    const tenantId = query.tenantId ?? DEFAULT_TENANT_ID;
    const clauses: string[] = [];
    const params: unknown[] = [];
    const next = (value: unknown): string => {
      params.push(value);
      return `$${params.length}`;
    };
    clauses.push(`tenant_id = ${next(tenantId)}`);
    if (query.status) {
      clauses.push(`status = ${next(query.status)}`);
    } else if (!query.includeTrashed) {
      clauses.push("status <> 'trash'");
    }
    if (query.folder !== undefined) {
      clauses.push(`folder = ${next(query.folder)}`);
    }
    if (query.label) {
      clauses.push(`labels ? ${next(query.label)}`);
    }
    if (query.query) {
      const like = likeContains(query.query);
      clauses.push(`(title ILIKE ${next(like)} ESCAPE '\\' OR body ILIKE ${next(like)} ESCAPE '\\')`);
    }
    return { where: clauses.join(" AND "), params };
  }

  async listNotes(query: ListNotesQuery = {}): Promise<ListNotesResult> {
    const { where, params } = this.buildFilter(query);
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const totalRows = await this.exec.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notes WHERE ${where}`,
      params,
    );
    const total = Number(totalRows[0]?.c ?? 0);
    const rows = await this.exec.query<RawNoteRow>(
      `SELECT * FROM notes WHERE ${where} ORDER BY updated_at DESC, id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const notes = rows.map(rowToNote);
    return { notes, total, limit, offset, hasMore: offset + notes.length < total };
  }

  async countNotes(query: ListNotesQuery = {}): Promise<number> {
    const { where, params } = this.buildFilter(query);
    const rows = await this.exec.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM notes WHERE ${where}`,
      params,
    );
    return Number(rows[0]?.c ?? 0);
  }

  async updateNote(
    id: string,
    patch: UpdateNotePatch,
    tenantId = DEFAULT_TENANT_ID,
  ): Promise<NoteRecord | undefined> {
    const existing = await this.getNote(id, tenantId);
    if (!existing) return undefined;
    const next = applyNotePatch(existing, patch);
    await this.exec.execute(
      `UPDATE notes SET
         title = $1, body = $2, labels = $3::jsonb, status = $4, folder = $5, content_format = $6,
         title_locked = $7, title_source = $8, title_content_fingerprint = $9,
         updated_at = $10, archived_at = $11, trashed_at = $12, trash_expires_at = $13, restored_at = $14
       WHERE id = $15 AND tenant_id = $16`,
      [
        next.title,
        next.body,
        JSON.stringify(next.labels),
        next.status,
        next.folder,
        next.contentFormat,
        next.titleLocked,
        next.titleSource,
        next.titleContentFingerprint,
        next.updatedAt,
        next.archivedAt,
        next.trashedAt,
        next.trashExpiresAt,
        next.restoredAt,
        id,
        tenantId,
      ],
    );
    return next;
  }

  async deleteNote(id: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
    const rows = await this.exec.query<{ id: string }>(
      "DELETE FROM notes WHERE id = $1 AND tenant_id = $2 RETURNING id",
      [id, tenantId],
    );
    return rows.length > 0;
  }

  async listLabels(tenantId = DEFAULT_TENANT_ID): Promise<LabelRecord[]> {
    const rows = await this.exec.query<{
      tenant_id: string;
      name: string;
      color: string;
      created_at: string | Date;
    }>(
      "SELECT tenant_id, name, color, created_at FROM labels WHERE tenant_id = $1 ORDER BY name ASC",
      [tenantId],
    );
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }));
  }

  async putLabel(name: string, color = "", tenantId = DEFAULT_TENANT_ID): Promise<LabelRecord> {
    const rows = await this.exec.query<{
      tenant_id: string;
      name: string;
      color: string;
      created_at: string | Date;
    }>(
      `INSERT INTO labels (tenant_id, name, color, created_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING tenant_id, name, color, created_at`,
      [tenantId, name, color],
    );
    const row = rows[0]!;
    return {
      tenantId: row.tenant_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }

  async removeLabel(name: string, tenantId = DEFAULT_TENANT_ID): Promise<boolean> {
    const rows = await this.exec.query<{ name: string }>(
      "DELETE FROM labels WHERE tenant_id = $1 AND name = $2 RETURNING name",
      [tenantId, name],
    );
    return rows.length > 0;
  }

  async getSetting(key: string, tenantId = DEFAULT_TENANT_ID): Promise<SettingRecord | undefined> {
    const rows = await this.exec.query<{
      tenant_id: string;
      key: string;
      value: string;
      updated_at: string | Date;
    }>("SELECT tenant_id, key, value, updated_at FROM settings WHERE tenant_id = $1 AND key = $2", [
      tenantId,
      key,
    ]);
    const row = rows[0];
    return row
      ? {
          tenantId: row.tenant_id,
          key: row.key,
          value: row.value,
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
        }
      : undefined;
  }

  async setSetting(key: string, value: string, tenantId = DEFAULT_TENANT_ID): Promise<SettingRecord> {
    const rows = await this.exec.query<{
      tenant_id: string;
      key: string;
      value: string;
      updated_at: string | Date;
    }>(
      `INSERT INTO settings (tenant_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING tenant_id, key, value, updated_at`,
      [tenantId, key, value],
    );
    const row = rows[0]!;
    return {
      tenantId: row.tenant_id,
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }

  async listSettings(tenantId = DEFAULT_TENANT_ID): Promise<SettingRecord[]> {
    const rows = await this.exec.query<{
      tenant_id: string;
      key: string;
      value: string;
      updated_at: string | Date;
    }>("SELECT tenant_id, key, value, updated_at FROM settings WHERE tenant_id = $1 ORDER BY key ASC", [
      tenantId,
    ]);
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  }

  // migrate(), listAppliedMigrations(), close() are inherited from PostgresStorage.
  override async migrate(opts?: { dryRun?: boolean; through?: string }): Promise<StorageMigrationResult> {
    return super.migrate(opts);
  }

  override async listAppliedMigrations(): Promise<AppliedStorageMigration[]> {
    return super.listAppliedMigrations();
  }
}

export function createPostgresNoteStorage(executor: PostgresQueryExecutor): PostgresNoteStorage {
  return new PostgresNoteStorage(executor);
}
