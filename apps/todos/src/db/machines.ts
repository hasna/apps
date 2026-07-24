import type { Database } from "bun:sqlite";
import type {
  Machine,
  MachinePathIssue,
  MachineRow,
  MachineTopologyDiagnostics,
  MachineTopologyMetadata,
  MachineTopologySummary,
} from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { existsSync } from "node:fs";
import { hostname as osHostname, platform as osPlatform, arch as osArch } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface MachineTopologyOptions {
  hostname?: string;
  platform?: string;
  ssh_address?: string;
  primary?: boolean;
  tailscale_name?: string;
  tailscale_ip?: string;
  lan_address?: string;
  workspace_path?: string;
  git_root?: string;
  arch?: string;
}

interface TopologyPathRow {
  project_id: string;
  project_name: string;
  machine_id: string;
  machine_name: string;
  path: string;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rowToMachine(row: MachineRow): Machine {
  return {
    ...row,
    is_primary: !!row.is_primary,
    metadata: parseMetadata(row.metadata),
  };
}

function discoverGitRoot(workspacePath: string): string | undefined {
  const result = spawnSync("git", ["-C", workspacePath, "rev-parse", "--show-toplevel"], {
    encoding: "utf-8",
    timeout: 2000,
  });
  if (result.status !== 0) return undefined;
  const root = result.stdout.trim();
  return root || undefined;
}

function topologyMetadata(input: MachineTopologyOptions, existing: Record<string, unknown> = {}): Record<string, unknown> {
  const next = { ...existing };
  const workspacePath = input.workspace_path ? resolve(input.workspace_path) : undefined;
  const entries: MachineTopologyMetadata = {
    tailscale_name: input.tailscale_name,
    tailscale_ip: input.tailscale_ip,
    lan_address: input.lan_address,
    workspace_path: workspacePath,
    git_root: input.git_root ?? (workspacePath ? discoverGitRoot(workspacePath) : undefined),
    arch: input.arch,
  };

  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") next[key] = value;
  }
  return next;
}

function extractTopology(machine: Machine): MachineTopologyMetadata {
  const metadata = machine.metadata;
  return {
    tailscale_name: typeof metadata["tailscale_name"] === "string" ? metadata["tailscale_name"] : undefined,
    tailscale_ip: typeof metadata["tailscale_ip"] === "string" ? metadata["tailscale_ip"] : undefined,
    lan_address: typeof metadata["lan_address"] === "string" ? metadata["lan_address"] : undefined,
    workspace_path: typeof metadata["workspace_path"] === "string" ? metadata["workspace_path"] : undefined,
    git_root: typeof metadata["git_root"] === "string" ? metadata["git_root"] : undefined,
    arch: typeof metadata["arch"] === "string" ? metadata["arch"] : undefined,
  };
}

/**
 * Get or create the local machine entry.
 * Uses TODOS_MACHINE_NAME env var, falls back to OS hostname.
 * Idempotent — returns existing machine if name matches.
 */
