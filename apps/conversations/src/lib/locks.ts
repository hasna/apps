import { getDb } from "./db.js";

export interface ResourceLock {
  resource_type: string;
  resource_id: string;
  agent_id: string;
  lock_type: "advisory" | "exclusive";
  locked_at: string;
  expires_at: string;
}

const DEFAULT_LOCK_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const STALE_HEARTBEAT_SECONDS = 30 * 60; // 30 minutes — matches presence conflict threshold

export function acquireLock(
  resourceType: string,
  resourceId: string,
  agentId: string,
  lockType: "advisory" | "exclusive" = "advisory",
  expiryMs: number = DEFAULT_LOCK_EXPIRY_MS
): { acquired: boolean; lock: ResourceLock | null; held_by?: string } {
  const db = getDb();

  return db.transaction(() => {
    // Clean expired locks and stale agent locks first
    cleanExpiredLocks();
    releaseStaleAgentLocks();

    const existing = db.prepare(`
      SELECT * FROM resource_locks
      WHERE resource_type = ? AND resource_id = ? AND lock_type = ?
    `).get(resourceType, resourceId, lockType) as ResourceLock | null;

    if (existing) {
      // Another agent holds this lock
      if (existing.agent_id !== agentId) {
        return { acquired: false, lock: null, held_by: existing.agent_id };
      }
      // Same agent refreshes the lock
      const expiresAt = new Date(Date.now() + expiryMs).toISOString().replace("T", "T").replace("Z", "");
      db.prepare(`
        UPDATE resource_locks SET expires_at = ?, locked_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
        WHERE resource_type = ? AND resource_id = ? AND lock_type = ?
      `).run(expiresAt, resourceType, resourceId, lockType);
    } else {
      const expiresAt = new Date(Date.now() + expiryMs).toISOString().slice(0, -1);
      db.prepare(`
        INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
        VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
      `).run(resourceType, resourceId, agentId, lockType, expiresAt);
    }

    const lock = db.prepare(`
      SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND lock_type = ?
    `).get(resourceType, resourceId, lockType) as ResourceLock;

    return { acquired: true, lock };
  }).immediate();
}

export function releaseLock(
  resourceType: string,
  resourceId: string,
  agentId: string
): boolean {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM resource_locks
    WHERE resource_type = ? AND resource_id = ? AND agent_id = ?
  `).run(resourceType, resourceId, agentId);
  return result.changes > 0;
}

export function checkLock(
  resourceType: string,
  resourceId: string
): ResourceLock | null {
  const db = getDb();
  cleanExpiredLocks();
  releaseStaleAgentLocks();
  return db.prepare(`
    SELECT * FROM resource_locks
    WHERE resource_type = ? AND resource_id = ?
    ORDER BY locked_at ASC
    LIMIT 1
  `).get(resourceType, resourceId) as ResourceLock | null;
}

export function releaseStaleAgentLocks(): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM resource_locks
    WHERE LOWER(agent_id) IN (
      SELECT LOWER(agent) FROM agent_presence
      WHERE last_seen_at < strftime('%Y-%m-%dT%H:%M:%f', 'now', '-${STALE_HEARTBEAT_SECONDS} seconds')
    )
  `).run();
  return result.changes;
}

export function cleanExpiredLocks(): number {
  const db = getDb();
  const result = db.prepare(`
    DELETE FROM resource_locks WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%f', 'now')
  `).run();
  return result.changes;
}

export function listLocks(opts?: { resource_type?: string; agent_id?: string }): ResourceLock[] {
  const db = getDb();
  cleanExpiredLocks();
  releaseStaleAgentLocks();

  let query = "SELECT * FROM resource_locks WHERE 1=1";
  const params: string[] = [];

  if (opts?.resource_type) {
    query += " AND resource_type = ?";
    params.push(opts.resource_type);
  }
  if (opts?.agent_id) {
    query += " AND agent_id = ?";
    params.push(opts.agent_id);
  }

  query += " ORDER BY locked_at ASC";
  return db.prepare(query).all(...params) as ResourceLock[];
}
