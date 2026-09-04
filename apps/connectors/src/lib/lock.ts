/**
 * Advisory file-based write lock for per-connector operations.
 *
 * Prevents concurrent agents from racing on token refresh and config writes.
 * Reads remain unaffected — only write operations (saveApiKey, refreshOAuthToken,
 * switchProfile) acquire the lock.
 *
 * Strategy: atomic O_EXCL file creation as the lock primitive (works on all
 * platforms including macOS). Lock files live at:
 *   <connectors data root>/{name}/.write.lock
 *
 * Callers that cannot acquire the lock within the timeout receive a LockTimeoutError.
 */

import { openSync, closeSync, unlinkSync, existsSync, statSync } from "fs";
import { mkdirSync } from "fs";
import { getConnectorConfigDir, normalizeConnectorName } from "./connector-resolver.js";

/** How long (ms) to wait for a lock before giving up */
const LOCK_TIMEOUT_MS = 5_000;
/** Retry interval (ms) */
const LOCK_RETRY_MS = 100;
/** Stale lock age (ms) — if lock file is older than this, consider it abandoned */
const STALE_LOCK_MS = 30_000;

export class LockTimeoutError extends Error {
  constructor(public readonly connector: string) {
    super(`Could not acquire write lock for connector "${connector}" within ${LOCK_TIMEOUT_MS}ms. Another agent may be writing. Try again shortly.`);
    this.name = "LockTimeoutError";
  }
}

function lockPath(connector: string): string {
  const dir = getConnectorConfigDir(connector);
  mkdirSync(dir, { recursive: true });
  return `${dir}/.write.lock`;
}

function isStale(path: string): boolean {
  try {
    const stat = statSync(path);
    return Date.now() - stat.mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
}

function tryAcquire(path: string): boolean {
  // Remove stale lock from a crashed previous process
  if (existsSync(path) && isStale(path)) {
    try { unlinkSync(path); } catch { /* another process may have cleaned it */ }
  }

  try {
    // O_EXCL | O_CREAT — atomic, fails if file exists
    const fd = openSync(path, "wx");
    closeSync(fd);
    return true;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

function release(path: string): void {
  try { unlinkSync(path); } catch { /* already gone */ }
}

/**
 * Acquire a write lock for a connector, run the callback, then release.
 * Throws LockTimeoutError if the lock cannot be acquired within LOCK_TIMEOUT_MS.
 */
export async function withWriteLock<T>(
  connector: string,
  fn: () => T | Promise<T>
): Promise<T> {
  connector = normalizeConnectorName(connector);
  const path = lockPath(connector);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (tryAcquire(path)) {
      try {
        return await fn();
      } finally {
        release(path);
      }
    }
    // Wait before retrying
    await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }

  throw new LockTimeoutError(connector);
}
