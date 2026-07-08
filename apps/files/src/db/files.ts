import type { SQLQueryBindings } from "bun:sqlite";
import { getDb } from "./database.js";
import { nanoid } from "nanoid";
import { getLatestFileVersion, upsertCurrentFileVersion } from "./file-versions.js";
import { appendKnowledgeSourceOutboxEvent } from "./knowledge-outbox.js";
import { generateCanonicalName } from "../lib/normalize.js";
import { buildOpenFilesFileRef } from "../lib/source-ref.js";
import type { DuplicateGroup, FileRecord, FileVersion, FileWithTags, ListFilesOptions, FileStatus, KnowledgeSourceOutboxEventType } from "../types/index.js";

interface FileRow {
  id: string;
  source_id: string;
  machine_id: string;
  path: string;
  name: string;
  original_name: string | null;
  canonical_name: string | null;
  ext: string;
  size: number;
  mime: string;
  description: string;
  hash: string | null;
  status: string;
  indexed_at: string;
  modified_at: string | null;
  created_at: string;
}

function toFile(row: FileRow): FileRecord {
  return {
    ...row,
    status: row.status as FileStatus,
    description: row.description || undefined,
    hash: row.hash ?? undefined,
    modified_at: row.modified_at ?? undefined,
    original_name: row.original_name ?? undefined,
    canonical_name: row.canonical_name ?? undefined,
  };
}

export function upsertFile(input: Omit<FileRecord, "id" | "indexed_at" | "created_at"> & { id?: string }): FileRecord {
  const db = getDb();
  const existingById = input.id
    ? db.query<FileRow, [string]>("SELECT * FROM files WHERE id = ?").get(input.id)
    : null;
  const existing = existingById ?? db.query<FileRow, [string, string]>(
    "SELECT * FROM files WHERE source_id = ? AND path = ?"
  ).get(input.source_id, input.path);

  if (existing) {
    const previousVersion = getLatestFileVersion(existing.id);
    db.run(
      `UPDATE files SET source_id=?, machine_id=?, path=?, name=?, ext=?, size=?, mime=?, hash=?, status=?, modified_at=?, indexed_at=datetime('now'), sync_version=sync_version+1
       WHERE id=?`,
      [input.source_id, input.machine_id, input.path, input.name, input.ext, input.size, input.mime, input.hash ?? null, input.status, input.modified_at ?? null, existing.id]
    );
    // Backfill canonical_name if missing
    if (!existing.canonical_name) {
      const canonical = generateCanonicalName(input.name);
      db.run("UPDATE files SET original_name=?, canonical_name=? WHERE id=?", [input.name, canonical, existing.id]);
    }
    refreshFileFts(existing.id);
    const currentVersion = upsertCurrentFileVersion(existing.id);
    const next = toFile(db.query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(existing.id)!);
    const eventType = classifyFileChange(existing, input);
    emitFileOutboxEvent(eventType, next, currentVersion, previousVersion, {
      previous_path: existing.path,
      previous_status: existing.status,
      previous_hash: existing.hash ?? undefined,
    });
    emitDerivedRevisionOutboxEvents(next, currentVersion, previousVersion);
    return next;
  }

  const id = input.id ?? `f_${nanoid(10)}`;
  const canonical = generateCanonicalName(input.name);
  db.run(
    `INSERT INTO files (id, source_id, machine_id, path, name, original_name, canonical_name, ext, size, mime, hash, status, modified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.source_id, input.machine_id, input.path, input.name, input.name, canonical, input.ext, input.size, input.mime, input.hash ?? null, input.status, input.modified_at ?? null]
  );
  refreshFileFts(id);
  const currentVersion = upsertCurrentFileVersion(id);
  const file = toFile(db.query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(id)!);
  emitFileOutboxEvent("indexed", file, currentVersion, null);
  return file;
}

function emitDerivedRevisionOutboxEvents(
  file: FileRecord,
  currentVersion: FileVersion | null,
  previousVersion: FileVersion | null,
): void {
  if (!currentVersion || !previousVersion || currentVersion.id === previousVersion.id) return;
  emitFileOutboxEvent("revision_changed", file, currentVersion, previousVersion, {
    previous_revision_ref: previousVersion.source_ref,
  });
  if (
    currentVersion.bucket !== previousVersion.bucket
    || currentVersion.object_key !== previousVersion.object_key
  ) {
    emitFileOutboxEvent("canonical_key_changed", file, currentVersion, previousVersion, {
      previous_bucket: previousVersion.bucket,
      previous_object_key: previousVersion.object_key,
    });
  }
}

export function refreshFileFts(file_id: string): void {
  const db = getDb();
  const file = db.query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(file_id);
  if (!file) return;
  const tags = db.query<{ name: string }, [string]>(
    "SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id=t.id WHERE ft.file_id=?"
  ).all(file_id).map((r) => r.name).join(" ");
  const organization = db.query<{
    owner: string | null;
    target_path: string | null;
    labels: string | null;
    review_status: string | null;
  }, [string]>(
    "SELECT owner, target_path, labels, review_status FROM file_organization_reviews WHERE file_id=? LIMIT 1"
  ).get(file_id);
  db.run("DELETE FROM files_fts WHERE id=?", [file_id]);
  db.run(
    `INSERT INTO files_fts (
      id,
      name,
      path,
      ext,
      mime,
      tags,
      canonical_name,
      description,
      organization_owner,
      organization_target_path,
      organization_labels,
      organization_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      file_id,
      file.name,
      file.path,
      file.ext,
      file.mime,
      tags,
      file.canonical_name ?? "",
      file.description ?? "",
      organization?.owner ?? "",
      organization?.target_path ?? "",
      organization?.labels ?? "",
      organization?.review_status ?? "",
    ]
  );
}

