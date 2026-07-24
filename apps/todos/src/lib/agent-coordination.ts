/**
 * Hardened multi-agent locking: leases, heartbeats, stale recovery, safe steal.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getTask, lockTask, unlockTask, stealTask, getStaleTasks, type Task } from "../db/tasks.js";
import { logTaskChange } from "../db/audit.js";
import { emitHeartbeat } from "../db/checkpoints.js";
import { LockError } from "../types/index.js";

export const AGENT_COORDINATION_SCHEMA = "todos.agent_coordination.v1";
export const DEFAULT_LEASE_MINUTES = 30;

export interface TaskLease {
  task_id: string;
  agent_id: string;
  acquired_at: string;
  expires_at: string;
  heartbeat_at: string | null;
  steal_count: number;
}

export interface LeaseAcquireResult {
  success: boolean;
  lease?: TaskLease;
  conflict?: LockConflict;
}

export interface LockConflict {
  task_id: string;
  holder: string;
  locked_at: string | null;
  expires_at: string | null;
  message: string;
}

export interface StaleRecoveryResult {
  recovered: Array<{ task_id: string; previous_agent: string | null; action: string }>;
  stolen: Task | null;
}

interface LeaseRow {
  task_id: string;
  agent_id: string;
  acquired_at: string;
  expires_at: string;
  heartbeat_at: string | null;
  steal_count: number;
}

function rowToLease(row: LeaseRow): TaskLease {
  return { ...row };
}

function leaseExpiry(minutes = DEFAULT_LEASE_MINUTES): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

export function formatLockConflict(taskId: string, holder: string, lockedAt: string | null, expiresAt?: string | null): LockConflict {
  return {
    task_id: taskId,
    holder,
    locked_at: lockedAt,
    expires_at: expiresAt ?? null,
    message: expiresAt && isExpired(expiresAt)
      ? `Task ${taskId.slice(0, 8)} lease expired (was held by ${holder})`
      : `Task ${taskId.slice(0, 8)} is locked by ${holder}${lockedAt ? ` since ${lockedAt.slice(0, 16)}` : ""}`,
  };
}

export function acquireTaskLease(
  taskId: string,
  agentId: string,
  ttlMinutes = DEFAULT_LEASE_MINUTES,
  db?: Database,
): LeaseAcquireResult {
  const d = getDatabase(db);
  const lock = lockTask(taskId, agentId, d);

  if (!lock.success) {
    const existing = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow | null;
    return {
      success: false,
      conflict: formatLockConflict(taskId, lock.locked_by ?? "unknown", lock.locked_at ?? null, existing?.expires_at ?? null),
    };
  }

  const ts = now();
  const expires = leaseExpiry(ttlMinutes);
  d.run(
    `INSERT INTO task_leases (task_id, agent_id, acquired_at, expires_at, heartbeat_at, steal_count, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(task_id) DO UPDATE SET agent_id = ?, acquired_at = ?, expires_at = ?, heartbeat_at = ?, updated_at = ?`,
    [taskId, agentId, ts, expires, ts, ts, agentId, ts, expires, ts, ts],
  );

  logTaskChange(taskId, "lease_acquire", "agent_id", null, agentId, agentId, d);
  emitHeartbeat(taskId, { agent_id: agentId, message: "lease acquired", meta: { lease_expires_at: expires } }, d);

  const lease = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow;
  return { success: true, lease: rowToLease(lease) };
}

export function renewTaskLease(taskId: string, agentId: string, ttlMinutes = DEFAULT_LEASE_MINUTES, db?: Database): TaskLease {
  const d = getDatabase(db);
  const lease = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow | null;

  if (!lease || lease.agent_id !== agentId) {
    const task = getTask(taskId, d);
    throw new LockError(taskId, lease?.agent_id ?? task?.locked_by ?? "unknown");
  }

  const ts = now();
  const expires = leaseExpiry(ttlMinutes);
  d.run(
    "UPDATE task_leases SET expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE task_id = ?",
    [expires, ts, ts, taskId],
  );
  d.run("UPDATE tasks SET locked_at = ?, updated_at = ? WHERE id = ?", [ts, ts, taskId]);

  emitHeartbeat(taskId, { agent_id: agentId, message: "lease renewed", meta: { lease_expires_at: expires } }, d);
  return rowToLease(d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow);
}

export function releaseTaskLease(taskId: string, agentId: string, db?: Database): boolean {
  const d = getDatabase(db);
  const lease = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow | null;
  if (lease && lease.agent_id !== agentId) {
    throw new LockError(taskId, lease.agent_id);
  }

  unlockTask(taskId, agentId, d);
  d.run("DELETE FROM task_leases WHERE task_id = ?", [taskId]);
  logTaskChange(taskId, "lease_release", "agent_id", agentId, null, agentId, d);
  emitHeartbeat(taskId, { agent_id: agentId, message: "lease released" }, d);
  return true;
}

export function stealTaskLease(
  taskId: string,
  agentId: string,
  options: { force?: boolean; stale_minutes?: number; reason?: string } = {},
  db?: Database,
): LeaseAcquireResult {
  const d = getDatabase(db);
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const lease = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow | null;
  const expired = lease ? isExpired(lease.expires_at) : true;

  if (!expired && !options.force) {
    const staleMinutes = options.stale_minutes ?? DEFAULT_LEASE_MINUTES;
    const stale = getStaleTasks(staleMinutes, {}, d).some((t) => t.id === taskId);
    if (!stale) {
      return {
        success: false,
        conflict: formatLockConflict(taskId, lease!.agent_id, task.locked_at, lease!.expires_at),
      };
    }
  }

  if (options.force) {
    unlockTask(taskId, undefined, d);
  }

  const previous = lease?.agent_id ?? task.locked_by;
  let acquired = false;

  const lock = lockTask(taskId, agentId, d);
  if (lock.success) {
    acquired = true;
  } else {
    const stolen = stealTask(agentId, { stale_minutes: options.stale_minutes ?? DEFAULT_LEASE_MINUTES }, d);
    if (stolen?.id === taskId) acquired = true;
    else return { success: false, conflict: formatLockConflict(taskId, lock.locked_by ?? "unknown", lock.locked_at ?? null, lease?.expires_at ?? null) };
  }

  if (!acquired) {
    return { success: false, conflict: formatLockConflict(taskId, previous ?? "unknown", task.locked_at) };
  }

  const ts = now();
  const expires = leaseExpiry(DEFAULT_LEASE_MINUTES);
  d.run(
    `INSERT INTO task_leases (task_id, agent_id, acquired_at, expires_at, heartbeat_at, steal_count, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(task_id) DO UPDATE SET agent_id = ?, acquired_at = ?, expires_at = ?, heartbeat_at = ?, steal_count = steal_count + 1, updated_at = ?`,
    [taskId, agentId, ts, expires, ts, ts, agentId, ts, expires, ts, ts],
  );

  logTaskChange(taskId, "lease_steal", "agent_id", previous ?? null, agentId, agentId, d);
  emitHeartbeat(taskId, {
    agent_id: agentId,
    message: options.reason || "lease stolen",
    meta: { stolen_from: previous, schema_version: AGENT_COORDINATION_SCHEMA },
  }, d);

  const updated = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow;
  return { success: true, lease: rowToLease(updated) };
}

export function listExpiredLeases(db?: Database): TaskLease[] {
  const d = getDatabase(db);
  const ts = now();
  return (d.query("SELECT * FROM task_leases WHERE expires_at < ?").all(ts) as LeaseRow[]).map(rowToLease);
}

export function listActiveLeases(agentId?: string, db?: Database): TaskLease[] {
  const d = getDatabase(db);
  const ts = now();
  if (agentId) {
    return (d.query("SELECT * FROM task_leases WHERE agent_id = ? AND expires_at >= ?").all(agentId, ts) as LeaseRow[]).map(rowToLease);
  }
  return (d.query("SELECT * FROM task_leases WHERE expires_at >= ?").all(ts) as LeaseRow[]).map(rowToLease);
}

export function recoverStaleLeases(
  options: { reclaim_agent?: string; stale_minutes?: number } = {},
  db?: Database,
): StaleRecoveryResult {
  const d = getDatabase(db);
  const recovered: StaleRecoveryResult["recovered"] = [];

  for (const lease of listExpiredLeases(d)) {
    try {
      unlockTask(lease.task_id, lease.agent_id, d);
    } catch {
      unlockTask(lease.task_id, undefined, d);
    }
    d.run("DELETE FROM task_leases WHERE task_id = ?", [lease.task_id]);
    logTaskChange(lease.task_id, "lease_expire", "agent_id", lease.agent_id, null, "system", d);
    recovered.push({ task_id: lease.task_id, previous_agent: lease.agent_id, action: "expired" });
  }

  const staleMinutes = options.stale_minutes ?? DEFAULT_LEASE_MINUTES;
  for (const task of getStaleTasks(staleMinutes, {}, d)) {
    const lease = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(task.id) as LeaseRow | null;
    if (lease) {
      d.run("DELETE FROM task_leases WHERE task_id = ?", [task.id]);
    }
    unlockTask(task.id, undefined, d);
    logTaskChange(task.id, "stale_recovery", "status", task.status, "pending", "system", d);
    recovered.push({ task_id: task.id, previous_agent: task.locked_by, action: "stale_unlock" });
  }

  let stolen: Task | null = null;
  if (options.reclaim_agent) {
    stolen = stealTask(options.reclaim_agent, { stale_minutes: staleMinutes }, d);
  }

  return { recovered, stolen };
}

export function getTaskLease(taskId: string, db?: Database): TaskLease | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM task_leases WHERE task_id = ?").get(taskId) as LeaseRow | null;
  return row ? rowToLease(row) : null;
}
