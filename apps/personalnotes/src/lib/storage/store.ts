// Synchronous SQLite store for Personal Notes, backed by `bun:sqlite`.
//
// This is the low-level engine. `sqlite.ts` wraps it in the async
// `NoteStorageContract`. Keeping the store synchronous mirrors the loops
// reference (`SqliteLoopStorage` over a sync `Store`) and keeps SQLite's native
// synchronous API fast and transactional.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  AppliedStorageMigration,
  StorageMigration,
  StorageMigrationPlanItem,
  StorageMigrationResult,
} from "./contract.js";
import {
  SQLITE_MIGRATION_LEDGER_TABLE,
  SQLITE_STORAGE_MIGRATIONS,
} from "./sqlite-schema.js";
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

const NOTE_COLUMNS = [
  "id",
  "tenant_id",
  "title",
  "body",
  "labels",
  "status",
  "folder",
  "content_format",
  "title_locked",
  "title_source",
  "title_content_fingerprint",
  "author",
  "agent",
  "created_by_actor_type",
  "created_by_name",
  "created_at",
  "updated_at",
  "archived_at",
  "trashed_at",
  "trash_expires_at",
  "restored_at",
] as const;

/** Escape LIKE wildcards so a free-text search is a literal substring match. */
function likeContains(term: string): string {
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export class SqliteNoteStore {
  readonly db: Database;
  readonly migrations: readonly StorageMigration[];

  constructor(path = ":memory:", migrations: readonly StorageMigration[] = SQLITE_STORAGE_MIGRATIONS) {
    if (path !== ":memory:" && !path.startsWith("file:")) {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.migrations = migrations;
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  // ---- migrations -------------------------------------------------------

  private ensureLedger(): void {
    this.db.exec(`
CREATE TABLE IF NOT EXISTS ${SQLITE_MIGRATION_LEDGER_TABLE} (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
    `);
  }

  listAppliedMigrations(): AppliedStorageMigration[] {
    this.ensureLedger();
    const rows = this.db
      .query(`SELECT id, checksum, applied_at FROM ${SQLITE_MIGRATION_LEDGER_TABLE} ORDER BY id ASC`)
      .all() as Array<{ id: string; checksum: string; applied_at: string }>;
    return rows.map((row) => ({ id: row.id, checksum: row.checksum, appliedAt: row.applied_at }));
  }

  private buildPlan(applied: AppliedStorageMigration[]): StorageMigrationPlanItem[] {
    const known = new Set(this.migrations.map((m) => m.id));
    for (const row of applied) {
      if (!known.has(row.id)) {
        throw new Error(`SQLite migration ${row.id} is not recognized by this binary`);
      }
    }
    const appliedById = new Map(applied.map((row) => [row.id, row]));
    for (const m of this.migrations) {
      const existing = appliedById.get(m.id);
      if (existing && existing.checksum !== m.checksum) {
        throw new Error(`SQLite migration checksum mismatch for ${m.id}`);
      }
    }
    return this.migrations.map((migration) => ({
      migration,
      state: appliedById.has(migration.id) ? "already_applied" : "pending",
    }));
  }

  migrate(opts: { dryRun?: boolean; through?: string } = {}): StorageMigrationResult {
    const dryRun = opts.dryRun === true;
    const throughIndex =
      opts.through === undefined
        ? this.migrations.length - 1
        : this.migrations.findIndex((m) => m.id === opts.through);
    if (throughIndex < 0) throw new Error(`Unknown SQLite migration target ${opts.through}`);

    this.ensureLedger();
    const applied = this.listAppliedMigrations();
    const userVersion = this.getUserVersion();
    if (userVersion > this.migrations.length) {
      throw new Error(
        `SQLite database user_version ${userVersion} is newer than this binary (knows ${this.migrations.length} migrations); refusing to open`,
      );
    }
    const plan = this.buildPlan(applied);

    if (dryRun) {
      return { backend: "sqlite", dryRun, applied, plan };
    }

    const pending = plan
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => item.state === "pending" && index <= throughIndex);

    if (pending.length > 0) {
      const runMigrations = this.db.transaction(() => {
        for (const { item, index } of pending) {
          this.db.exec(item.migration.sql);
          this.db
            .query(
              `INSERT INTO ${SQLITE_MIGRATION_LEDGER_TABLE} (id, checksum, applied_at) VALUES (?, ?, ?)`,
            )
            .run(item.migration.id, item.migration.checksum, new Date().toISOString());
          this.setUserVersion(index + 1);
        }
      });
      runMigrations();
    }

    return { backend: "sqlite", dryRun, applied: this.listAppliedMigrations(), plan };
  }

  private getUserVersion(): number {
    const row = this.db.query("PRAGMA user_version").get() as { user_version: number } | undefined;
    return row?.user_version ?? 0;
  }

  private setUserVersion(version: number): void {
    // PRAGMA does not accept bound parameters; the value is a validated integer.
    this.db.exec(`PRAGMA user_version = ${Math.floor(version)}`);
  }

  // ---- notes ------------------------------------------------------------

  private insertRow(note: NoteRecord): void {
    const placeholders = NOTE_COLUMNS.map(() => "?").join(", ");
    this.db
      .query(`INSERT INTO notes (${NOTE_COLUMNS.join(", ")}) VALUES (${placeholders})`)
      .run(
        note.id,
        note.tenantId,
        note.title,
        note.body,
        JSON.stringify(note.labels),
        note.status,
        note.folder,
        note.contentFormat,
        note.titleLocked ? 1 : 0,
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
      );
  }

  createNote(input: CreateNoteInput): NoteRecord {
    const note = normalizeCreateInput(input);
    this.insertRow(note);
    return note;
  }

  getNote(id: string, tenantId = DEFAULT_TENANT_ID): NoteRecord | undefined {
    const row = this.db
      .query("SELECT * FROM notes WHERE id = ? AND tenant_id = ?")
      .get(id, tenantId) as RawNoteRow | undefined;
    return row ? rowToNote(row) : undefined;
  }

  private buildFilter(query: ListNotesQuery): { where: string; params: SQLQueryBindings[] } {
    const tenantId = query.tenantId ?? DEFAULT_TENANT_ID;
    const clauses = ["tenant_id = ?"];
    const params: SQLQueryBindings[] = [tenantId];
    if (query.status) {
      clauses.push("status = ?");
      params.push(query.status);
    } else if (!query.includeTrashed) {
      clauses.push("status != 'trash'");
    }
    if (query.folder !== undefined) {
      clauses.push("folder = ?");
      params.push(query.folder);
    }
    if (query.label) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(notes.labels) je WHERE je.value = ?)");
      params.push(query.label);
    }
    if (query.query) {
      clauses.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      const like = likeContains(query.query);
      params.push(like, like);
    }
    return { where: clauses.join(" AND "), params };
  }

  listNotes(query: ListNotesQuery = {}): ListNotesResult {
    const { where, params } = this.buildFilter(query);
    const limit = clampLimit(query.limit);
    const offset = clampOffset(query.offset);
    const totalRow = this.db
      .query(`SELECT COUNT(*) AS c FROM notes WHERE ${where}`)
      .get(...params) as { c: number };
    const total = Number(totalRow?.c ?? 0);
    const rows = this.db
      .query(
        `SELECT * FROM notes WHERE ${where} ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as RawNoteRow[];
    const notes = rows.map(rowToNote);
    return { notes, total, limit, offset, hasMore: offset + notes.length < total };
  }

  countNotes(query: ListNotesQuery = {}): number {
    const { where, params } = this.buildFilter(query);
    const totalRow = this.db
      .query(`SELECT COUNT(*) AS c FROM notes WHERE ${where}`)
      .get(...params) as { c: number };
    return Number(totalRow?.c ?? 0);
  }

  updateNote(id: string, patch: UpdateNotePatch, tenantId = DEFAULT_TENANT_ID): NoteRecord | undefined {
    const existing = this.getNote(id, tenantId);
    if (!existing) return undefined;
    const next = applyNotePatch(existing, patch);
    this.db
      .query(
        `UPDATE notes SET
           title = ?, body = ?, labels = ?, status = ?, folder = ?, content_format = ?,
           title_locked = ?, title_source = ?, title_content_fingerprint = ?,
           updated_at = ?, archived_at = ?, trashed_at = ?, trash_expires_at = ?, restored_at = ?
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(
        next.title,
        next.body,
        JSON.stringify(next.labels),
        next.status,
        next.folder,
        next.contentFormat,
        next.titleLocked ? 1 : 0,
        next.titleSource,
        next.titleContentFingerprint,
        next.updatedAt,
        next.archivedAt,
        next.trashedAt,
        next.trashExpiresAt,
        next.restoredAt,
        id,
        tenantId,
      );
    return next;
  }

  deleteNote(id: string, tenantId = DEFAULT_TENANT_ID): boolean {
    const result = this.db
      .query("DELETE FROM notes WHERE id = ? AND tenant_id = ?")
      .run(id, tenantId);
    return result.changes > 0;
  }

  // ---- labels -----------------------------------------------------------

  listLabels(tenantId = DEFAULT_TENANT_ID): LabelRecord[] {
    const rows = this.db
      .query("SELECT tenant_id, name, color, created_at FROM labels WHERE tenant_id = ? ORDER BY name ASC")
      .all(tenantId) as Array<{ tenant_id: string; name: string; color: string; created_at: string }>;
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      name: row.name,
      color: row.color,
      createdAt: row.created_at,
    }));
  }

  putLabel(name: string, color = "", tenantId = DEFAULT_TENANT_ID): LabelRecord {
    const createdAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO labels (tenant_id, name, color, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, name) DO UPDATE SET color = excluded.color`,
      )
      .run(tenantId, name, color, createdAt);
    const row = this.db
      .query("SELECT tenant_id, name, color, created_at FROM labels WHERE tenant_id = ? AND name = ?")
      .get(tenantId, name) as { tenant_id: string; name: string; color: string; created_at: string };
    return { tenantId: row.tenant_id, name: row.name, color: row.color, createdAt: row.created_at };
  }

  removeLabel(name: string, tenantId = DEFAULT_TENANT_ID): boolean {
    const result = this.db
      .query("DELETE FROM labels WHERE tenant_id = ? AND name = ?")
      .run(tenantId, name);
    return result.changes > 0;
  }

  // ---- settings ---------------------------------------------------------

  getSetting(key: string, tenantId = DEFAULT_TENANT_ID): SettingRecord | undefined {
    const row = this.db
      .query("SELECT tenant_id, key, value, updated_at FROM settings WHERE tenant_id = ? AND key = ?")
      .get(tenantId, key) as
      | { tenant_id: string; key: string; value: string; updated_at: string }
      | undefined;
    return row
      ? { tenantId: row.tenant_id, key: row.key, value: row.value, updatedAt: row.updated_at }
      : undefined;
  }

  setSetting(key: string, value: string, tenantId = DEFAULT_TENANT_ID): SettingRecord {
    const updatedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO settings (tenant_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(tenantId, key, value, updatedAt);
    return { tenantId, key, value, updatedAt };
  }

  listSettings(tenantId = DEFAULT_TENANT_ID): SettingRecord[] {
    const rows = this.db
      .query("SELECT tenant_id, key, value, updated_at FROM settings WHERE tenant_id = ? ORDER BY key ASC")
      .all(tenantId) as Array<{ tenant_id: string; key: string; value: string; updated_at: string }>;
    return rows.map((row) => ({
      tenantId: row.tenant_id,
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    }));
  }
}