export function getOrCreateLocalMachine(db?: Database): Machine {
  const d = getDatabase(db);
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
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM machines WHERE id = ?").get(id) as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

export function getMachineByName(name: string, db?: Database): Machine | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

export function listMachines(db?: Database, includeArchived = false): Machine[] {
  const d = getDatabase(db);
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
  opts: MachineTopologyOptions,
  db?: Database,
): Machine {
  const d = getDatabase(db);
  const existing = d.query("SELECT * FROM machines WHERE name = ?").get(name) as MachineRow | null;
  const metadata = topologyMetadata(opts, parseMetadata(existing?.metadata ?? null));

  if (existing) {
    d.run(
      "UPDATE machines SET hostname = ?, platform = ?, ssh_address = ?, last_seen_at = ?, metadata = ? WHERE id = ?",
      [
        opts.hostname ?? existing.hostname,
        opts.platform ?? existing.platform,
        opts.ssh_address ?? existing.ssh_address,
        now(),
        JSON.stringify(metadata),
        existing.id,
      ],
    );
    if (opts.primary) {
      setPrimaryMachine(name, d);
    }
    return getMachine(existing.id, d)!;
  }

  const id = uuid();
  const ts = now();
  const host = opts.hostname || osHostname();
  const plat = opts.platform || osPlatform();

  d.run(
    "INSERT INTO machines (id, name, hostname, platform, ssh_address, last_seen_at, is_primary, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    [id, name, host, plat, opts.ssh_address ?? null, ts, JSON.stringify(metadata), ts],
  );

  if (opts.primary) {
    setPrimaryMachine(name, d);
  }

  return getMachine(id, d)!;
}

export function updateMachineHeartbeat(
  idOrName?: string,
  opts: MachineTopologyOptions = {},
  db?: Database,
): Machine {
  const d = getDatabase(db);
  const key = idOrName || process.env["TODOS_MACHINE_NAME"] || osHostname();
  const row = d.query("SELECT * FROM machines WHERE id = ? OR name = ?").get(key, key) as MachineRow | null;
  if (!row) {
    return registerMachine(key, {
      hostname: opts.hostname ?? osHostname(),
      platform: opts.platform ?? osPlatform(),
      arch: opts.arch ?? osArch(),
      ...opts,
    }, d);
  }

  const metadata = topologyMetadata({ arch: osArch(), ...opts }, parseMetadata(row.metadata));
  const ts = now();
  d.run(
    "UPDATE machines SET hostname = ?, platform = ?, ssh_address = ?, last_seen_at = ?, metadata = ? WHERE id = ?",
    [
      opts.hostname ?? row.hostname ?? osHostname(),
      opts.platform ?? row.platform ?? osPlatform(),
      opts.ssh_address ?? row.ssh_address,
      ts,
      JSON.stringify(metadata),
      row.id,
    ],
  );
  return getMachine(row.id, d)!;
}

export function getMachineTopologyDiagnostics(
  opts: { stale_minutes?: number; include_archived?: boolean } = {},
  db?: Database,
  at: Date = new Date(),
): MachineTopologyDiagnostics {
  const d = getDatabase(db);
  const staleAfter = opts.stale_minutes ?? 30;
  const generatedAt = at.toISOString();
  const localMachine = getOrCreateLocalMachine(d);
  const machines = listMachines(d, opts.include_archived ?? true);
  const machineById = new Map(machines.map((machine) => [machine.id, machine]));

  const summaries: MachineTopologySummary[] = machines.map((machine) => {
    const lastSeenMs = Date.parse(machine.last_seen_at);
    const staleMinutes = Number.isFinite(lastSeenMs)
      ? Math.max(0, Math.floor((at.getTime() - lastSeenMs) / 60_000))
      : Number.POSITIVE_INFINITY;
    return {
      id: machine.id,
      name: machine.name,
      hostname: machine.hostname,
      platform: machine.platform,
      ssh_address: machine.ssh_address,
      is_primary: machine.is_primary,
      archived_at: machine.archived_at,
      last_seen_at: machine.last_seen_at,
      stale: !machine.archived_at && staleMinutes > staleAfter,
      stale_minutes: Number.isFinite(staleMinutes) ? staleMinutes : staleAfter + 1,
      topology: extractTopology(machine),
    };
  });

  const pathRows = d.query(
    `SELECT p.id AS project_id, p.name AS project_name, pmp.machine_id, m.name AS machine_name, pmp.path
     FROM project_machine_paths pmp
     JOIN projects p ON p.id = pmp.project_id
     LEFT JOIN machines m ON m.id = pmp.machine_id
     ORDER BY p.name, pmp.machine_id`,
  ).all() as TopologyPathRow[];
  const projectRows = d.query("SELECT id, name, path FROM projects ORDER BY name").all() as Array<{ id: string; name: string; path: string }>;
  const rowsByProject = new Map<string, TopologyPathRow[]>();
  for (const row of pathRows) {
    const rows = rowsByProject.get(row.project_id) ?? [];
    rows.push({ ...row, machine_name: row.machine_name ?? row.machine_id });
    rowsByProject.set(row.project_id, rows);
  }

  const pathIssues: MachinePathIssue[] = [];
  for (const project of projectRows) {
    const rows = rowsByProject.get(project.id) ?? [];
    const localRow = rows.find((row) => row.machine_id === localMachine.id);
    if (!localRow) {
      pathIssues.push({
        type: "missing_local_path",
        project_id: project.id,
        project_name: project.name,
        message: `No machine-local path override is registered for ${project.name} on ${localMachine.name}`,
      });
    }

    const distinctPaths = [...new Set(rows.map((row) => row.path))];
    if (distinctPaths.length > 1) {
      pathIssues.push({
        type: "path_mismatch",
        project_id: project.id,
        project_name: project.name,
        paths: rows.map((row) => ({ machine_id: row.machine_id, machine_name: row.machine_name, path: row.path })),
        message: `${project.name} has ${distinctPaths.length} different machine-local paths`,
      });
    }

    if (localRow && !existsSync(localRow.path)) {
      pathIssues.push({
        type: "path_missing",
        project_id: project.id,
        project_name: project.name,
        machine_id: localMachine.id,
        machine_name: localMachine.name,
        path: localRow.path,
        message: `Local path does not exist on this machine: ${localRow.path}`,
      });
    }

    if (!localRow && project.path && machineById.has(localMachine.id) && !existsSync(project.path)) {
      pathIssues.push({
        type: "path_missing",
        project_id: project.id,
        project_name: project.name,
        machine_id: localMachine.id,
        machine_name: localMachine.name,
        path: project.path,
        message: `Project path does not exist on this machine: ${project.path}`,
      });
    }
  }

  return {
    generated_at: generatedAt,
    stale_after_minutes: staleAfter,
    local_machine: localMachine,
    machines: summaries,
    stale_machines: summaries.filter((summary) => summary.stale),
    path_issues: pathIssues,
  };
}

/**
 * Set a machine as the primary machine.
 * Clears is_primary on all other machines.
 */
export function setPrimaryMachine(name: string, db?: Database): Machine {
  const d = getDatabase(db);
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
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM machines WHERE is_primary = 1").get() as MachineRow | null;
  return row ? rowToMachine(row) : null;
}

/**
 * Archive (soft-delete) a machine.
 * Cannot archive the primary machine or machines with active/pending tasks.
 */
export function archiveMachine(id: string, db?: Database): void {
  const d = getDatabase(db);
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
  const d = getDatabase(db);
  d.run("UPDATE machines SET archived_at = NULL WHERE id = ?", [id]);
  return getMachine(id, d);
}

/**
 * Delete a machine (hard delete). Only allowed if not primary and no tasks.
 */
export function deleteMachine(id: string, db?: Database): boolean {
  const d = getDatabase(db);
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
