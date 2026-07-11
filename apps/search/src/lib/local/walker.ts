import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { IgnoreMatcher, IgnoreStack, DEFAULT_EXCLUDES } from "./ignore.js";

export interface ScannedFile {
  relPath: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtimeMs: number;
}

export interface ScanResult {
  files: ScannedFile[];
  /** Directories that could not be read (EACCES, EIO, ...) — not ENOENT races. */
  skippedDirs: string[];
}

/** Extensions that are always binary — recorded in the path index, never sniffed or content-indexed. */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "heic",
  "pdf", "zip", "gz", "tgz", "tar", "bz2", "xz", "zst", "7z", "rar",
  "exe", "dll", "so", "dylib", "a", "o", "obj", "class", "jar", "war", "pyc", "wasm", "node",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "m4a", "avi", "mov", "mkv", "webm", "wav", "flac", "ogg",
  "sqlite", "db", "bin", "dat", "ds_store",
]);

/** Text files whose content is high-volume noise — findable by name, not content-indexed. */
const CONTENT_EXCLUDED_NAMES = [/\.lock$/, /-lock\.(json|yaml)$/, /\.min\.(js|css)$/, /\.map$/, /\.svg$/];

export function hasBinaryExtension(ext: string): boolean {
  return BINARY_EXTENSIONS.has(ext.toLowerCase());
}

export function isContentExcluded(name: string): boolean {
  return CONTENT_EXCLUDED_NAMES.some((re) => re.test(name));
}

/** Sniff the first 8KB for a null byte. */
export function isBinaryFile(absPath: string): boolean {
  const buf = Buffer.alloc(8192);
  let fd: number;
  try {
    fd = openSync(absPath, "r");
  } catch {
    return true;
  }
  try {
    const read = readSync(fd, buf, 0, buf.length, 0);
    for (let i = 0; i < read; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

function readGitignore(dirAbs: string): string[] | null {
  try {
    return readFileSync(join(dirAbs, ".gitignore"), "utf-8").split("\n");
  } catch {
    return null;
  }
}

export function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/**
 * Walk a root directory, honoring DEFAULT_EXCLUDES, per-root exclude patterns,
 * and nested .gitignore files. Default and per-root excludes are hard:
 * a .gitignore negation inside the tree cannot re-include them (and `.git`
 * is never descended into, period). Symlinks are skipped entirely. Files are
 * sorted by rel_path for deterministic diffs.
 *
 * Known limitation: a file edited without changing its size or mtime (e.g.
 * mtime-preserving copies) is not detected as changed — use a force reindex.
 */
export function scanRoot(rootPath: string, extraExcludes: string[] = []): ScanResult {
  const hardMatchers = [new IgnoreMatcher(DEFAULT_EXCLUDES)];
  if (extraExcludes.length > 0) hardMatchers.push(new IgnoreMatcher(extraExcludes));
  const stack = new IgnoreStack(hardMatchers);
  const files: ScannedFile[] = [];
  const skippedDirs: string[] = [];

  const walk = (dirAbs: string, dirRel: string): void => {
    const gitignore = readGitignore(dirAbs);
    if (gitignore) stack.push(new IgnoreMatcher(gitignore, dirRel));

    let entries;
    try {
      entries = readdirSync(dirAbs, { withFileTypes: true });
    } catch (err) {
      if (gitignore) stack.pop();
      // An unreadable root must fail loudly — silently returning [] would
      // wipe the root's index. Unreadable subdirectories are recorded.
      if (dirRel === "") {
        throw new Error(
          `Cannot read index root ${dirAbs}: ${err instanceof Error ? err.message : err}`,
        );
      }
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") skippedDirs.push(dirRel);
      return;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relPath = dirRel ? `${dirRel}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (entry.name === ".git") continue;
        if (stack.ignores(relPath, true)) continue;
        walk(join(dirAbs, entry.name), relPath);
      } else if (entry.isFile()) {
        if (stack.ignores(relPath, false)) continue;
        let stat;
        try {
          stat = statSync(join(dirAbs, entry.name));
        } catch {
          continue;
        }
        files.push({
          relPath,
          name: entry.name,
          ext: extOf(entry.name),
          dir: dirRel,
          size: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
        });
      }
    }

    if (gitignore) stack.pop();
  };

  walk(rootPath, "");
  files.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return { files, skippedDirs };
}
