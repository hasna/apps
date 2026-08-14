import { randomUUID } from "node:crypto";
import { join, basename, extname } from "node:path";
import { existsSync, readdirSync, statSync, unlinkSync, copyFileSync, readFileSync } from "node:fs";
import type { DownloadedFile } from "../types/index.js";
import { getDataDir } from "../db/schema.js";
import { ensureOwnerOnlyDir, ensureOwnerOnlyFile, sanitizeUrlForPersistence, writeOwnerOnlyFile, writePlainJsonFile } from "./security.js";

export function getDownloadsDir(sessionId?: string): string {
  const base = join(getDataDir(), "downloads");
  const dir = sessionId ? join(base, sessionId) : base;
  ensureOwnerOnlyDir(dir);
  return dir;
}

export function ensureDownloadsDir(): string {
  return getDownloadsDir();
}

interface DownloadMeta {
  id: string;
  type: string;
  source_url?: string;
  session_id?: string;
  created_at: string;
  size_bytes: number;
  original_name: string;
}

function metaPath(filePath: string): string {
  return `${filePath}.meta.json`;
}

function uniqueDownloadPath(filename: string, sessionId?: string): { id: string; filePath: string; filename: string } {
  const dir = getDownloadsDir(sessionId);
  const id = randomUUID();
  const ext = extname(filename) || "";
  const stem = basename(filename, ext);
  const uniqueName = `${stem}-${id.slice(0, 8)}${ext}`;
  return { id, filePath: join(dir, uniqueName), filename: uniqueName };
}

function writeDownloadMeta(
  filePath: string,
  id: string,
  originalName: string,
  sizeBytes: number,
  opts?: { sessionId?: string; type?: string; sourceUrl?: string; metadata?: Record<string, unknown> }
): DownloadMeta {
  const meta: DownloadMeta = {
    id,
    type: opts?.type ?? detectType(originalName),
    source_url: sanitizeUrlForPersistence(opts?.sourceUrl) ?? undefined,
    session_id: opts?.sessionId,
    created_at: new Date().toISOString(),
    size_bytes: sizeBytes,
    original_name: originalName,
    ...opts?.metadata,
  } as DownloadMeta;

  writePlainJsonFile(metaPath(filePath), meta);
  return meta;
}

export function saveToDownloads(
  buffer: Buffer,
  filename: string,
  opts?: { sessionId?: string; type?: string; sourceUrl?: string; metadata?: Record<string, unknown> }
): DownloadedFile {
  const { id, filePath, filename: uniqueName } = uniqueDownloadPath(filename, opts?.sessionId);

  writeOwnerOnlyFile(filePath, buffer);

  const meta = writeDownloadMeta(filePath, id, filename, buffer.length, opts);

  return {
    id,
    path: filePath,
    filename: uniqueName,
    type: meta.type,
    source_url: meta.source_url,
    session_id: meta.session_id,
    created_at: meta.created_at,
    size_bytes: buffer.length,
    meta_path: metaPath(filePath),
  };
}

export function importFileToDownloads(
  sourcePath: string,
  filename?: string,
  opts?: { sessionId?: string; type?: string; sourceUrl?: string; metadata?: Record<string, unknown> }
): DownloadedFile {
  const originalName = filename ?? basename(sourcePath);
  const { id, filePath, filename: uniqueName } = uniqueDownloadPath(originalName, opts?.sessionId);
  copyFileSync(sourcePath, filePath);
  ensureOwnerOnlyFile(filePath);
  const sizeBytes = statSync(filePath).size;
  const meta = writeDownloadMeta(filePath, id, originalName, sizeBytes, opts);

  return {
    id,
    path: filePath,
    filename: uniqueName,
    type: meta.type,
    source_url: meta.source_url,
    session_id: meta.session_id,
    created_at: meta.created_at,
    size_bytes: sizeBytes,
    meta_path: metaPath(filePath),
  };
}

export function listDownloads(sessionId?: string): DownloadedFile[] {
  const dir = getDownloadsDir(sessionId);
  const results: DownloadedFile[] = [];

  function scanDir(d: string) {
    if (!existsSync(d)) return;
    const entries = readdirSync(d);
    for (const entry of entries) {
      if (entry.endsWith(".meta.json")) continue;
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scanDir(full);
        continue;
      }
      const mpath = metaPath(full);
      if (!existsSync(mpath)) continue;
      try {
        const meta = JSON.parse(readFileSync(mpath, "utf8")) as DownloadMeta;
        results.push({
          id: meta.id,
          path: full,
          filename: entry,
          type: meta.type,
          source_url: meta.source_url,
          session_id: meta.session_id,
          created_at: meta.created_at,
          size_bytes: meta.size_bytes,
          meta_path: mpath,
        });
      } catch {
        // Skip malformed sidecar
      }
    }
  }

  scanDir(dir);
  return results.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getDownload(id: string, sessionId?: string): DownloadedFile | null {
  const all = listDownloads(sessionId);
  return all.find((f) => f.id === id) ?? null;
}

export function deleteDownload(id: string, sessionId?: string): boolean {
  const file = getDownload(id, sessionId);
  if (!file) return false;
  try {
    unlinkSync(file.path);
    if (existsSync(file.meta_path)) unlinkSync(file.meta_path);
    return true;
  } catch {
    return false;
  }
}

export function cleanStaleDownloads(olderThanDays = 7): number {
  const all = listDownloads();
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const file of all) {
    const age = new Date(file.created_at).getTime();
    if (age < cutoff) {
      if (deleteDownload(file.id)) count++;
    }
  }
  return count;
}

export function exportToPath(id: string, targetPath: string, sessionId?: string): string {
  const file = getDownload(id, sessionId);
  if (!file) throw new Error(`Download not found: ${id}`);
  copyFileSync(file.path, targetPath);
  return targetPath;
}

function detectType(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".webp": "screenshot", ".png": "screenshot", ".jpg": "screenshot", ".jpeg": "screenshot",
    ".pdf": "pdf",
    ".har": "har", ".json": "data",
    ".mp4": "video", ".webm": "video",
    ".csv": "data", ".txt": "text",
  };
  return map[ext] ?? "file";
}
