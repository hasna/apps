import type { AgentRun, Workspace, WorkspaceEvent, WorkspaceLocation } from "../types/workspace.js";

export const DEFAULT_CANONICAL_MACHINE_POOL = [
  "apple03",
  "machine001",
  "machine002",
  "machine003",
  "machine004",
  "machine005",
  "machine006",
  "machine007",
  "machine008",
  "machine009",
  "machine010",
  "machine011",
] as const;

export interface ProjectActivitySignals {
  last_opened_at: string | null;
  latest_activity_at: string | null;
  event_count: number;
  run_count: number;
  activity_weight: number;
}

export interface ProjectMachineAssignment {
  project_id: string;
  slug: string;
  previous_machine: string | null;
  canonical_machine: string;
  pinned: boolean;
  changed: boolean;
  activity: ProjectActivitySignals;
}

export interface ProjectMachineAssignmentPlan {
  pool: string[];
  force: boolean;
  assignments: ProjectMachineAssignment[];
  proposed_map: Record<string, string>;
  pool_counts: Record<string, number>;
  changed_count: number;
  preserved_count: number;
}

export interface ProjectWhereLocation {
  machine: string | null;
  path: string | null;
  label: string;
  role: "canonical" | "mirror";
}

export interface ProjectWhereResult {
  project: Pick<Workspace, "id" | "slug" | "name" | "status">;
  canonical_machine: string | null;
  canonical_path: string | null;
  canonical: { machine: string | null; path: string | null };
  mirrors: Array<{ machine: string; path: string; label: string }>;
  locations: ProjectWhereLocation[];
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function projectActivitySignals(
  project: Workspace,
  events: WorkspaceEvent[],
  runs: AgentRun[],
): ProjectActivitySignals {
  const candidates = [
    project.last_opened_at,
    ...events.map((event) => event.created_at),
    ...runs.flatMap((run) => [run.completed_at, run.started_at]),
  ].filter((value): value is string => Boolean(value));
  const latestActivityAt = candidates.sort((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
  const latestTimestamp = timestamp(latestActivityAt);
  return {
    last_opened_at: project.last_opened_at,
    latest_activity_at: latestActivityAt,
    event_count: events.length,
    run_count: runs.length,
    // Recency spreads hot projects across machines; counts break equal-time ties.
    activity_weight: latestTimestamp + events.length * 1_000 + runs.length * 10_000 + 1,
  };
}

export function buildProjectMachineAssignmentPlan(
  projects: Array<{ project: Workspace; activity: ProjectActivitySignals }>,
  pool: string[],
  force = false,
): ProjectMachineAssignmentPlan {
  const machines = [...new Set(pool.map((machine) => machine.trim()).filter(Boolean))];
  if (machines.length === 0) throw new Error("Machine pool must contain at least one machine");

  const states = machines.map((machine, index) => ({ machine, index, count: 0, activity: 0 }));
  const stateByMachine = new Map(states.map((state) => [state.machine, state]));
  if (!force) {
    for (const item of projects) {
      const machine = item.project.canonical_machine;
      const state = machine ? stateByMachine.get(machine) : undefined;
      if (!state) continue;
      state.count++;
      state.activity += item.activity.activity_weight;
    }
  }

  const assignmentById = new Map<string, ProjectMachineAssignment>();
  if (!force) {
    for (const item of projects) {
      const machine = item.project.canonical_machine;
      if (!machine) continue;
      assignmentById.set(item.project.id, {
        project_id: item.project.id,
        slug: item.project.slug,
        previous_machine: machine,
        canonical_machine: machine,
        pinned: true,
        changed: false,
        activity: item.activity,
      });
    }
  }

  const assignable = projects
    .filter((item) => force || !item.project.canonical_machine)
    .sort((a, b) => (
      b.activity.activity_weight - a.activity.activity_weight
      || a.project.slug.localeCompare(b.project.slug)
    ));

  for (const item of assignable) {
    const state = states.slice().sort((a, b) => (
      a.count - b.count
      || a.activity - b.activity
      || a.index - b.index
    ))[0]!;
    state.count++;
    state.activity += item.activity.activity_weight;
    assignmentById.set(item.project.id, {
      project_id: item.project.id,
      slug: item.project.slug,
      previous_machine: item.project.canonical_machine,
      canonical_machine: state.machine,
      pinned: false,
      changed: item.project.canonical_machine !== state.machine,
      activity: item.activity,
    });
  }

  const assignments = [...assignmentById.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  const proposedMap = Object.fromEntries(assignments.map((assignment) => [assignment.slug, assignment.canonical_machine]));
  return {
    pool: machines,
    force,
    assignments,
    proposed_map: proposedMap,
    pool_counts: Object.fromEntries(states.map((state) => [state.machine, state.count])),
    changed_count: assignments.filter((assignment) => assignment.changed).length,
    preserved_count: assignments.filter((assignment) => assignment.pinned).length,
  };
}

export function buildProjectWhereResult(project: Workspace, registered: WorkspaceLocation[]): ProjectWhereResult {
  const canonicalMachine = project.canonical_machine;
  const canonicalPath = project.primary_path;
  const mirrors = registered
    .filter((location) => !(location.machine_id === canonicalMachine && location.path === canonicalPath))
    .map((location) => ({ machine: location.machine_id, path: location.path, label: location.label }));
  return {
    project: { id: project.id, slug: project.slug, name: project.name, status: project.status },
    canonical_machine: canonicalMachine,
    canonical_path: canonicalPath,
    canonical: { machine: canonicalMachine, path: canonicalPath },
    mirrors,
    locations: [
      { machine: canonicalMachine, path: canonicalPath, label: "canonical", role: "canonical" },
      ...mirrors.map((location) => ({ ...location, role: "mirror" as const })),
    ],
  };
}
