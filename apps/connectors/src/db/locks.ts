/**
 * Resource lock helpers for open-connectors.
 *
 * Same interface as open-mementos src/db/locks.ts — standard pattern across
 * all @hasna apps. Resource types are scoped to what connectors manages:
 *   connector — the connector itself (install/uninstall ops)
 *   agent     — agent records
 *   profile   — connector auth profiles
 *   token     — OAuth token refresh operations
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now, shortUuid } from "./database.js";

export type ResourceType = "connector" | "agent" | "profile" | "token";
export type LockType = "advisory" | "exclusive";

export interface ResourceLock {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  agent_id: string;
  lock_type: LockType;
  locked_at: string;
  expires_at: string;
}

function parseLockRow(row: Record<string, unknown>): ResourceLock {
  return {
    id: row["id"] as string,
    resource_type: row["resource_type"] as ResourceType,
    resource_id: row["resource_id"] as string,
    agent_id: row["agent_id"] as string,
    lock_type: row["lock_type"] as LockType,
    locked_at: row["locked_at"] as string,
    expires_at: row["expires_at"] as string,
  };
}

/**
 * Acquire a lock on a resource.
 * - advisory: multiple agents can hold advisory locks simultaneously
 * - exclusive: only one agent can hold an exclusive lock at a time
 *
 * Returns the lock if acquired, null if blocked by an existing exclusive lock.
 * TTL is in seconds (default: 5 minutes).
 */
export function acquireLock(
  agentId: string,
  resourceType: ResourceType,
  resourceId: string,
  lockType: LockType = "exclusive",
  ttlSeconds = 300,
  db?: Database
): ResourceLock | null {
  const d = db ?? getDatabase();

  cleanExpiredLocks(d);

  // Check if this agent already holds the same lock — refresh TTL first
  const ownLock = d
    .query(
      "SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND agent_id = ? AND lock_type = ? AND expires_at > datetime('now')"
    )
    .get(resourceType, resourceId, agentId, lockType) as Record<string, unknown> | null;

  if (ownLock) {
    const newExpiry = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    d.run("UPDATE resource_locks SET expires_at = ? WHERE id = ?", [newExpiry, ownLock["id"] as string]);
    return parseLockRow({ ...ownLock, expires_at: newExpiry });
  }

  // Block if another agent holds an exclusive lock
  if (lockType === "exclusive") {
    const existing = d
      .query(
        "SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND lock_type = 'exclusive' AND expires_at > datetime('now')"
      )
      .get(resourceType, resourceId) as Record<string, unknown> | null;

    if (existing) return null;
  }

  const id = shortUuid();
  const lockedAt = now();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  d.run(
    "INSERT INTO resource_locks (id, resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, resourceType, resourceId, agentId, lockType, lockedAt, expiresAt]
  );

  return { id, resource_type: resourceType, resource_id: resourceId, agent_id: agentId, lock_type: lockType, locked_at: lockedAt, expires_at: expiresAt };
}

/**
 * Release a specific lock by ID. Only the owning agent can release it.
 */
export function releaseLock(lockId: string, agentId: string, db?: Database): boolean {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM resource_locks WHERE id = ? AND agent_id = ?", [lockId, agentId]).changes > 0;
}

/**
 * Release all locks held by an agent on a specific resource.
 */
export function releaseResourceLocks(
  agentId: string,
  resourceType: ResourceType,
  resourceId: string,
  db?: Database
): number {
  const d = db ?? getDatabase();
  return d.run(
    "DELETE FROM resource_locks WHERE agent_id = ? AND resource_type = ? AND resource_id = ?",
    [agentId, resourceType, resourceId]
  ).changes;
}

/**
 * Release all locks held by an agent (e.g., on session end).
 */
export function releaseAllAgentLocks(agentId: string, db?: Database): number {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM resource_locks WHERE agent_id = ?", [agentId]).changes;
}

/**
 * Check if a resource is currently locked. Returns active lock(s) or empty array.
 */
export function checkLock(
  resourceType: ResourceType,
  resourceId: string,
  lockType?: LockType,
  db?: Database
): ResourceLock[] {
  const d = db ?? getDatabase();
  cleanExpiredLocks(d);

  const rows = (lockType
    ? d.query("SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND lock_type = ? AND expires_at > datetime('now')").all(resourceType, resourceId, lockType)
    : d.query("SELECT * FROM resource_locks WHERE resource_type = ? AND resource_id = ? AND expires_at > datetime('now')").all(resourceType, resourceId)
  ) as Record<string, unknown>[];

  return rows.map(parseLockRow);
}

/**
 * Check if a specific agent holds a lock on a resource.
 */
export function agentHoldsLock(
  agentId: string,
  resourceType: ResourceType,
  resourceId: string,
  lockType?: LockType,
  db?: Database
): ResourceLock | null {
  const d = db ?? getDatabase();
  const row = (lockType
    ? d.query("SELECT * FROM resource_locks WHERE agent_id = ? AND resource_type = ? AND resource_id = ? AND lock_type = ? AND expires_at > datetime('now')").get(agentId, resourceType, resourceId, lockType)
    : d.query("SELECT * FROM resource_locks WHERE agent_id = ? AND resource_type = ? AND resource_id = ? AND expires_at > datetime('now')").get(agentId, resourceType, resourceId)
  ) as Record<string, unknown> | null;

  return row ? parseLockRow(row) : null;
}

/**
 * List all active locks for an agent.
 */
export function listAgentLocks(agentId: string, db?: Database): ResourceLock[] {
  const d = db ?? getDatabase();
  cleanExpiredLocks(d);
  return (d.query("SELECT * FROM resource_locks WHERE agent_id = ? AND expires_at > datetime('now') ORDER BY locked_at DESC").all(agentId) as Record<string, unknown>[]).map(parseLockRow);
}

/**
 * Delete all expired locks. Called automatically by other lock functions.
 */
export function cleanExpiredLocks(db?: Database): number {
  const d = db ?? getDatabase();
  return d.run("DELETE FROM resource_locks WHERE expires_at <= datetime('now')").changes;
}
