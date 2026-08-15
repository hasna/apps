import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";
import { LockError } from "../types/index.js";

export const FILE_LOCK_DEFAULT_TTL_SECONDS = 30 * 60; // 30 minutes

export interface FileLock {
  id: string;
  path: string;
  agent_id: string;
  task_id: string | null;
  expires_at: string;
  created_at: string;
}

export interface LockFileInput {
  path: string;
  agent_id: string;
  task_id?: string;
  /** TTL in seconds (default: 1800 = 30 min) */
  ttl_seconds?: number;
}

function expiresAt(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

/** Clean up expired locks. Called automatically on read operations. */
export function cleanExpiredFileLocks(db?: Database): number {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM file_locks WHERE expires_at <= ?", [now()]);
  return result.changes;
}

/**
 * Acquire an exclusive lock on a file path.
 * - If no lock exists (or existing lock is expired), lock is granted.
 * - If same agent already holds the lock, the TTL is refreshed.
 * - If another agent holds an active lock, throws LockError.
 */
export function lockFile(input: LockFileInput, db?: Database): FileLock {
  const d = db || getDatabase();
  const ttl = input.ttl_seconds ?? FILE_LOCK_DEFAULT_TTL_SECONDS;
  const expiry = expiresAt(ttl);
  const timestamp = now();

  // Remove expired locks first
  cleanExpiredFileLocks(d);

  const existing = d.query("SELECT * FROM file_locks WHERE path = ?").get(input.path) as FileLock | null;

  if (existing) {
    if (existing.agent_id === input.agent_id) {
      // Same agent — refresh TTL
      d.run(
        "UPDATE file_locks SET expires_at = ?, task_id = COALESCE(?, task_id) WHERE id = ?",
        [expiry, input.task_id ?? null, existing.id],
      );
      return d.query("SELECT * FROM file_locks WHERE id = ?").get(existing.id) as FileLock;
    }
    // Another agent holds an active lock
    throw new LockError(input.path, existing.agent_id);
  }

  const id = uuid();
  d.run(
    "INSERT INTO file_locks (id, path, agent_id, task_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, input.path, input.agent_id, input.task_id ?? null, expiry, timestamp],
  );
  return d.query("SELECT * FROM file_locks WHERE id = ?").get(id) as FileLock;
}

/**
 * Release a file lock. Only the lock holder can release it.
 * Returns true if released, false if not found or wrong agent.
 */
export function unlockFile(path: string, agentId: string, db?: Database): boolean {
  const d = db || getDatabase();
  cleanExpiredFileLocks(d);
  const result = d.run(
    "DELETE FROM file_locks WHERE path = ? AND agent_id = ?",
    [path, agentId],
  );
  return result.changes > 0;
}

/**
 * Check who holds a lock on a file path.
 * Returns null if unlocked or expired.
 */
export function checkFileLock(path: string, db?: Database): FileLock | null {
  const d = db || getDatabase();
  cleanExpiredFileLocks(d);
  return d.query("SELECT * FROM file_locks WHERE path = ?").get(path) as FileLock | null;
}

/**
 * List all active (non-expired) file locks, optionally filtered by agent.
 */
export function listFileLocks(agentId?: string, db?: Database): FileLock[] {
  const d = db || getDatabase();
  cleanExpiredFileLocks(d);
  if (agentId) {
    return d.query("SELECT * FROM file_locks WHERE agent_id = ? ORDER BY created_at DESC").all(agentId) as FileLock[];
  }
  return d.query("SELECT * FROM file_locks ORDER BY created_at DESC").all() as FileLock[];
}

/** Force-release a lock regardless of which agent holds it (admin operation). */
export function forceUnlockFile(path: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM file_locks WHERE path = ?", [path]);
  return result.changes > 0;
}