export function getFile(id: string): FileWithTags | null {
  const db = getDb();
  const row = db.query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(id);
  if (!row) return null;
  const tags = db.query<{ name: string }, [string]>(
    "SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id=t.id WHERE ft.file_id=?"
  ).all(id).map((r) => r.name);
  return { ...toFile(row), tags };
}

export function listFiles(opts: ListFilesOptions = {}): FileWithTags[] {
  const db = getDb();
  const conditions: string[] = ["f.status = 'active'"];
  const params: unknown[] = [];

  if (opts.source_id) { conditions.push("f.source_id = ?"); params.push(opts.source_id); }
  if (opts.machine_id) { conditions.push("f.machine_id = ?"); params.push(opts.machine_id); }
  if (opts.sync_status) { conditions.push("f.sync_status = ?"); params.push(opts.sync_status); }
  if (opts.ext) { conditions.push("f.ext = ?"); params.push(opts.ext.startsWith(".") ? opts.ext : `.${opts.ext}`); }
  if (opts.status) { conditions[0] = `f.status = ?`; params.unshift(opts.status); }
  if (opts.after) { conditions.push("COALESCE(f.modified_at, f.indexed_at) >= ?"); params.push(opts.after); }
  if (opts.before) { conditions.push("COALESCE(f.modified_at, f.indexed_at) <= ?"); params.push(opts.before); }
  if (opts.min_size !== undefined) { conditions.push("f.size >= ?"); params.push(opts.min_size); }
  if (opts.max_size !== undefined) { conditions.push("f.size <= ?"); params.push(opts.max_size); }

  let join = "";
  if (opts.tag) {
    join += " JOIN file_tags ft_filter ON ft_filter.file_id = f.id JOIN tags t_filter ON t_filter.id = ft_filter.tag_id AND t_filter.name = ?";
    params.push(opts.tag);
  }
  if (opts.collection_id) {
    join += " JOIN collection_files cf ON cf.file_id = f.id AND cf.collection_id = ?";
    params.push(opts.collection_id);
  }
  if (opts.project_id) {
    join += " JOIN project_files pf ON pf.file_id = f.id AND pf.project_id = ?";
    params.push(opts.project_id);
  }

  const sortCol = opts.sort === "name" ? "f.name" : opts.sort === "size" ? "f.size" : "f.indexed_at";
  const sortDir = opts.sort_dir === "asc" ? "ASC" : "DESC";
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (db.query(
    `SELECT DISTINCT f.* FROM files f ${join} ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`
  ) as any).all([...params, limit, offset]) as FileRow[];

  return rows.map((row) => {
    const tags = db.query<{ name: string }, [string]>(
      "SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id=t.id WHERE ft.file_id=?"
    ).all(row.id).map((r) => r.name);
    return { ...toFile(row), tags };
  });
}

export function searchFiles(query: string, opts: Omit<ListFilesOptions, "query"> = {}): FileWithTags[] {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const ftsRows = db.query<{ id: string; rank: number }, [string, number, number]>(
    "SELECT id, rank FROM files_fts WHERE files_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?"
  ).all(query, limit, offset);

  return ftsRows
    .map((r) => getFile(r.id))
    .filter((f): f is FileWithTags => f !== null && f.status === "active");
}

