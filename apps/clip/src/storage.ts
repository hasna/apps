import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { Buffer } from "node:buffer";
import { ensureClipHome, resolveArtifactDir, resolveConfigPath, resolveDbPath, resolveHomeDir, isInMemoryDb, userHome } from "./paths.js";
import { buildShareUrl } from "./share.js";
import type { ClipboardHistoryKind, ClipboardHistoryRecord, ClipClientOptions, ClipKind, ClipPruneArtifact, ClipPruneResult, ClipRecord, ClipStorageStatus, CreateClipMetadata, JsonObject } from "./types.js";
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
  expires_at: string | null;
}

interface ClipboardHistoryRow {
  id: string;
  slug: string;
  kind: ClipboardHistoryKind;
  title: string | null;
  mime_type: string;
  artifact_path: string | null;
  text_content: string | null;
  size_bytes: number;
  sha256: string;
  source: string;
  metadata_json: string;
  created_at: string;
}

export interface CreateTextClipInput {
  text: string;
  title?: string;
  source?: string;
  metadata?: JsonObject;
  baseUrl?: string;
  expiresAt?: string | null;
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
  expiresAt?: string | null;
}

export interface CreateFileClipInput {
  path: string;
  title?: string;
  kind?: ClipKind;
  mimeType?: string;
  source?: string;
  metadata?: JsonObject;
  baseUrl?: string;
  expiresAt?: string | null;
}

export interface PruneExpiredSharesOptions {
  dryRun?: boolean;
  now?: string | Date;
}

function hasColumn(db: Database, table: string, column: string): boolean {
  const rows = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureColumn(db: Database, table: string, column: string, definition: string): void {
  if (hasColumn(db, table, column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.toLowerCase().includes("duplicate column")) throw error;
  }
}

export interface AddClipboardHistoryInput {
  kind: ClipboardHistoryKind;
  title?: string;
  text?: string;
  buffer?: Uint8Array;
  path?: string;
  mimeType?: string;
  source?: string;
  metadata?: JsonObject;
  extension?: string;
  maxItems?: number;
}

export interface PurgeClipStoreResult {
  homeDir: string;
  dbPath: string;
  artifactDir: string;
  configPath: string;
  removed: boolean;
  homeRemoved: boolean;
}

export interface PurgeClipStoreOptions extends ClipClientOptions {
  confirm?: boolean;
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
      deleted_at TEXT,
      expires_at TEXT
    );
  `);
  ensureColumn(db, "clips", "expires_at", "expires_at TEXT");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clips_deleted_at ON clips(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_clips_expires_at ON clips(expires_at);
    CREATE INDEX IF NOT EXISTS idx_clips_kind ON clips(kind);

    CREATE TABLE IF NOT EXISTS clipboard_history (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      title TEXT,
      mime_type TEXT NOT NULL,
      artifact_path TEXT,
      text_content TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'clipboard',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clipboard_history_created_at ON clipboard_history(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_clipboard_history_kind ON clipboard_history(kind);
  `);
}

function openDatabase(path: string): Database {
  const db = new Database(path);
  if (!isInMemoryDb(path)) db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  secureDatabaseFiles(path);
  ensureSchema(db);
  secureDatabaseFiles(path);
  return db;
}

function secureDatabaseFiles(path: string): void {
  if (isInMemoryDb(path)) return;
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (!existsSync(file)) continue;
    try {
      chmodSync(file, 0o600);
    } catch {
      continue;
    }
  }
}

