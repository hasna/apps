import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, resolve } from "node:path";
import { getIndexDb } from "../../db/index-db.js";
import { getConfig } from "../config.js";
import { generateId } from "../../types/index.js";
import {
  scanRoot,
  hasBinaryExtension,
  isBinaryFile,
  isContentExcluded,
  type ScannedFile,
} from "./walker.js";

export interface IndexRoot {
  id: string;
  path: string;
  name: string;
  exclude: string[];
  contentIndexing: boolean;
  maxFileSize: number;
  status: "pending" | "indexing" | "ready" | "error";
  error: string | null;
  fileCount: number;
  lastIndexedAt: string | null;
  lastDurationMs: number | null;
  createdAt: string;
}

export interface IndexStats {
  rootId: string;
  added: number;
  updated: number;
  deleted: number;
  contentIndexed: number;
  fileCount: number;
  /** Unreadable directories (permissions, IO) skipped during the scan. */
  skippedDirs: number;
  durationMs: number;
}

interface RootRow {
  id: string;
  path: string;
  name: string;
  exclude: string;
  content_indexing: number;
  max_file_size: number;
  status: string;
  error: string | null;
  file_count: number;
  last_indexed_at: string | null;
  last_duration_ms: number | null;
  created_at: string;
}

interface FileRow {
  id: number;
  rel_path: string;
  size: number;
  mtime_ms: number;
  content_indexed: number;
}

function rowToRoot(row: RootRow): IndexRoot {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    exclude: JSON.parse(row.exclude) as string[],
    contentIndexing: Boolean(row.content_indexing),
    maxFileSize: row.max_file_size,
    status: row.status as IndexRoot["status"],
    error: row.error,
    fileCount: row.file_count,
    lastIndexedAt: row.last_indexed_at,
    lastDurationMs: row.last_duration_ms,
    createdAt: row.created_at,
  };
}

export function normalizeRootPath(path: string): string {
  const expanded = path === "~" ? homedir() : path.startsWith("~/") ? `${homedir()}/${path.slice(2)}` : path;
  return resolve(expanded.replace(/\/+$/, "") || "/");
}

export function listRoots(db?: Database): IndexRoot[] {
  const d = db ?? getIndexDb();
  const rows = d.query("SELECT * FROM index_roots ORDER BY path").all() as RootRow[];
  return rows.map(rowToRoot);
}

export function getRoot(ref: string, db?: Database): IndexRoot | null {
  const d = db ?? getIndexDb();
  const row = d
    .prepare(
      `SELECT *, CASE WHEN id = $ref THEN 0 WHEN path = $path THEN 1 ELSE 2 END AS priority
       FROM index_roots
       WHERE id = $ref OR path = $path OR name = $ref
       ORDER BY priority LIMIT 1`,
    )
    .get({ $ref: ref, $path: normalizeRootPath(ref) } as never) as RootRow | null;
  return row ? rowToRoot(row) : null;
}

export function hasReadyRoot(db?: Database): boolean {
  const d = db ?? getIndexDb();
  const row = d.query("SELECT 1 FROM index_roots WHERE status = 'ready' LIMIT 1").get();
  return row !== null;
}

