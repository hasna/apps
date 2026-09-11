/**
 * Advisory file lock for the mutating sweeps — copied from
 * `apps/connectors/src/lib/lock.ts` (O_EXCL | O_CREAT, 5 s timeout, 100 ms
 * retry, 30 s stale takeover) with one difference that matters here.
 *
 * §12's risk row: "concurrent `trash empty` and `trash sweep` on the same
 * spool can interleave payload removal and metadata removal, so a sweep can
 * delete a metadata file for a payload `empty` already removed (or vice
 * versa) and leave an orphan." The mitigation is a lock — but an
 * UNCONDITIONAL release is not enough: a sweep that overruns 30 s is declared
 * stale, a second sweep takes the lock, and the first sweep's `finally` then
 * unlinks the SECOND sweep's lock file, which lets a third in. Release is
 * therefore ownership-validated: the token written into the lock must still be
 * the one this holder wrote.
 *
 * `put` deliberately does NOT take this lock. Captures are already safe
 * against each other (unique ids, `link()` no-replace publishes, per-entry
 * directories), and a lock on the write path is a lock on every `rm` — the one
 * thing that must never block. The lock is for SWEEPS.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** How long (ms) to wait for a lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;
/** Retry interval (ms). */
const LOCK_RETRY_MS = 100;
/** Stale lock age (ms) — a lock older than this is abandoned (and a warning is reported). */
const STALE_LOCK_MS = 30_000;

export class LockTimeoutError extends Error {
  constructor(
    public readonly name_: string,
    public readonly path: string,
  ) {
    super(
      `could not acquire the ${name_} lock at ${path} within ${LOCK_TIMEOUT_MS}ms — ` +
        "another sweep is running; the sweeper is an independent timer, so nothing is lost by waiting",
    );
    this.name = "LockTimeoutError";
  }
}

interface LockFile {
  token: string;
  pid: number;
  acquiredAt: string;
}

function isStale(path: string): boolean {
  try {
    return Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function readLock(path: string): LockFile | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockFile;
  } catch {
    return null;
  }
}

function tryAcquire(path: string, name: string): string | null {
  if (existsSync(path) && isStale(path)) {
    try {
      unlinkSync(path);
      process.stderr.write(`warn: trash.${name} lock at ${path} was older than ${STALE_LOCK_MS}ms — taking it over\n`);
    } catch {
      // Another holder cleaned it up first; the create below is still atomic.
    }
  }

  const token = randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  try {
    const body: LockFile = { token, pid: process.pid, acquiredAt: new Date().toISOString() };
    writeSync(fd, `${JSON.stringify(body)}\n`);
  } finally {
    closeSync(fd);
  }
  return token;
}

/** Release ONLY if this holder still owns the file (the token matches). */
function release(path: string, token: string): boolean {
  const current = readLock(path);
  if (!current || current.token !== token) return false;
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export async function withFileLock<T>(name: string, lockPath: string, fn: () => T | Promise<T>): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const acquired = tryAcquire(lockPath, name);
    if (acquired) {
      try {
        return await fn();
      } finally {
        release(lockPath, acquired);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }

  throw new LockTimeoutError(name, lockPath);
}

/** Non-blocking probe, used by `doctor` and tests. */
export function lockIsHeld(lockPath: string): boolean {
  return existsSync(lockPath) && !isStale(lockPath);
}
