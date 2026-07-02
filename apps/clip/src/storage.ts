import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { Buffer } from "node:buffer";
import { ensureClipHome, resolveArtifactDir, resolveDbPath, resolveHomeDir, isInMemoryDb } from "./paths.js";
import { buildShareUrl } from "./share.js";
import type { ClipClientOptions, ClipKind, ClipRecord, ClipStorageStatus, CreateClipMetadata, JsonObject } from "./types.js";
import { extensionForMime, generateSlug, inferMimeType, normalizeLimit, nowIso, parseJsonObject, sha256, stringifyJsonObject, textMimeType } from "./util.js";

interface ClipRow {
  id: string;
  slug: string;
  kind: ClipKind;
  title: string | null;
  mime_type: string;
  artifact_path: string | null;
  text_content: string | null;
  size_bytes: number;
  sha256: string;
  source: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateTextClipInput {
  text: string;
  title?: string;
  source?: string;
  metadata?: JsonObject;
  baseUrl?: string;
}

export interface CreateBufferClipInput {
  buffer: Uint8Array;
  title?: string;
  kind: ClipKind;
  mimeType: string;
  source?: string;
  metadata?: JsonObject;
  extension?: string;
  baseUrl?: string;
}

export interface CreateFileClipInput {
  path: string;
  title?: string;
  kind?: ClipKind;
  mimeType?: string;
  source?: string;
  metadata?: JsonObject;
  baseUrl?: string;
}

export function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT,
      mime_type TEXT NOT NULL,
      artifact_path TEXT,
      text_content TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'local',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_deleted_at ON clips(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_clips_kind ON clips(kind);
  `);
}

function openDatabase(path: string): Database {
  const db = new Database(path);
  if (!isInMemoryDb(path)) db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);
  return db;
}

function countValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function titleFromPath(path: string): string {
  return basename(path) || "clip";
}

export class ClipStore {
  readonly homeDir: string;
  readonly dbPath: string;
  readonly artifactDir: string;
  readonly db: Database;
  readonly options: ClipClientOptions;

  constructor(options: ClipClientOptions = {}) {
    this.options = options;
    this.homeDir = resolveHomeDir(options);
    this.dbPath = resolveDbPath(options);
    this.artifactDir = resolveArtifactDir(options);
    ensureClipHome(options);
    this.db = openDatabase(this.dbPath);
  }

  close(): void {
    this.db.close();
  }

  status(): ClipStorageStatus {
    const active = this.db.query("SELECT COUNT(*) AS count FROM clips WHERE deleted_at IS NULL").get() as { count: unknown } | null;
    const deleted = this.db.query("SELECT COUNT(*) AS count FROM clips WHERE deleted_at IS NOT NULL").get() as { count: unknown } | null;
    return {
      homeDir: this.homeDir,
      dbPath: this.dbPath,
      artifactDir: this.artifactDir,
      totalActive: countValue(active?.count),
      deleted: countValue(deleted?.count),
    };
  }

  createTextClip(input: CreateTextClipInput): ClipRecord {
    const text = input.text;
    const data = Buffer.from(text, "utf8");
    return this.insertClip({
      kind: "text",
      title: input.title ?? null,
      mimeType: textMimeType(),
      artifactPath: null,
      text,
      sizeBytes: data.byteLength,
      hash: sha256(data),
      source: input.source ?? "local",
      metadata: input.metadata,
      baseUrl: input.baseUrl,
    });
  }

  createBufferClip(input: CreateBufferClipInput): ClipRecord {
    const data = Buffer.from(input.buffer);
    const id = crypto.randomUUID();
    const extension = input.extension ?? extensionForMime(input.mimeType);
    const artifactPath = join(this.artifactDir, `${id}${extension}`);
    mkdirSync(this.artifactDir, { recursive: true });
    writeFileSync(artifactPath, data);
    return this.insertClip({
      id,
      kind: input.kind,
      title: input.title ?? null,
      mimeType: input.mimeType,
      artifactPath,
      text: null,
      sizeBytes: data.byteLength,
      hash: sha256(data),
      source: input.source ?? "local",
      metadata: input.metadata,
      baseUrl: input.baseUrl,
    });
  }

  createFileClip(input: CreateFileClipInput): ClipRecord {
    if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
    const stat = statSync(input.path);
    if (!stat.isFile()) throw new Error(`Not a file: ${input.path}`);
    const mimeType = input.mimeType ?? inferMimeType(input.path);
    const extension = extname(input.path) || extensionForMime(mimeType);
    const buffer = readFileSync(input.path);
    return this.createBufferClip({
      buffer,
      kind: input.kind ?? "file",
      title: input.title ?? titleFromPath(input.path),
      mimeType,
      source: input.source ?? "local-file",
      metadata: { path: input.path, ...(input.metadata ?? {}) },
      extension,
      baseUrl: input.baseUrl,
    });
  }

  listClips(options: { limit?: number; includeDeleted?: boolean; baseUrl?: string } = {}): ClipRecord[] {
    const limit = normalizeLimit(options.limit);
    const rows = options.includeDeleted
      ? this.db.query("SELECT * FROM clips ORDER BY created_at DESC LIMIT ?").all(limit)
      : this.db.query("SELECT * FROM clips WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?").all(limit);
    return (rows as ClipRow[]).map((row) => this.rowToRecord(row, options.baseUrl));
  }

  getClip(ref: string, options: { includeDeleted?: boolean; baseUrl?: string } = {}): ClipRecord | null {
    const sql = options.includeDeleted
      ? "SELECT * FROM clips WHERE id = ? OR slug = ? LIMIT 1"
      : "SELECT * FROM clips WHERE (id = ? OR slug = ?) AND deleted_at IS NULL LIMIT 1";
    const row = this.db.query(sql).get(ref, ref) as ClipRow | null;
    return row ? this.rowToRecord(row, options.baseUrl) : null;
  }

  deleteClip(ref: string): boolean {
    const now = nowIso();
    const result = this.db
      .query("UPDATE clips SET deleted_at = ?, updated_at = ? WHERE (id = ? OR slug = ?) AND deleted_at IS NULL")
      .run(now, now, ref, ref);
    return Number(result.changes ?? 0) > 0;
  }

  private insertClip(input: {
    id?: string;
    kind: ClipKind;
    title: string | null;
    mimeType: string;
    artifactPath: string | null;
    text: string | null;
    sizeBytes: number;
    hash: string;
    source: string;
    metadata?: JsonObject;
    baseUrl?: string;
  }): ClipRecord {
    const id = input.id ?? crypto.randomUUID();
    let slug = generateSlug();
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const existing = this.db.query("SELECT id FROM clips WHERE slug = ? LIMIT 1").get(slug);
      if (!existing) break;
      slug = generateSlug();
    }
    const now = nowIso();
    this.db
      .query(`
        INSERT INTO clips (
          id, slug, kind, title, mime_type, artifact_path, text_content,
          size_bytes, sha256, source, metadata_json, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      `)
      .run(
        id,
        slug,
        input.kind,
        input.title,
        input.mimeType,
        input.artifactPath,
        input.text,
        input.sizeBytes,
        input.hash,
        input.source,
        stringifyJsonObject(input.metadata),
        now,
        now,
      );
    const record = this.getClip(id, { baseUrl: input.baseUrl })!;
    return record;
  }

  private rowToRecord(row: ClipRow, baseUrl?: string): ClipRecord {
    const record: ClipRecord = {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      mimeType: row.mime_type,
      artifactPath: row.artifact_path,
      text: row.text_content,
      sizeBytes: row.size_bytes,
      sha256: row.sha256,
      source: row.source,
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
    return { ...record, shareUrl: buildShareUrl(record, { ...this.options, baseUrl: baseUrl ?? this.options.baseUrl }) };
  }
}
