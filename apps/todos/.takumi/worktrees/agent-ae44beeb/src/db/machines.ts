import type { Database } from "bun:sqlite";
import type { Machine, MachineRow } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { hostname as osHostname, platform as osPlatform } from "node:os";

function rowToMachine(row: MachineRow): Machine {
  return {
    ...row,
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

  return { id, name, hostname: host, platform: plat, last_seen_at: ts, metadata: {}, created_at: ts };
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

export function listMachines(db?: Database): Machine[] {
  const d = db || getDatabase();
  const rows = d.query("SELECT * FROM machines ORDER BY last_seen_at DESC").all() as MachineRow[];
  return rows.map(rowToMachine);
}

export function deleteMachine(id: string, db?: Database): boolean {
  const d = db || getDatabase();
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