export function markFileDeleted(source_id: string, path: string): boolean {
  const before = getDb().query<FileRow, [string, string]>(
    "SELECT * FROM files WHERE source_id=? AND path=? AND status='active'",
  ).get(source_id, path);
  const previousVersion = before ? getLatestFileVersion(before.id) : null;
  const result = getDb().run(
    "UPDATE files SET status='deleted', indexed_at=datetime('now'), sync_version=sync_version+1 WHERE source_id=? AND path=? AND status='active'",
    [source_id, path]
  );
  if (result.changes > 0) {
    const row = getDb().query<{ id: string }, [string, string]>(
      "SELECT id FROM files WHERE source_id=? AND path=?",
    ).get(source_id, path);
    if (row) {
      const currentVersion = upsertCurrentFileVersion(row.id);
      const next = getDb().query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(row.id);
      if (next) emitFileOutboxEvent("deleted", toFile(next), currentVersion, previousVersion);
    }
  }
  return result.changes > 0;
}

export function markFileDeletedById(id: string): boolean {
  const before = getDb().query<FileRow, [string]>(
    "SELECT * FROM files WHERE id=? AND status='active'",
  ).get(id);
  const previousVersion = before ? getLatestFileVersion(before.id) : null;
  const result = getDb().run(
    "UPDATE files SET status='deleted', indexed_at=datetime('now'), sync_version=sync_version+1 WHERE id=? AND status='active'",
    [id]
  );
  if (result.changes > 0) {
    const currentVersion = upsertCurrentFileVersion(id);
    const next = getDb().query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(id);
    if (next) emitFileOutboxEvent("deleted", toFile(next), currentVersion, previousVersion);
  }
  return result.changes > 0;
}

export function deleteFile(id: string): boolean {
  const before = getDb().query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(id);
  const previousVersion = before ? getLatestFileVersion(before.id) : null;
  const result = getDb().run("DELETE FROM files WHERE id=?", [id]);
  if (result.changes > 0 && before) {
    emitFileOutboxEvent("deleted", { ...toFile(before), status: "deleted" }, previousVersion, previousVersion, {
      physical_delete: true,
    });
  }
  return result.changes > 0;
}

export function getFileByPath(source_id: string, path: string): FileRecord | null {
  const row = getDb().query<FileRow, [string, string]>(
    "SELECT * FROM files WHERE source_id=? AND path=?"
  ).get(source_id, path);
  return row ? toFile(row) : null;
}

export function annotateFile(id: string, description: string): FileRecord | null {
  const db = getDb();
  const result = db.run("UPDATE files SET description = ?, sync_version = sync_version + 1 WHERE id = ?", [description, id]);
  if (result.changes === 0) return null;
  refreshFileFts(id);
  const file = toFile(db.query<FileRow, [string]>("SELECT * FROM files WHERE id=?").get(id)!);
  const version = getLatestFileVersion(id);
  emitFileOutboxEvent("updated", file, version, version, { metadata_changed: "description" });
  return file;
}

export function getMaxSyncVersion(): number {
  const row = getDb().query<{ max_v: number }, []>("SELECT COALESCE(MAX(sync_version), 0) as max_v FROM files").get();
  return row?.max_v ?? 0;
}

export function getFilesSince(since_version: number, limit = 200, offset = 0): FileRecord[] {
  return getDb()
    .query<FileRow, [number, number, number]>(
      "SELECT * FROM files WHERE sync_version > ? ORDER BY sync_version ASC LIMIT ? OFFSET ?"
    )
    .all(since_version, limit, offset)
    .map(toFile);
}

export function refreshAllFts(): void {
  const db = getDb();
  db.run("DELETE FROM files_fts");
  const files = db.query<FileRow, []>("SELECT * FROM files").all();
  for (const f of files) refreshFileFts(f.id);
}

// ── Data-plane operations that back the LocalStore ─────────────────────────────
// These are the SQLite implementations for the FilesStore methods the CLI/MCP
// used to run inline (via getDb) — relocated here so the db layer stays the one
// and only place that touches bun:sqlite.

/** Move a file to a new managed relative path within its source. */
export function moveFile(id: string, destPath: string): boolean {
  return getDb().run(
    "UPDATE files SET path=?, status='active', sync_version=sync_version+1 WHERE id=?",
    [destPath, id],
  ).changes > 0;
}

