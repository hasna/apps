// Universal session file cache — cache any file read, serve from memory on repeat

import { statSync, readFileSync } from "fs";

interface CachedFile {
  content: string;
  mtime: number;
  readCount: number;
  firstReadAt: number;
  lastReadAt: number;
}

const cache = new Map<string, CachedFile>();

/** Read a file with session caching. Returns content + cache metadata. */
export function cachedRead(
  filePath: string,
  options: { offset?: number; limit?: number } = {}
): { content: string; cached: boolean; readCount: number } {
  const { offset, limit } = options;

  try {
    const stat = statSync(filePath);
    const mtime = stat.mtimeMs;
    const existing = cache.get(filePath);

    // Cache hit — file unchanged
    if (existing && existing.mtime === mtime) {
      existing.readCount++;
      existing.lastReadAt = Date.now();

      const lines = existing.content.split("\n");
      if (offset !== undefined || limit !== undefined) {
        const start = offset ?? 0;
        const end = limit !== undefined ? start + limit : lines.length;
        return {
          content: lines.slice(start, end).join("\n"),
          cached: true,
          readCount: existing.readCount,
        };
      }

      return { content: existing.content, cached: true, readCount: existing.readCount };
    }

    // Cache miss or stale — read from disk
    const content = readFileSync(filePath, "utf8");
    cache.set(filePath, {
      content,
      mtime,
      readCount: 1,
      firstReadAt: Date.now(),
      lastReadAt: Date.now(),
    });

    const lines = content.split("\n");
    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : lines.length;
      return { content: lines.slice(start, end).join("\n"), cached: false, readCount: 1 };
    }

    return { content, cached: false, readCount: 1 };
  } catch (e: any) {
    return { content: `Error: ${e.message}`, cached: false, readCount: 0 };
  }
}

/** Invalidate cache for a file (call after writes) */
export function invalidateFile(filePath: string): void {
  cache.delete(filePath);
}

/** Invalidate all files matching a pattern */
export function invalidatePattern(pattern: RegExp): void {
  for (const key of cache.keys()) {
    if (pattern.test(key)) cache.delete(key);
  }
}

/** Get cache stats */
export function cacheStats(): { files: number; totalReads: number; cacheHits: number } {
  let totalReads = 0;
  let cacheHits = 0;
  for (const entry of cache.values()) {
    totalReads += entry.readCount;
    cacheHits += Math.max(0, entry.readCount - 1); // first read is never cached
  }
  return { files: cache.size, totalReads, cacheHits };
}

/** Clear the entire cache */
export function clearFileCache(): void {
  cache.clear();
}
