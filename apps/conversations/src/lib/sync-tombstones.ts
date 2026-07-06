// ============================================================================
// Agent-removal tombstones for the legacy storage sync engine.
//
// WHY: the legacy pk-upsert engine (storage-sync.ts) is append-only — it never
// propagates deletes. On 2026-07-06 the supervised agent-registry purge
// (todos bc244f4d, 579 -> 98 agents) was silently undone minutes later by the
// shared-storage cutover (todos 1e723ce4): the pre-purge registry had already
// reached the hub, and the next `storage pull` resurrected all 482 purged
// `agent_presence` rows. This module makes agent removal delete-propagating:
//
//   - `removePresence()` records a tombstone (agent, deleted_at).
//   - `storage push` uploads local tombstones and deletes remote presence rows
//     whose tombstone is newer than their last heartbeat.
//   - `storage pull` downloads remote tombstones and applies the same rule
//     locally, so un-purged replicas converge instead of re-seeding the fleet.
//
// A tombstone only wins while it is NEWER than the row's `last_seen_at`; a
// re-registered (or still-heartbeating) agent always out-survives it, so
// tombstones are safe to keep around indefinitely.
//
// TIMESTAMP CONVENTION: the legacy engine binds SQLite's naive-UTC text
// timestamps to Postgres without zone normalization (unlike message-sync.ts),
// so hub-side `agent_presence.last_seen_at` values are interpreted in the hub
// server's timezone. Tombstone `deleted_at` values deliberately use the SAME
// raw-naive convention so that `deleted_at > last_seen_at` comparisons are
// internally consistent on each side. If the legacy engine ever gains zone
// normalization, both columns must migrate together.
//
// CUTOVER: gate off — this rides the legacy sync engine and is removed with it
// under Storage Amendment A1 (see storage-sync.ts header).
// ============================================================================
import type { Database } from "./db.js";
import type { RemoteAdapter } from "./message-sync.js";
import { toLocalTimestamp } from "./message-sync.js";
import type { StorageSyncResult } from "./storage-sync.js";

export const SYNC_AGENT_TOMBSTONES_TABLE = "_sync_agent_tombstones";

const UPSERT_TOMBSTONE_SQL = `
  INSERT INTO ${SYNC_AGENT_TOMBSTONES_TABLE} (agent, deleted_at) VALUES (?, ?)
  ON CONFLICT (agent) DO UPDATE SET deleted_at = excluded.deleted_at
  WHERE excluded.deleted_at > ${SYNC_AGENT_TOMBSTONES_TABLE}.deleted_at
`;

// Portable (SQLite + Postgres): delete presence rows whose tombstone is newer
// than their last heartbeat. Tombstoned-but-re-registered agents survive.
const APPLY_TOMBSTONES_SQL = `
  DELETE FROM agent_presence
  WHERE EXISTS (
    SELECT 1 FROM ${SYNC_AGENT_TOMBSTONES_TABLE} t
    WHERE t.agent = LOWER(agent_presence.agent)
      AND t.deleted_at > agent_presence.last_seen_at
  )
`;

