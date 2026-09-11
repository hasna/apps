/**
 * Crash-safe filesystem primitives.
 *
 * The publish shape is the fleet's shipped primitive
 * (`apps/events/src/durable-spool.ts:53-73`):
 *
 *   open(tmp,"wx",0600) → write → handle.sync() → link(tmp, final) → unlink(tmp) → fsync(dir)
 *
 * **`link()`, not `rename()`, for an entry's identity files.** `rename`
 * silently overwrites; an entry id is an identity, and a second publish at the
 * same id must be DETECTED, not clobbered. `link` returns `EEXIST` for free
 * (§4). `rename` is still the right call in two places where replace semantics
 * are wanted or where `link` cannot work:
 *
 *  - replacing a single config / metadata file in place (`writeFileAtomic`);
 *  - moving a DIRECTORY tree into the spool — `link(2)` returns `EPERM` for a
 *    directory, so a tree capture is `rename(2)` (§15 correction 1), and the
 *    spool directories are laid out so that rename is same-device by
 *    construction (the capture layer refuses `EXDEV` rather than copying).
 *
 * Every function here is deliberately synchronous: the ordering (write → fsync
 * → publish → fsync dir) is the crash-safety contract, and an `await` between
 * two of those steps is a state a crash can land in.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statfsSync,
  unlinkSync,
  writeSync,
  chmodSync,
  type Stats,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

/** Raised when a publish target already exists — an identity collision, never a clobber. */
export class PublishCollisionError extends Error {
  constructor(public readonly target: string) {
    super(`publish target already exists: ${target}`);
    this.name = "PublishCollisionError";
  }
}

export function isErrno(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === code);
}

export function errnoCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

export function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return null;
    throw error;
  }
}

export function ensureDir(path: string, mode = 0o700): void {
  mkdirSync(path, { recursive: true, mode });
  // mkdir honours umask; the store is owner-only by contract.
  try {
    chmodSync(path, mode);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
  }
}

/**
 * fsync a directory so a rename/link inside it is durable. Best-effort on
 * platforms that refuse to open a directory for reading (Windows): the caller
 * is ordering durability, not asserting a platform guarantee.
 */
export function fsyncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch {
    // Directory fsync is unavailable on some platforms; the entry's own
    // fsync already happened, and the publish remains crash-atomic.
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // closing a read-only directory handle cannot lose data
      }
    }
  }
}

/** Stage bytes in a temp file inside `dir`, fsynced, 0600. Returns the temp path. */
export function writeTempSync(dir: string, prefix: string, data: string | Buffer, mode = 0o600): string {
  ensureDir(dir);
  const tmp = join(dir, `${prefix}${process.pid}-${randomUUID()}`);
  const fd = openSync(tmp, "wx", mode);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return tmp;
}

/**
 * Publish a staged temp file at `final` without replacing anything that is
 * already there. `EEXIST` surfaces as `PublishCollisionError`.
 */
export function publishNoReplace(tmpPath: string, finalPath: string): void {
  try {
    linkSync(tmpPath, finalPath);
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new PublishCollisionError(finalPath);
    unlinkSync(tmpPath);
    throw error;
  }
  unlinkSync(tmpPath);
  fsyncDirectory(dirname(finalPath));
}

/** Write a file atomically with REPLACE semantics (config and metadata updates). */
export function writeFileAtomic(path: string, data: string | Buffer, mode = 0o600): void {
  const dir = dirname(path);
  const tmp = writeTempSync(dir, ".tmp-", data, mode);
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // the temp file is already gone; the rename failure is what matters
    }
    throw error;
  }
  fsyncDirectory(dir);
}

/** Remove one file or symlink. `ENOENT` is not an error — removal is idempotent. */
export function removeFile(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}

/**
 * Remove a path and its contents, `lstat`-only and never following a symlink:
 * a symlink is removed as an object, its target is untouched.
 *
 * This is the destructive primitive behind the §11.7 exclude-glob branch (a
 * path the operator declared not-precious, whose capture was refused, keeps
 * being deletable so a full disk does not self-lock the machine) and behind
 * `purge`/`empty`.
 */
export function removePathRecursive(target: string, onEntry?: (path: string) => void): number {
  const info = lstatSync(target);
  if (!info.isDirectory()) {
    unlinkSync(target);
    onEntry?.(target);
    return 1;
  }

  let removed = 0;
  for (const name of readdirSync(target)) {
    const child = join(target, name);
    const childInfo = lstatSync(child);
    if (childInfo.isDirectory()) {
      removed += removePathRecursive(child, onEntry);
      continue;
    }
    // Symlinks and other non-directories: unlink the object itself.
    unlinkSync(child);
    onEntry?.(child);
    removed += 1;
  }
  rmdirSync(target);
  onEntry?.(target);
  return removed + 1;
}

export function deviceOf(path: string): number {
  return lstatSync(path).dev;
}

/** Free bytes available to this user on the filesystem holding `path`. */
export function freeBytesOf(path: string): number {
  const stats = statfsSync(path);
  return Number(stats.bavail) * Number(stats.bsize);
}

/**
 * `freeBytesOf` for the diagnostic path: a directory that does not exist yet is
 * a fact to REPORT, not a reason to throw. `trash doctor` must never crash —
 * the one command an operator runs when the store is broken is the worst place
 * for a statfs stack trace.
 */
export function freeBytesOrNull(path: string): number | null {
  try {
    return freeBytesOf(path);
  } catch (error) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) return null;
    throw error;
  }
}

export function pathExists(path: string): boolean {
  return existsSync(path);
}

/** Count the entries of a directory (metadata files in `info`, say) without opening them. */
export function countDirEntries(dir: string): number {
  try {
    return readdirSync(dir).length;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return 0;
    throw error;
  }
}