function countValue(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function titleFromPath(path: string): string {
  return basename(path) || "clip";
}

function assertSafePurgeHome(homeDir: string): void {
  const target = resolve(homeDir);
  if (target === parse(target).root) throw new Error("Refusing to purge the filesystem root");

  const home = resolve(userHome());
  if (target === home) throw new Error("Refusing to purge the user home directory");

  const hasnaRoot = resolve(home, ".hasna");
  if (target === hasnaRoot) throw new Error("Refusing to purge the whole ~/.hasna directory");
}

function isChildPath(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return Boolean(fromParent) && !fromParent.startsWith("..") && !isAbsolute(fromParent);
}

function removePathIfPresent(path: string, recursive = false): boolean {
  if (!existsSync(path)) return false;
  rmSync(path, { recursive, force: true });
  return true;
}

function assertPurgeTargetInHome(homeDir: string, targetPath: string, label: string): void {
  if (!isChildPath(homeDir, targetPath)) throw new Error(`Refusing to purge ${label} outside clip home: ${targetPath}`);
}

export function purgeClipStore(options: PurgeClipStoreOptions = {}): PurgeClipStoreResult {
  if (!options.confirm) throw new Error("Refusing to purge clip data without explicit confirmation");

  const homeDir = resolveHomeDir(options);
  const dbPath = resolveDbPath(options);
  const artifactDir = resolveArtifactDir(options);
  const configPath = resolveConfigPath(options);

  assertSafePurgeHome(homeDir);
  if (!isInMemoryDb(dbPath)) assertPurgeTargetInHome(homeDir, dbPath, "database path");
  assertPurgeTargetInHome(homeDir, artifactDir, "artifact directory");

  let removed = false;
  if (existsSync(homeDir)) {
    const stat = lstatSync(homeDir);
    if (!stat.isDirectory()) throw new Error(`Clip home is not a directory: ${homeDir}`);
  }

  if (!isInMemoryDb(dbPath)) {
    removed = removePathIfPresent(dbPath) || removed;
    removed = removePathIfPresent(`${dbPath}-wal`) || removed;
    removed = removePathIfPresent(`${dbPath}-shm`) || removed;
  }
  removed = removePathIfPresent(artifactDir, true) || removed;
  removed = removePathIfPresent(configPath) || removed;

  let homeRemoved = false;
  if (existsSync(homeDir) && readdirSync(homeDir).length === 0) {
    rmdirSync(homeDir);
    removed = true;
    homeRemoved = true;
  }

  return { homeDir, dbPath, artifactDir, configPath, removed, homeRemoved };
}

function normalizeExpiresAt(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("expiresAt must be a valid date or ISO timestamp.");
  return date.toISOString();
}

function normalizeDate(value: string | Date | undefined): string {
  const date = value === undefined ? new Date() : value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Prune time must be a valid date or ISO timestamp.");
  return date.toISOString();
}

function isPathInside(path: string, dir: string): boolean {
  const relativePath = relative(resolve(dir), resolve(path));
  return relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function artifactFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...artifactFiles(path));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      files.push(resolve(path));
    }
  }
  return files;
}

