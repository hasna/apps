import { getDb } from "./db.js";

export interface ResourceLock {
  resource_type: string;
  resource_id: string;
  agent_id: string;
  lock_type: "advisory" | "exclusive";
  locked_at: string;
  expires_at: string;
}

export interface BulkLockRequest {
  resource_type: string;
  resource_id: string;
  lock_type?: "advisory" | "exclusive";
  expiry_ms?: number;
}

export interface BulkAcquireResult {
  acquired: boolean;
  locks: ResourceLock[];
  blocked_by?: { resource_type: string; resource_id: string; held_by: string };
}

export interface EnrichedLock extends ResourceLock {
  locked_seconds_ago: number;
  expires_in_seconds: number;
  agent: {
    role: string | null;
    status: string | null;
    online: boolean;
    last_seen_at: string | null;
    project_id: string | null;
  } | null;
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

    const existingLocks = db.prepare(`
      SELECT * FROM resource_locks
      WHERE resource_type = ? AND resource_id = ?
      ORDER BY CASE WHEN lock_type = ? THEN 0 ELSE 1 END, locked_at ASC
    `).all(resourceType, resourceId, lockType) as ResourceLock[];
    const conflicting = existingLocks.find((lock) => lock.agent_id !== agentId);

    if (conflicting) {
      return { acquired: false, lock: null, held_by: conflicting.agent_id };
    }

    const existing = existingLocks.find((lock) => lock.lock_type === lockType) ?? null;
    if (existing) {
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
  });
}

export function bulkAcquireLock(
  resources: BulkLockRequest[],
  agentId: string
): BulkAcquireResult {
  const db = getDb();

  return db.transaction(() => {
    cleanExpiredLocks();
    releaseStaleAgentLocks();

    const acquired: ResourceLock[] = [];

    for (const { resource_type, resource_id, lock_type = "advisory", expiry_ms = DEFAULT_LOCK_EXPIRY_MS } of resources) {
      const existingLocks = db.prepare(`
        SELECT * FROM resource_locks
        WHERE resource_type = ? AND resource_id = ?
        ORDER BY CASE WHEN lock_type = ? THEN 0 ELSE 1 END, locked_at ASC
      `).all(resource_type, resource_id, lock_type) as ResourceLock[];
      const conflicting = existingLocks.find((lock) => lock.agent_id !== agentId);

      if (conflicting) {
        // Conflict — abort the entire transaction by throwing (SQLite rolls back)
        throw { _bulkConflict: true, resource_type, resource_id, held_by: conflicting.agent_id };
      }

      const expiresAt = new Date(Date.now() + expiry_ms).toISOString().slice(0, -1);
      const existing = existingLocks.find((lock) => lock.lock_type === lock_type) ?? null;

      if (existing) {
        // Refresh own lock
        db.prepare(`
          UPDATE resource_locks SET expires_at = ?, locked_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
          WHERE resource_type = ? AND resource_id = ? AND lock_type = ?
        `).run(expiresAt, resource_type, resource_id, lock_type);
      } else {
        db.prepare(`
          INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at)
          VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'), ?)
        `).run(resource_type, resource_id, agentId, lock_type, expiresAt);
      }

      const lock = db.prepare(`
        SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND lock_type = ?
      `).get(resource_type, resource_id, lock_type) as ResourceLock;
      acquired.push(lock);
    }

    return { acquired: true, locks: acquired };
  }) as BulkAcquireResult;
}

// Wrap bulkAcquireLock to catch conflict throws from the transaction
export function tryBulkAcquireLock(
  resources: BulkLockRequest[],
  agentId: string
): BulkAcquireResult {
  try {
    return bulkAcquireLock(resources, agentId);
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    if (e?._bulkConflict) {
      return {
        acquired: false,
        locks: [],
        blocked_by: { resource_type: e.resource_type as string, resource_id: e.resource_id as string, held_by: e.held_by as string },
      };
    }
    throw err;
  }
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

export function listLocksEnriched(opts?: { resource_type?: string; agent_id?: string }): EnrichedLock[] {
  const locks = listLocks(opts);
  const db = getDb();
  const nowMs = Date.now();

  return locks.map((lock) => {
    const lockedMs = new Date(lock.locked_at + "Z").getTime();
    const expiresMs = new Date(lock.expires_at + "Z").getTime();

    const presenceRow = db.prepare(`
      SELECT role, status, last_seen_at, project_id FROM agent_presence WHERE LOWER(agent) = LOWER(?)
    `).get(lock.agent_id) as { role: string; status: string; last_seen_at: string; project_id: string | null } | null;

    const agent = presenceRow
      ? {
          role: presenceRow.role ?? null,
          status: presenceRow.status ?? null,
          online: presenceRow.last_seen_at
            ? (nowMs - new Date(presenceRow.last_seen_at + "Z").getTime()) < 60_000
            : false,
          last_seen_at: presenceRow.last_seen_at ?? null,
          project_id: presenceRow.project_id ?? null,
        }
      : null;

    return {
      ...lock,
      locked_seconds_ago: Math.round((nowMs - lockedMs) / 1000),
      expires_in_seconds: Math.round((expiresMs - nowMs) / 1000),
      agent,
    };
  });
}
