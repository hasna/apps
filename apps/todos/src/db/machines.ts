import type { Database } from "bun:sqlite";
import type { Machine, MachineRow } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { hostname as osHostname, platform as osPlatform } from "node:os";

function rowToMachine(row: MachineRow): Machine {
  return {
    ...row,
    is_primary: !!row.is_primary,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  };
}

/**
 * Get or create the local machine entry.
 * Uses TODOS_MACHINE_NAME env var, falls back to OS hostname.
 * Idempotent — returns existing machine if name matches.
 */
export function getOrCreateLocalMachine(db?: Database): Machine {
  const d = db || getDatabase();
  const name = process.env["TODOS_MACHINE_NAME"] || osHostname();
  const host = osHostname();
  const plat = osPlatform();

  const existing = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;
  if (existing) {
    d.run(
      "UPDATE machines SET hostname = ?, platform = ?, last_seen_at = ? WHERE id = ?",
      [host, plat, now(), existing.id],
    );
    return rowToMachine({ ...existing, hostname: host, platform: plat, last_seen_at: now() });
  }

  const id = uuid();
  const ts = now();
  d.run(
    "INSERT INTO machines (id, name, hostname, platform, last_seen_at, metadata, created_at) VALUES (?, ?, ?, ?, ?, '{}', ?)",
    [id, name, host, plat, ts, ts],
  );

  return { id, name, hostname: host, platform: plat, ssh_address: null, is_primary: false, last_seen_at: ts, archived_at: null, metadata: {}, created_at: ts };
}

/**
 * Get the current machine ID. Caches after first call per process.
 */
let _machineId: string | null = null;
export function getMachineId(db?: Database): string {
  if (_machineId) return _machineId;
  const machine = getOrCreateLocalMachine(db);
  _machineId = machine.id;
  return _machineId;
}

/** Reset cached machine ID (for tests). */
export function resetMachineId(): void {
  _machineId = null;
}

export function getMachine(id: string, db?: Database): Machine | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

export function getMachineByName(name: string, db?: Database): Machine | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

export function listMachines(db?: Database, includeArchived = false): Machine[] {
  const d = db || getDatabase();
  const query = includeArchived
    ? "SELECT * FROM machines ORDER BY last_seen_at DESC"
    : "SELECT * FROM machines WHERE archived_at IS NULL ORDER BY last_seen_at DESC";
  const rows = d.query(query).all() as MachineRow[];
  return rows.map(rowToMachine);
}

/**
 * Register a new machine or update an existing one.
 */
export function registerMachine(
  name: string,
  opts: { hostname?: string; ssh_address?: string; primary?: boolean },
  db?: Database,
): Machine {
  const d = db || getDatabase();
  const existing = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;

  if (existing) {
    d.run(
      "UPDATE machines SET hostname = ?, ssh_address = ?, last_seen_at = ? WHERE id = ?",
      [opts.hostname ?? existing.hostname, opts.ssh_address ?? existing.ssh_address, now(), existing.id],
    );
    if (opts.primary) {
      setPrimaryMachine(name, d);
    }
    return getMachine(existing.id, d)!;
  }

  const id = uuid();
  const ts = now();
  const host = opts.hostname || osHostname();
  const plat = osPlatform();

  d.run(
    "INSERT INTO machines (id, name, hostname, platform, ssh_address, last_seen_at, is_primary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, '{}', ?)",
    [id, name, host, plat, opts.ssh_address ?? null, ts, ts],
  );

  if (opts.primary) {
    setPrimaryMachine(name, d);
  }

  return getMachine(id, d)!;
}

/**
 * Set a machine as the primary machine.
 * Clears is_primary on all other machines.
 */
export function setPrimaryMachine(name: string, db?: Database): Machine {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;
  if (!row) throw new Error(`Machine '${name}' not found`);
  if (row.archived_at) throw new Error(`Cannot set archived machine '${name}' as primary`);

  d.run("UPDATE machines SET is_primary = 0 WHERE archived_at IS NULL");
  d.run("UPDATE machines SET is_primary = 1 WHERE id = ?", [row.id]);

  return rowToMachine({ ...row, is_primary: 1 });
}

/**
 * Get the primary machine.
 */
export function getPrimaryMachine(db?: Database): Machine | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE is_primary = 1").get() as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

/**
 * Archive (soft-delete) a machine.
 * Cannot archive the primary machine or machines with active/pending tasks.
 */
export function archiveMachine(id: string, db?: Database): void {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | null;
  if (!row) throw new Error(`Machine not found: ${id}`);
  if (row.is_primary) throw new Error("Cannot archive the primary machine");

  // Check for active/pending tasks on this machine
  const activeCount = d.query(
    "SELECT COUNT(*) as cnt FROM tasks WHERE machine_id = ? AND status IN ('pending', 'in_progress')",
  ).get(id) as { cnt: number };
  if (activeCount.cnt > 0) {
    throw new Error(`Cannot archive machine with ${activeCount.cnt} active/pending tasks`);
  }

  d.run("UPDATE machines SET archived_at = ? WHERE id = ?", [now(), id]);
}

/**
 * Unarchive a machine.
 */
export function unarchiveMachine(id: string, db?: Database): Machine | null {
  const d = db || getDatabase();
  d.run("UPDATE machines SET archived_at = NULL WHERE id = ?", [id]);
  return getMachine(id, d);
}

/**
 * Delete a machine (hard delete). Only allowed if not primary and no tasks.
 */
export function deleteMachine(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | null;
  if (!row) return false;
  if (row.is_primary) throw new Error("Cannot delete the primary machine");

  const activeCount = d.query(
    "SELECT COUNT(*) as cnt FROM tasks WHERE machine_id = ? AND status IN ('pending', 'in_progress')",
  ).get(id) as { cnt: number };
  if (activeCount.cnt > 0) {
    throw new Error(`Cannot delete machine with ${activeCount.cnt} active/pending tasks`);
  }

  const result = d.run("DELETE FROM machines WHERE id = ?", [id]);
  return result.changes > 0;
}

/**
 * Backfill machine_id on all entity tables for rows that don't have one.
 * Runs on startup after migrations. Idempotent — skips if all rows already stamped.
 */
const TABLES_WITH_MACHINE_ID = [
  "projects", "tasks", "agents", "task_lists", "plans", "task_comments",
  "sessions", "task_history", "webhooks", "task_templates", "orgs",
  "handoffs", "task_checklists", "project_sources", "task_files",
  "task_relationships", "kg_edges", "project_agent_roles", "dispatches",
];

export function backfillMachineId(db: Database, force = false): void {
  // Skip in test/memory databases to avoid overhead (unless forced)
  if (!force && process.env["TODOS_DB_PATH"] === ":memory:") return;

  try {
    const machine = getOrCreateLocalMachine(db);
    for (const table of TABLES_WITH_MACHINE_ID) {
      try {
        db.run(`UPDATE "${table}" SET machine_id = ? WHERE machine_id IS NULL`, [machine.id]);
      } catch {
        // Table may not exist or may not have the column yet
      }
    }
  } catch {
    // Best-effort backfill only — don't break startup
  }
}