/** Rename a file and regenerate its canonical name. Returns the canonical name. */
export function renameFile(id: string, newName: string, ext: string): string | null {
  const canonical = generateCanonicalName(newName);
  const result = getDb().run(
    "UPDATE files SET name=?, original_name=?, canonical_name=?, ext=?, sync_version=sync_version+1 WHERE id=?",
    [newName, newName, canonical, ext, id],
  );
  if (result.changes === 0) return null;
  refreshFileFts(id);
  return canonical;
}

/** Soft-delete a file (status='deleted'). */
export function softDeleteFile(id: string): boolean {
  return getDb().run(
    "UPDATE files SET status='deleted', sync_version=sync_version+1 WHERE id=?",
    [id],
  ).changes > 0;
}

/** Restore a soft-deleted file. */
export function restoreFile(id: string): boolean {
  return getDb().run(
    "UPDATE files SET status='active', sync_version=sync_version+1 WHERE id=? AND status='deleted'",
    [id],
  ).changes > 0;
}

/** Group active files that share a BLAKE3 hash (duplicates). */
export function findDuplicates(source_id?: string): DuplicateGroup[] {
  const db = getDb();
  const filter = source_id ? "AND source_id = ?" : "";
  const params: SQLQueryBindings[] = source_id ? [source_id] : [];
  return db.query<DuplicateGroup, SQLQueryBindings[]>(
    `SELECT hash, COUNT(*) as cnt, GROUP_CONCAT(path, ' | ') as paths
     FROM files WHERE status='active' AND hash IS NOT NULL ${filter}
     GROUP BY hash HAVING cnt > 1 ORDER BY cnt DESC`,
  ).all(...params);
}

/** Aggregate statistics across all indexed files. */
export function computeStats(): Record<string, unknown> {
  const db = getDb();
  const totals = db.query<{ total_files: number; total_size: number }, []>(
    "SELECT COUNT(*) as total_files, COALESCE(SUM(size), 0) as total_size FROM files WHERE status='active'",
  ).get()!;
  const by_ext = db.query<{ ext: string; count: number }, []>(
    "SELECT ext, COUNT(*) as count FROM files WHERE status='active' GROUP BY ext ORDER BY count DESC LIMIT 20",
  ).all();
  const by_source = db.query<{ source_id: string; name: string; count: number }, []>(
    "SELECT f.source_id, s.name, COUNT(*) as count FROM files f JOIN sources s ON s.id=f.source_id WHERE f.status='active' GROUP BY f.source_id ORDER BY count DESC",
  ).all();
  const by_machine = db.query<{ machine_id: string; name: string; count: number }, []>(
    "SELECT f.machine_id, m.name, COUNT(*) as count FROM files f JOIN machines m ON m.id=f.machine_id WHERE f.status='active' GROUP BY f.machine_id ORDER BY count DESC",
  ).all();
  const by_tag = db.query<{ tag: string; count: number }, []>(
    "SELECT t.name as tag, COUNT(*) as count FROM file_tags ft JOIN tags t ON t.id=ft.tag_id GROUP BY t.name ORDER BY count DESC LIMIT 20",
  ).all();
  const total_collections = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM collections").get()!.cnt;
  const total_projects = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM projects").get()!.cnt;
  const total_agents = db.query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM agents").get()!.cnt;
  return { ...totals, by_ext, by_source, by_machine, by_tag, total_collections, total_projects, total_agents };
}

/** Batch-generate canonical names for files in a source that lack one. */
export function normalizeSource(source_id: string): number {
  const db = getDb();
  const rows = db.query<{ id: string; name: string }, [string]>(
    "SELECT id, name FROM files WHERE source_id = ? AND canonical_name IS NULL AND status = 'active'",
  ).all(source_id);
  let count = 0;
  for (const row of rows) {
    const canonical = generateCanonicalName(row.name);
    db.run("UPDATE files SET original_name = ?, canonical_name = ? WHERE id = ?", [row.name, canonical, row.id]);
    count++;
  }
  return count;
}

/** List files whose sync_status is 'conflict'. */
export function listConflicts(source_id?: string, limit = 50): FileWithTags[] {
  const db = getDb();
  const filter = source_id ? "AND source_id = ?" : "";
  const params: SQLQueryBindings[] = source_id ? [source_id, limit] : [limit];
  const rows = db.query<FileRow, SQLQueryBindings[]>(
    `SELECT * FROM files WHERE sync_status = 'conflict' ${filter} LIMIT ?`,
  ).all(...params);
  return rows.map((row) => ({ ...toFile(row), tags: [] }));
}