function isGeneratedArtifactPath(path: string): boolean {
  const name = basename(path);
  const ext = extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stem);
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
    const now = nowIso();
    const active = this.db
      .query("SELECT COUNT(*) AS count FROM clips WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .get(now) as { count: unknown } | null;
    const expired = this.db
      .query("SELECT COUNT(*) AS count FROM clips WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?")
      .get(now) as { count: unknown } | null;
    const deleted = this.db.query("SELECT COUNT(*) AS count FROM clips WHERE deleted_at IS NOT NULL").get() as { count: unknown } | null;
    return {
      homeDir: this.homeDir,
      dbPath: this.dbPath,
      artifactDir: this.artifactDir,
      totalActive: countValue(active?.count),
      expired: countValue(expired?.count),
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
      expiresAt: normalizeExpiresAt(input.expiresAt),
    });
  }

  createBufferClip(input: CreateBufferClipInput): ClipRecord {
    const data = Buffer.from(input.buffer);
    const expiresAt = normalizeExpiresAt(input.expiresAt);
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
      expiresAt,
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
      expiresAt: normalizeExpiresAt(input.expiresAt),
    });
  }

  listClips(options: { limit?: number; includeDeleted?: boolean; baseUrl?: string } = {}): ClipRecord[] {
    const limit = normalizeLimit(options.limit);
    const now = nowIso();
    const rows = options.includeDeleted
      ? this.db.query("SELECT * FROM clips ORDER BY created_at DESC LIMIT ?").all(limit)
      : this.db
        .query("SELECT * FROM clips WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?")
        .all(now, limit);
    return (rows as ClipRow[]).map((row) => this.rowToRecord(row, options.baseUrl));
  }

  getClip(ref: string, options: { includeDeleted?: boolean; baseUrl?: string } = {}): ClipRecord | null {
    const now = nowIso();
    const sql = options.includeDeleted
      ? "SELECT * FROM clips WHERE id = ? OR slug = ? LIMIT 1"
      : "SELECT * FROM clips WHERE (id = ? OR slug = ?) AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) LIMIT 1";
    const row = options.includeDeleted
      ? this.db.query(sql).get(ref, ref) as ClipRow | null
      : this.db.query(sql).get(ref, ref, now) as ClipRow | null;
    return row ? this.rowToRecord(row, options.baseUrl) : null;
  }

  deleteClip(ref: string): boolean {
    const now = nowIso();
    const result = this.db
      .query("UPDATE clips SET deleted_at = ?, updated_at = ? WHERE (id = ? OR slug = ?) AND deleted_at IS NULL")
      .run(now, now, ref, ref);
    return Number(result.changes ?? 0) > 0;
  }

  addClipboardHistory(input: AddClipboardHistoryInput): ClipboardHistoryRecord {
    const id = crypto.randomUUID();
    const now = nowIso();
    let artifactPath: string | null = null;
    let text: string | null = null;
    let data: Buffer;
    let mimeType = input.mimeType;
    let title = input.title ?? null;

    if (input.text !== undefined) {
      text = input.text;
      data = Buffer.from(input.text, "utf8");
      mimeType = mimeType ?? textMimeType();
      title = title ?? "Clipboard text";
    } else if (input.path) {
      if (!existsSync(input.path)) throw new Error(`File not found: ${input.path}`);
      const stat = statSync(input.path);
      if (!stat.isFile()) throw new Error(`Not a file: ${input.path}`);
      data = readFileSync(input.path);
      mimeType = mimeType ?? inferMimeType(input.path);
      title = title ?? titleFromPath(input.path);
      const extension = input.extension ?? (extname(input.path) || extensionForMime(mimeType));
      artifactPath = this.writeHistoryArtifact(id, data, extension);
    } else if (input.buffer !== undefined) {
      data = Buffer.from(input.buffer);
      mimeType = mimeType ?? "application/octet-stream";
      title = title ?? "Clipboard item";
      artifactPath = this.writeHistoryArtifact(id, data, input.extension ?? extensionForMime(mimeType));
    } else {
      throw new Error("Clipboard history requires text, buffer, or file path content.");
    }

    let slug = generateSlug();
    for (let attempts = 0; attempts < 5; attempts += 1) {
      const existing = this.db.query("SELECT id FROM clipboard_history WHERE slug = ? LIMIT 1").get(slug);
      if (!existing) break;
      slug = generateSlug();
    }

    this.db
      .query(`
        INSERT INTO clipboard_history (
          id, slug, kind, title, mime_type, artifact_path, text_content,
          size_bytes, sha256, source, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        slug,
        input.kind,
        title,
        mimeType,
        artifactPath,
        text,
        data.byteLength,
        sha256(data),
        input.source ?? "clipboard",
        stringifyJsonObject(input.metadata),
        now,
      );

    this.pruneClipboardHistory(input.maxItems);
    const record = this.getClipboardHistory(id);
    if (!record) throw new Error("Clipboard history capture failed.");
    return record;
  }

  listClipboardHistory(options: { limit?: number } = {}): ClipboardHistoryRecord[] {
    const limit = normalizeLimit(options.limit);
    const rows = this.db
      .query("SELECT * FROM clipboard_history ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(limit) as ClipboardHistoryRow[];
    return rows.map((row) => this.historyRowToRecord(row));
  }

  getClipboardHistory(ref: string): ClipboardHistoryRecord | null {
    const row = this.db
      .query("SELECT * FROM clipboard_history WHERE id = ? OR slug = ? LIMIT 1")
      .get(ref, ref) as ClipboardHistoryRow | null;
    return row ? this.historyRowToRecord(row) : null;
  }

  shareClipboardHistory(ref: string, options: { title?: string; baseUrl?: string } = {}): ClipRecord {
    const entry = this.getClipboardHistory(ref);
    if (!entry) throw new Error(`Clipboard history item not found: ${ref}`);
    const metadata = {
      clipboardHistoryId: entry.id,
      clipboardHistorySlug: entry.slug,
      clipboardHistoryKind: entry.kind,
    };
    if (entry.text !== null) {
      return this.createTextClip({
        text: entry.text,
        title: options.title ?? entry.title ?? "Clipboard text",
        source: "history:clipboard",
        metadata,
        baseUrl: options.baseUrl,
      });
    }
    if (!entry.artifactPath || !existsSync(entry.artifactPath)) {
      throw new Error(`Clipboard history artifact is missing for ${ref}`);
    }
    return this.createBufferClip({
      buffer: readFileSync(entry.artifactPath),
      kind: entry.kind,
      title: options.title ?? entry.title ?? "Clipboard item",
      mimeType: entry.mimeType,
      source: "history:clipboard",
      metadata,
      extension: extensionForMime(entry.mimeType),
      baseUrl: options.baseUrl,
    });
  }

  pruneClipboardHistory(maxItems = 25): void {
    const limit = normalizeLimit(maxItems, 25, 100);
    const rows = this.db
      .query(`
        SELECT id, artifact_path FROM clipboard_history
        WHERE id NOT IN (
          SELECT id FROM clipboard_history ORDER BY created_at DESC, rowid DESC LIMIT ?
        )
      `)
      .all(limit) as Array<{ id: string; artifact_path: string | null }>;
    if (rows.length === 0) return;

    const deleteIds: string[] = [];
    for (const row of rows) {
      if (row.artifact_path && this.isManagedHistoryArtifact(row.artifact_path)) {
        try {
          unlinkSync(row.artifact_path);
        } catch {
          continue;
        }
      }
      deleteIds.push(row.id);
    }
    if (deleteIds.length === 0) return;
    const placeholders = deleteIds.map(() => "?").join(", ");
    this.db.query(`DELETE FROM clipboard_history WHERE id IN (${placeholders})`).run(...deleteIds);
  }

  pruneExpiredShares(options: PruneExpiredSharesOptions = {}): ClipPruneResult {
    const dryRun = options.dryRun ?? true;
    const now = normalizeDate(options.now);
    const expiredRows = this.db
      .query("SELECT * FROM clips WHERE deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC")
      .all(now) as ClipRow[];
    const artifacts = this.pruneArtifactCandidates(expiredRows, now);
    let prunedShares = 0;

    if (!dryRun) {
      for (const row of expiredRows) {
        const result = this.db
          .query("UPDATE clips SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
          .run(now, now, row.id);
        prunedShares += Number(result.changes ?? 0);
      }
      for (const artifact of artifacts) this.removePruneArtifact(artifact);
    }

    return {
      dryRun,
      now,
      prunedShares,
      removedArtifacts: artifacts.filter((artifact) => artifact.removed).length,
      expiredShares: expiredRows.map((row) => ({
        id: row.id,
        slug: row.slug,
        artifactPath: row.artifact_path,
        expiresAt: row.expires_at!,
      })),
      artifacts,
    };
  }

  private pruneArtifactCandidates(expiredRows: ClipRow[], now: string): ClipPruneArtifact[] {
    const retainedArtifactPaths = new Set<string>();
    const retainedRows = this.db
      .query("SELECT artifact_path FROM clips WHERE artifact_path IS NOT NULL AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)")
      .all(now) as Array<{ artifact_path: string | null }>;
    for (const row of retainedRows) {
      if (row.artifact_path && isPathInside(row.artifact_path, this.artifactDir)) {
        retainedArtifactPaths.add(resolve(row.artifact_path));
      }
    }

    const artifacts = new Map<string, ClipPruneArtifact>();
    const addArtifact = (path: string, reason: ClipPruneArtifact["reason"]) => {
      const resolvedPath = resolve(path);
      if (!isPathInside(resolvedPath, this.artifactDir)) {
        artifacts.set(resolvedPath, {
          path: resolvedPath,
          reason,
          removed: false,
          skippedReason: "outside artifact directory",
        });
        return;
      }
      if (retainedArtifactPaths.has(resolvedPath)) return;
      const existing = artifacts.get(resolvedPath);
      if (!existing) {
        artifacts.set(resolvedPath, { path: resolvedPath, reason, removed: false });
      } else if (existing.reason === "orphaned" && reason === "expired-share") {
        existing.reason = "expired-share";
      }
    };

    for (const row of expiredRows) {
      if (row.artifact_path) addArtifact(row.artifact_path, "expired-share");
    }
    for (const path of artifactFiles(this.artifactDir)) {
      if (!isGeneratedArtifactPath(path)) continue;
      if (!retainedArtifactPaths.has(resolve(path))) addArtifact(path, "orphaned");
    }
    return [...artifacts.values()].sort((left, right) => left.path.localeCompare(right.path));
  }

  private removePruneArtifact(artifact: ClipPruneArtifact): void {
    if (artifact.skippedReason) return;
    try {
      if (!existsSync(artifact.path)) {
        artifact.skippedReason = "artifact not found";
        return;
      }
      if (!isPathInside(artifact.path, this.artifactDir)) {
        artifact.skippedReason = "outside artifact directory";
        return;
      }
      const stat = lstatSync(artifact.path);
      if (!stat.isFile() && !stat.isSymbolicLink()) {
        artifact.skippedReason = "not a file";
        return;
      }
      unlinkSync(artifact.path);
      artifact.removed = true;
    } catch (error) {
      artifact.error = error instanceof Error ? error.message : String(error);
    }
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
    expiresAt: string | null;
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
          size_bytes, sha256, source, metadata_json, created_at, updated_at, deleted_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
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
        input.expiresAt,
      );
    const record = this.getClip(id, { includeDeleted: true, baseUrl: input.baseUrl })!;
    return record;
  }

  private writeHistoryArtifact(id: string, data: Uint8Array, extension: string): string {
    const artifactPath = join(this.artifactDir, `history-${id}${extension}`);
    mkdirSync(this.artifactDir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(this.artifactDir, 0o700);
    } catch {
      // Best effort for platforms without POSIX file modes.
    }
    writeFileSync(artifactPath, data, { mode: 0o600 });
    try {
      chmodSync(artifactPath, 0o600);
    } catch {
      // Best effort for platforms without POSIX file modes.
    }
    return artifactPath;
  }

  private isManagedHistoryArtifact(path: string): boolean {
    const artifactDir = resolve(this.artifactDir);
    const artifactPath = resolve(path);
    return artifactPath.startsWith(`${artifactDir}${sep}`) && basename(artifactPath).startsWith("history-");
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
      expiresAt: row.expires_at,
    };
    return { ...record, shareUrl: buildShareUrl(record, { ...this.options, baseUrl: baseUrl ?? this.options.baseUrl }) };
  }

  private historyRowToRecord(row: ClipboardHistoryRow): ClipboardHistoryRecord {
    return {
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
    };
  }
}
