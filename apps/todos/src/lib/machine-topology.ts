/**
 * Local machine registry and topology diagnostics — multi-machine agent workflows.
 * No hosted/cloud calls.
 */

import { hostname, platform } from "node:os";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import {
  getOrCreateLocalMachine,
  listMachines,
  getMachineId,
  resetMachineId,
  type Machine,
} from "../db/machines.js";
import { listAgents } from "../db/agents.js";
import { listProjects } from "../db/projects.js";
import { getStaleTasks } from "../db/tasks.js";

export const MACHINE_TOPOLOGY_SCHEMA = "todos.machine_topology.v1";

export interface MachinePathOverride {
  project_id: string;
  project_name: string;
  machine_id: string;
  path: string;
  path_normalized: string;
  casing_mismatch: boolean;
}

export interface MachineAgentSummary {
  agent_id: string;
  agent_name: string;
  machine_id: string | null;
  last_seen_at: string;
  stale: boolean;
}

export interface MachineTopologyNode {
  schema_version: typeof MACHINE_TOPOLOGY_SCHEMA;
  id: string;
  name: string;
  hostname: string;
  platform: string;
  last_seen_at: string;
  is_local: boolean;
  active_agents: number;
  stale_locks: number;
  path_overrides: number;
}

export interface MachineTopologyReport {
  schema_version: typeof MACHINE_TOPOLOGY_SCHEMA;
  generated_at: string;
  local_machine_id: string;
  local_hostname: string;
  workspace_cwd: string;
  machines: MachineTopologyNode[];
  path_overrides: MachinePathOverride[];
  agents: MachineAgentSummary[];
  stale_tasks: Array<{ id: string; title: string; locked_by: string | null; locked_at: string | null }>;
  diagnostics: string[];
  sync_health: "ok" | "warn" | "degraded";
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function detectCasingMismatch(stored: string, canonical: string): boolean {
  return normalizePath(stored) === normalizePath(canonical) && stored !== canonical;
}

export function registerLocalMachine(db?: Database): Machine {
  resetMachineId();
  return getOrCreateLocalMachine(db);
}

export function getPathOverrides(db?: Database): MachinePathOverride[] {
  const d = db || getDatabase();
  const projects = listProjects(d);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const rows = d.query("SELECT * FROM project_machine_paths ORDER BY project_id, machine_id").all() as Array<{
    project_id: string;
    machine_id: string;
    path: string;
  }>;

  return rows.map((row) => {
    const project = projectById.get(row.project_id);
    const canonical = project?.path ?? row.path;
    return {
      project_id: row.project_id,
      project_name: project?.name ?? row.project_id.slice(0, 8),
      machine_id: row.machine_id,
      path: row.path,
      path_normalized: normalizePath(row.path),
      casing_mismatch: detectCasingMismatch(row.path, canonical),
    };
  });
}

export function getMachineAgentSummaries(db?: Database): MachineAgentSummary[] {
  const d = db || getDatabase();
  const staleMinutes = 30;
  const cutoff = Date.now() - staleMinutes * 60 * 1000;

  return listAgents(undefined, d).map((a) => ({
    agent_id: a.id,
    agent_name: a.name,
    machine_id: (a as { machine_id?: string }).machine_id ?? null,
    last_seen_at: a.last_seen_at,
    stale: new Date(a.last_seen_at).getTime() < cutoff,
  }));
}

export function buildMachineTopologyReport(db?: Database): MachineTopologyReport {
  const d = db || getDatabase();
  const local = registerLocalMachine(d);
  const localId = local.id;
  const machines = listMachines(d);
  const pathOverrides = getPathOverrides(d);
  const agents = getMachineAgentSummaries(d);
  const staleTasks = getStaleTasks(30, undefined, d).map((t) => ({
    id: t.id,
    title: t.title,
    locked_by: t.locked_by,
    locked_at: t.locked_at,
  }));

  const diagnostics: string[] = [];
  const casingIssues = pathOverrides.filter((p) => p.casing_mismatch);
  if (casingIssues.length) {
    diagnostics.push(`${casingIssues.length} path override(s) with casing mismatch vs canonical project path`);
  }
  if (staleTasks.length) {
    diagnostics.push(`${staleTasks.length} stale in_progress task(s) with locks`);
  }
  const staleAgents = agents.filter((a) => a.stale);
  if (staleAgents.length) {
    diagnostics.push(`${staleAgents.length} agent(s) not seen in 30+ minutes`);
  }
  if (machines.length === 1) {
    diagnostics.push("Single machine in registry — multi-machine sync not detected");
  }

  let sync_health: MachineTopologyReport["sync_health"] = "ok";
  if (diagnostics.length > 0) sync_health = "warn";
  if (staleTasks.length > 3 || casingIssues.length > 0) sync_health = "degraded";

  const overridesByMachine = new Map<string, number>();
  for (const p of pathOverrides) {
    overridesByMachine.set(p.machine_id, (overridesByMachine.get(p.machine_id) ?? 0) + 1);
  }

  const staleByMachine = new Map<string, number>();
  for (const t of staleTasks) {
    if (t.locked_by) staleByMachine.set(t.locked_by, (staleByMachine.get(t.locked_by) ?? 0) + 1);
  }

  const nodes: MachineTopologyNode[] = machines.map((m) => ({
    schema_version: MACHINE_TOPOLOGY_SCHEMA,
    id: m.id,
    name: m.name,
    hostname: m.hostname,
    platform: m.platform,
    last_seen_at: m.last_seen_at,
    is_local: m.id === localId,
    active_agents: agents.filter((a) => !a.stale && a.machine_id === m.id).length,
    stale_locks: staleByMachine.get(m.name) ?? 0,
    path_overrides: overridesByMachine.get(m.id) ?? 0,
  }));

  return {
    schema_version: MACHINE_TOPOLOGY_SCHEMA,
    generated_at: new Date().toISOString(),
    local_machine_id: localId,
    local_hostname: hostname(),
    workspace_cwd: process.cwd(),
    machines: nodes,
    path_overrides: pathOverrides,
    agents,
    stale_tasks: staleTasks,
    diagnostics,
    sync_health,
  };
}

export function getReachableHostnames(): string[] {
  const names = new Set<string>();
  names.add(hostname());
  if (process.env["TODOS_MACHINE_NAME"]) names.add(process.env["TODOS_MACHINE_NAME"]);
  if (process.env["TODOS_MACHINE_ID"]) names.add(process.env["TODOS_MACHINE_ID"]);
  return [...names];
}

export function getTopologyDocs(): string {
  return `# Machine Registry & Topology (${MACHINE_TOPOLOGY_SCHEMA})

Local-only multi-machine diagnostics for agent workflows.

## CLI
\`\`\`bash
todos machines register      # upsert local machine
todos machines list          # all registered machines
todos machines topology      # full diagnostic report
\`\`\`

## Env
- \`TODOS_MACHINE_NAME\` — stable machine name in registry
- \`TODOS_MACHINE_ID\` — override machine id in reports
`;
}
