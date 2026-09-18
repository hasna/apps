/**
 * Exclusive local mutation locks. An elapsed lease is NOT a fencing token:
 * a slow holder may still be deleting bytes. Never steal a lock by age.
 * Crashed holders leave a visible lock requiring quiescent operator recovery;
 * safety takes precedence over automatically resuming destructive work.
 * Sweep network operations use a separate lock from short entry commits.
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

/** How long (ms) to wait for a lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;
/** Retry interval (ms). */
const LOCK_RETRY_MS = 100;

export class LockTimeoutError extends Error {
  constructor(
    public readonly name_: string,
    public readonly path: string,
  ) {
    super(
      `could not acquire the ${name_} lock at ${path}; retry after the holder finishes. ` +
        "An abandoned lock requires recovery with all Trash writers stopped; age never authorizes takeover.",
    );
    this.name = "LockTimeoutError";
  }
}

interface LockFile {
  token: string;
  pid: number;
  host: string;
  acquiredAt: string;
}

function readLock(path: string): LockFile | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockFile;
  } catch {
    return null;
  }
}

function tryAcquire(path: string): string | null {
  const token = randomUUID();
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
  try {
    const body: LockFile = { token, pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() };
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

export async function withFileLock<T>(name: string, lockPath: string, fn: () => T | Promise<T>, options: { timeoutMs?: number } = {}): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + (options.timeoutMs ?? LOCK_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const acquired = tryAcquire(lockPath);
    if (acquired) {
      try {
        return await fn();
      } finally {
        release(lockPath, acquired);
      }
    }
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(LOCK_RETRY_MS, Math.max(1, deadline - Date.now()))));
  }

  throw new LockTimeoutError(name, lockPath);
}

/** Synchronous commits fail immediately unless an external-process wait is explicitly requested. */
export function withFileLockSync<T>(name: string, lockPath: string, fn: () => T, options: { timeoutMs?: number } = {}): T {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + (options.timeoutMs ?? 0);
  const wait = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    const token = tryAcquire(lockPath);
    if (token) {
      try { return fn(); }
      finally { release(lockPath, token); }
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LockTimeoutError(name, lockPath);
    // Capture is synchronous; only a sibling process can hold this source lock.
    // Same-process reentrancy refuses after the bounded deadline, never steals.
    Atomics.wait(wait, 0, 0, Math.min(LOCK_RETRY_MS, remaining));
  }
}

/** Non-blocking probe, used by `doctor` and tests. */
export function lockIsHeld(lockPath: string): boolean {
  return existsSync(lockPath);
}