export function addRoot(
  path: string,
  opts: { name?: string; contentIndexing?: boolean; exclude?: string[]; maxFileSize?: number } = {},
  db?: Database,
): IndexRoot {
  const d = db ?? getIndexDb();
  const normalized = normalizeRootPath(path);

  let stat;
  try {
    stat = statSync(normalized);
  } catch {
    throw new Error(`Path does not exist: ${normalized}`);
  }
  if (!stat.isDirectory()) throw new Error(`Not a directory: ${normalized}`);

  if (opts.maxFileSize !== undefined && (!Number.isFinite(opts.maxFileSize) || opts.maxFileSize < 1)) {
    throw new Error("maxFileSize must be a positive number of bytes");
  }

  const existing = getRoot(normalized, d);
  if (existing && existing.path === normalized) {
    throw new Error(`Root already indexed: ${existing.path} (${existing.id})`);
  }

  const name = opts.name ?? basename(normalized);
  const nameClash = d.prepare("SELECT path FROM index_roots WHERE name = ?").get(name) as
    | { path: string }
    | null;
  if (nameClash) {
    throw new Error(`Root name "${name}" already used by ${nameClash.path} — pass a different name.`);
  }

  const id = generateId();
  d.prepare(
    `INSERT INTO index_roots (id, path, name, exclude, content_indexing, max_file_size, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    normalized,
    name,
    JSON.stringify(opts.exclude ?? []),
    opts.contentIndexing === false ? 0 : 1,
    opts.maxFileSize ?? 524288,
    new Date().toISOString(),
  );

  return getRoot(id, d)!;
}

export function removeRoot(idOrPath: string, db?: Database): boolean {
  const d = db ?? getIndexDb();
  const root = getRoot(idOrPath, d);
  if (!root) return false;

  d.exec("BEGIN");
  try {
    d.prepare(
      "DELETE FROM file_content_fts WHERE rowid IN (SELECT id FROM files WHERE root_id = ? AND content_indexed = 1)",
    ).run(root.id);
    d.prepare("DELETE FROM index_roots WHERE id = ?").run(root.id);
    d.exec("COMMIT");
  } catch (err) {
    d.exec("ROLLBACK");
    throw err;
  }
  return true;
}

function shouldIndexContent(root: IndexRoot, file: ScannedFile): boolean {
  return (
    root.contentIndexing &&
    file.size > 0 &&
    file.size <= root.maxFileSize &&
    !hasBinaryExtension(file.ext) &&
    !isContentExcluded(file.name)
  );
}

/**
 * Index (or incrementally re-index) a root: scan the tree, diff against the
 * stored file list by (size, mtime), and apply inserts/updates/deletes.
 * Content indexing reads only new/changed text files.
 */
export function indexRoot(
  idOrPath: string,
  opts: { force?: boolean } = {},
  db?: Database,
): IndexStats {
  const d = db ?? getIndexDb();
  const root = getRoot(idOrPath, d);
  if (!root) throw new Error(`Index root not found: ${idOrPath}`);

  const start = Date.now();
  d.prepare("UPDATE index_roots SET status = 'indexing', error = NULL WHERE id = ?").run(root.id);

  try {
    const { files: scanned, skippedDirs } = scanRoot(root.path, root.exclude);
    const now = new Date().toISOString();

    const existingRows = d
      .prepare("SELECT id, rel_path, size, mtime_ms, content_indexed FROM files WHERE root_id = ?")
      .all(root.id) as FileRow[];
    const existing = new Map(existingRows.map((r) => [r.rel_path, r]));

    const insertFile = d.prepare(
      `INSERT INTO files (root_id, rel_path, name, ext, dir, size, mtime_ms, is_binary, content_indexed, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateFile = d.prepare(
      "UPDATE files SET size = ?, mtime_ms = ?, is_binary = ?, content_indexed = ?, indexed_at = ? WHERE id = ?",
    );
    const deleteFile = d.prepare("DELETE FROM files WHERE id = ?");
    const insertContent = d.prepare("INSERT INTO file_content_fts (rowid, body) VALUES (?, ?)");
    const deleteContent = d.prepare("DELETE FROM file_content_fts WHERE rowid = ?");

    const stats: IndexStats = {
      rootId: root.id,
      added: 0,
      updated: 0,
      deleted: 0,
      contentIndexed: 0,
      fileCount: scanned.length,
      skippedDirs: skippedDirs.length,
      durationMs: 0,
    };

    d.exec("BEGIN");
    try {
      const seen = new Set<string>();

      for (const file of scanned) {
        seen.add(file.relPath);
        const prev = existing.get(file.relPath);
        const changed = !prev || prev.size !== file.size || prev.mtime_ms !== file.mtimeMs;
        if (prev && !changed && !opts.force) continue;

        const wantContent = shouldIndexContent(root, file);
        const absPath = `${root.path}/${file.relPath}`;
        let isBinary = wantContent ? isBinaryFile(absPath) : hasBinaryExtension(file.ext);
        let body: string | null = null;
        if (wantContent && !isBinary) {
          try {
            body = readFileSync(absPath, "utf-8");
          } catch {
            isBinary = true;
          }
        }
        const contentIndexed = body !== null ? 1 : 0;

        if (prev) {
          if (prev.content_indexed) deleteContent.run(prev.id);
          updateFile.run(file.size, file.mtimeMs, isBinary ? 1 : 0, contentIndexed, now, prev.id);
          if (body !== null) insertContent.run(prev.id, body);
          stats.updated++;
        } else {
          const inserted = insertFile.run(
            root.id,
            file.relPath,
            file.name,
            file.ext,
            file.dir,
            file.size,
            file.mtimeMs,
            isBinary ? 1 : 0,
            contentIndexed,
            now,
          );
          if (body !== null) insertContent.run(Number(inserted.lastInsertRowid), body);
          stats.added++;
        }
        if (contentIndexed) stats.contentIndexed++;
      }

      for (const [relPath, row] of existing) {
        if (seen.has(relPath)) continue;
        if (row.content_indexed) deleteContent.run(row.id);
        deleteFile.run(row.id);
        stats.deleted++;
      }

      stats.durationMs = Date.now() - start;
      d.prepare(
        "UPDATE index_roots SET status = 'ready', file_count = ?, last_indexed_at = ?, last_duration_ms = ? WHERE id = ?",
      ).run(scanned.length, now, stats.durationMs, root.id);
      d.exec("COMMIT");
    } catch (err) {
      d.exec("ROLLBACK");
      throw err;
    }

    return stats;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    d.prepare("UPDATE index_roots SET status = 'error', error = ? WHERE id = ?").run(message, root.id);
    throw err;
  }
}

export function indexAllRoots(opts: { force?: boolean } = {}, db?: Database): IndexStats[] {
  return listRoots(db).map((root) => indexRoot(root.id, opts, db));
}

const refreshing = new Set<string>();

/**
 * Incrementally refresh roots whose index is older than `staleMinutes`.
 * Synchronous (an incremental pass on an unchanged tree is fast); guarded
 * against concurrent refreshes of the same root within this process.
 */
export function refreshStaleRoots(staleMinutes: number, db?: Database): IndexStats[] {
  const cutoff = Date.now() - staleMinutes * 60_000;
  const stats: IndexStats[] = [];

  for (const root of listRoots(db)) {
    if (root.status === "indexing" || root.status === "pending") continue;
    if (root.lastIndexedAt && Date.parse(root.lastIndexedAt) > cutoff) continue;
    if (refreshing.has(root.id)) continue;

    refreshing.add(root.id);
    try {
      stats.push(indexRoot(root.id, {}, db));
    } catch {
      // An unreadable root must not break search; status='error' records it.
    } finally {
      refreshing.delete(root.id);
    }
  }

  return stats;
}

/** Refresh stale roots according to the user's config (called before local searches). */
export function autoRefreshStaleRoots(db?: Database): IndexStats[] {
  const config = getConfig();
  if (!config.indexAutoRefresh) return [];
  return refreshStaleRoots(config.indexStaleMinutes, db);
}

/**
 * Keep the index warm from long-running processes (search-serve, search-mcp)
 * so interactive `find` calls rarely pay the stale-refresh cost themselves.
 */
export function startBackgroundRefresh(): ReturnType<typeof setInterval> {
  const minutes = Math.max(1, getConfig().indexStaleMinutes);
  const timer = setInterval(() => {
    try {
      autoRefreshStaleRoots();
    } catch (err) {
      console.error("Index refresh failed:", err);
    }
  }, minutes * 60_000);
  timer.unref?.();
  return timer;
}