export function ensureAgentTombstonesTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${SYNC_AGENT_TOMBSTONES_TABLE} (
      agent TEXT PRIMARY KEY,
      deleted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    )
  `);
}

/**
 * Record that an agent was removed so the removal propagates through storage
 * sync. `deletedAt` defaults to now (naive-UTC, matching agent_presence).
 * Keeps the newest deleted_at if a tombstone already exists.
 */
export function recordAgentTombstone(db: Database, agent: string, deletedAt?: string): void {
  const normalized = agent.trim().toLowerCase();
  if (!normalized) return;
  ensureAgentTombstonesTable(db);
  if (deletedAt) {
    db.prepare(UPSERT_TOMBSTONE_SQL).run(normalized, deletedAt);
    return;
  }
  db.prepare(`
    INSERT INTO ${SYNC_AGENT_TOMBSTONES_TABLE} (agent, deleted_at)
    VALUES (?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))
    ON CONFLICT (agent) DO UPDATE SET deleted_at = excluded.deleted_at
    WHERE excluded.deleted_at > ${SYNC_AGENT_TOMBSTONES_TABLE}.deleted_at
  `).run(normalized);
}

export function listAgentTombstones(db: Database): Array<{ agent: string; deleted_at: string }> {
  ensureAgentTombstonesTable(db);
  return db.all<{ agent: string; deleted_at: string }>(
    `SELECT agent, deleted_at FROM ${SYNC_AGENT_TOMBSTONES_TABLE} ORDER BY agent`,
  );
}

/**
 * Drop the LOCAL tombstone for an agent (e.g. its name is being brought back
 * by a rename). Local-only tidiness: clears never propagate — a revived
 * identity must instead carry a last_seen_at newer than any remaining
 * tombstone copy, which register/heartbeat/rename all guarantee.
 */
export function clearAgentTombstone(db: Database, agent: string): void {
  const normalized = agent.trim().toLowerCase();
  if (!normalized) return;
  ensureAgentTombstonesTable(db);
  db.prepare(`DELETE FROM ${SYNC_AGENT_TOMBSTONES_TABLE} WHERE agent = ?`).run(normalized);
}

/** Apply local tombstones to the local agent_presence table. Returns rows deleted. */
export function applyAgentTombstonesLocal(db: Database): number {
  ensureAgentTombstonesTable(db);
  return db.prepare(APPLY_TOMBSTONES_SQL).run().changes;
}

/**
 * Push local tombstones to the remote and apply them there (delete remote
 * presence rows that are older than their tombstone). Runs as part of
 * `storage push` whenever agent_presence is in the table set.
 * Result: rowsRead = local tombstones, rowsWritten = remote presence rows deleted.
 */
export async function pushAgentTombstones(db: Database, remote: RemoteAdapter): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: SYNC_AGENT_TOMBSTONES_TABLE, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    const rows = listAgentTombstones(db);
    result.rowsRead = rows.length;
    for (const row of rows) {
      await remote.run(UPSERT_TOMBSTONE_SQL, row.agent, row.deleted_at);
    }
    const applied = await remote.run(APPLY_TOMBSTONES_SQL);
    result.rowsWritten = applied.changes;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

/**
 * Pull remote tombstones into the local store and apply them locally. Runs as
 * part of `storage pull` AFTER the agent_presence table pull, so any rows the
 * append-only upsert just resurrected are reconciled in the same pass.
 * Result: rowsRead = remote tombstones, rowsWritten = local presence rows deleted.
 */
export async function pullAgentTombstones(remote: RemoteAdapter, db: Database): Promise<StorageSyncResult> {
  const result: StorageSyncResult = { table: SYNC_AGENT_TOMBSTONES_TABLE, rowsRead: 0, rowsWritten: 0, errors: [] };
  try {
    ensureAgentTombstonesTable(db);
    let rows: Array<{ agent: unknown; deleted_at: unknown }> = [];
    try {
      rows = await remote.all(
        `SELECT agent, deleted_at FROM ${SYNC_AGENT_TOMBSTONES_TABLE} ORDER BY agent`,
      ) as Array<{ agent: unknown; deleted_at: unknown }>;
    } catch {
      // Remote predates the tombstones migration — nothing to pull; the local
      // apply below still reconciles rows against locally-recorded tombstones.
    }
    result.rowsRead = rows.length;
    const upsert = db.prepare(UPSERT_TOMBSTONE_SQL);
    for (const row of rows) {
      const agent = typeof row.agent === "string" ? row.agent.trim().toLowerCase() : "";
      const deletedAt = toLocalTimestamp(row.deleted_at);
      if (!agent || !deletedAt) continue;
      upsert.run(agent, deletedAt);
    }
    result.rowsWritten = applyAgentTombstonesLocal(db);
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}