/** Resolve a sync conflict by marking the file synced. */
export function resolveConflict(id: string): boolean {
  return getDb().run(
    "UPDATE files SET sync_status = 'synced', sync_version = sync_version + 1 WHERE id = ?",
    [id],
  ).changes > 0;
}

/** Permanently remove soft-deleted files, optionally scoped/aged. */
export function purgeDeleted(source_id?: string, older_than?: string): number {
  const db = getDb();
  const conditions = ["status = 'deleted'"];
  const params: SQLQueryBindings[] = [];
  if (source_id) { conditions.push("source_id = ?"); params.push(source_id); }
  if (older_than) { conditions.push("indexed_at <= ?"); params.push(older_than); }
  return db.run(`DELETE FROM files WHERE ${conditions.join(" AND ")}`, params).changes;
}

/** Files most recently touched by agent activity. */
export function recentFiles(agent_id?: string, limit = 20): FileWithTags[] {
  const db = getDb();
  const query = agent_id
    ? "SELECT DISTINCT file_id, MAX(created_at) as last_touched FROM agent_activity WHERE file_id IS NOT NULL AND agent_id = ? GROUP BY file_id ORDER BY last_touched DESC LIMIT ?"
    : "SELECT DISTINCT file_id, MAX(created_at) as last_touched FROM agent_activity WHERE file_id IS NOT NULL GROUP BY file_id ORDER BY last_touched DESC LIMIT ?";
  const params: SQLQueryBindings[] = agent_id ? [agent_id, limit] : [limit];
  const rows = db.query<{ file_id: string; last_touched: string }, SQLQueryBindings[]>(query).all(...params);
  const out: FileWithTags[] = [];
  for (const r of rows) {
    const f = getFile(r.file_id);
    if (f) out.push({ ...f, last_touched: r.last_touched } as FileWithTags & { last_touched: string });
  }
  return out;
}

function classifyFileChange(
  existing: FileRow,
  input: Omit<FileRecord, "id" | "indexed_at" | "created_at"> & { id?: string },
): KnowledgeSourceOutboxEventType {
  if (input.status === "deleted" && existing.status !== "deleted") return "deleted";
  if (input.status === "moved" || existing.path !== input.path) return "moved";
  if ((existing.hash ?? null) !== (input.hash ?? null)) return "hash_changed";
  return "updated";
}

function emitFileOutboxEvent(
  eventType: KnowledgeSourceOutboxEventType,
  file: FileRecord,
  currentVersion: FileVersion | null,
  previousVersion: FileVersion | null,
  metadata: Record<string, unknown> = {},
): void {
  const sourceRef = currentVersion?.source_ref ?? previousVersion?.source_ref ?? buildOpenFilesFileRef(file.id);
  const hash = currentVersion?.content_hash ?? file.hash;
  appendKnowledgeSourceOutboxEvent({
    event_type: eventType,
    source_ref: sourceRef,
    file_id: file.id,
    source_id: file.source_id,
    revision_id: currentVersion?.id,
    previous_revision_id: previousVersion?.id,
    status: currentVersion?.state ?? file.status,
    hash: hash ? formatHash(currentVersion?.content_hash_algorithm, hash) : undefined,
    size: currentVersion?.size ?? file.size,
    mime: currentVersion?.mime ?? file.mime,
    path: currentVersion?.source_path ?? file.path,
    idempotency_key: buildFileOutboxIdempotencyKey(eventType, file, currentVersion, previousVersion, metadata),
    metadata,
  });
}

function buildFileOutboxIdempotencyKey(
  eventType: KnowledgeSourceOutboxEventType,
  file: FileRecord,
  currentVersion: FileVersion | null,
  previousVersion: FileVersion | null,
  metadata: Record<string, unknown>,
): string | undefined {
  if (metadata.metadata_changed || metadata.physical_delete) return undefined;
  return [
    eventType,
    file.id,
    previousVersion?.id ?? "",
    currentVersion?.id ?? "",
    file.status,
    file.path,
  ].join(":");
}

function formatHash(algorithm: string | undefined, hash: string): string {
  if (!algorithm || algorithm === "unknown") return hash;
  return `${algorithm}:${hash}`;
}
