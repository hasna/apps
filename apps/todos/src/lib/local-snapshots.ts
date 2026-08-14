import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { now } from "../db/database.js";
import { getPackageVersion } from "./package-version.js";
import { getLocalActivityTimeline } from "./activity-timeline.js";
import { createLocalBridgeBundle } from "./local-bridge.js";

export const TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION = 1;

export type LocalSnapshotType =
  | "projects"
  | "tasks"
  | "plans"
  | "runs"
  | "dependencies"
  | "events"
  | "evidence";

export interface LocalSnapshotCatalogEntry {
  type: LocalSnapshotType;
  uri: string;
  title: string;
  description: string;
  json_contract: "local_snapshot";
}

export interface LocalSnapshotOptions {
  type: LocalSnapshotType;
  project_id?: string;
  generatedAt?: string;
  limit?: number;
  since?: string;
}

export interface LocalSnapshot {
  schema_version: typeof TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION;
  kind: "hasna.todos.local-snapshot";
  type: LocalSnapshotType;
  local_only: true;
  no_network: true;
  redacted: true;
  generated_at: string;
  package: {
    packageName: "@hasna/todos";
    repository: "hasna/todos";
    version: string;
  };
  filters: {
    project_id: string | null;
    since: string | null;
    limit: number;
  };
  cursor: string;
  fingerprint: string;
  count: number;
  items: unknown[];
  resources: {
    self: string;
    poll_tool: "poll_local_snapshots";
    markdown_tool: "get_local_snapshot";
  };
}

export interface LocalSnapshotPollResult {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  since: string | null;
  cursor: string;
  changed: boolean;
  snapshots: LocalSnapshot[];
}

const SNAPSHOT_CATALOG: LocalSnapshotCatalogEntry[] = [
  {
    type: "projects",
    uri: "todos://snapshots/projects",
    title: "Projects",
    description: "Local project summaries with task and plan counts.",
    json_contract: "local_snapshot",
  },
  {
    type: "tasks",
    uri: "todos://snapshots/tasks",
    title: "Tasks",
    description: "Local task summaries with status, assignment, dependency, run, and verification counts.",
    json_contract: "local_snapshot",
  },
  {
    type: "plans",
    uri: "todos://snapshots/plans",
    title: "Plans",
    description: "Local plan summaries with task status breakdowns.",
    json_contract: "local_snapshot",
  },
  {
    type: "runs",
    uri: "todos://snapshots/runs",
    title: "Runs",
    description: "Local run ledgers with event, command, artifact, and file counts.",
    json_contract: "local_snapshot",
  },
  {
    type: "dependencies",
    uri: "todos://snapshots/dependencies",
    title: "Dependencies",
    description: "Local task dependency edges for blocker and ready-state clients.",
    json_contract: "local_snapshot",
  },
  {
    type: "events",
    uri: "todos://snapshots/events",
    title: "Events",
    description: "Redacted local activity timeline entries across comments, task history, and run evidence.",
    json_contract: "local_snapshot",
  },
  {
    type: "evidence",
    uri: "todos://snapshots/evidence",
    title: "Evidence",
    description: "Local verification, git, file, command, and artifact evidence summaries.",
    json_contract: "local_snapshot",
  },
];

const ALL_TYPES = SNAPSHOT_CATALOG.map((entry) => entry.type);

function source(version: string) {
  return {
    packageName: "@hasna/todos" as const,
    repository: "hasna/todos" as const,
    version,
  };
}

function limitItems<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value || 0) || !value || value < 1) return 100;
  return Math.min(Math.floor(value), 1000);
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stable(item)]));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function latestTimestamp(items: unknown[], fallback: string): string {
  const timestamps: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === "string" && /(^|_)(at|date)$/.test(key)) timestamps.push(item);
      else if (item && typeof item === "object") visit(item);
    }
  };
  visit(items);
  return timestamps.sort().at(-1) ?? fallback;
}

function taskStatusCounts(tasks: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

function snapshotItems(options: LocalSnapshotOptions, db?: Database): unknown[] {
  const limit = normalizeLimit(options.limit);
  const bundle = createLocalBridgeBundle({ project_id: options.project_id, generatedAt: options.generatedAt }, db);
  const data = bundle.data;

  if (options.type === "projects") {
    return limitItems(data.projects.map((project) => {
      const tasks = data.tasks.filter((task) => task.project_id === project.id);
      const plans = data.plans.filter((plan) => plan.project_id === project.id);
      return {
        id: project.id,
        name: project.name,
        path: project.path,
        description: project.description,
        task_list_id: project.task_list_id,
        task_prefix: project.task_prefix,
        task_counter: project.task_counter,
        created_at: project.created_at,
        updated_at: project.updated_at,
        counts: {
          tasks: tasks.length,
          plans: plans.length,
          by_status: taskStatusCounts(tasks),
        },
      };
    }), limit);
  }

  if (options.type === "tasks") {
    return limitItems(data.tasks.map((task) => {
      const dependencies = data.task_dependencies.filter((dependency) => dependency.task_id === task.id);
      return {
        id: task.id,
        short_id: task.short_id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        project_id: task.project_id,
        plan_id: task.plan_id,
        task_list_id: task.task_list_id,
        agent_id: task.agent_id,
        assigned_to: task.assigned_to,
        tags: task.tags,
        due_at: task.due_at,
        created_at: task.created_at,
        updated_at: task.updated_at,
        counts: {
          dependencies: dependencies.length,
          dependents: data.task_dependencies.filter((dependency) => dependency.depends_on === task.id).length,
          runs: data.runs.filter((run) => run.task_id === task.id).length,
          verifications: data.task_verifications.filter((verification) => verification.task_id === task.id).length,
          files: data.task_files.filter((file) => file.task_id === task.id).length,
        },
        blocked_by: dependencies.map((dependency) => dependency.depends_on),
      };
    }), limit);
  }

  if (options.type === "plans") {
    return limitItems(data.plans.map((plan) => {
      const tasks = data.tasks.filter((task) => task.plan_id === plan.id);
      return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        status: plan.status,
        project_id: plan.project_id,
        task_list_id: plan.task_list_id,
        agent_id: plan.agent_id,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
        counts: {
          tasks: tasks.length,
          by_status: taskStatusCounts(tasks),
        },
      };
    }), limit);
  }

  if (options.type === "runs") {
    return limitItems(data.runs.map((run) => ({
      id: run.id,
      task_id: run.task_id,
      agent_id: run.agent_id,
      title: run.title,
      status: run.status,
      summary: run.summary,
      started_at: run.started_at,
      completed_at: run.completed_at,
      created_at: run.created_at,
      updated_at: run.updated_at,
      counts: {
        events: data.run_events.filter((event) => event.run_id === run.id).length,
        commands: data.run_commands.filter((command) => command.run_id === run.id).length,
        artifacts: data.run_artifacts.filter((artifact) => artifact.run_id === run.id).length,
        files: data.task_files.filter((file) => file.task_id === run.task_id).length,
      },
    })), limit);
  }

  if (options.type === "dependencies") {
    return limitItems(data.task_dependencies.map((dependency) => ({
      task_id: dependency.task_id,
      depends_on: dependency.depends_on,
      external_project_id: dependency.external_project_id,
      external_task_id: dependency.external_task_id,
    })), limit);
  }

  if (options.type === "events") {
    return getLocalActivityTimeline({
      project_id: options.project_id,
      since: options.since,
      limit,
      order: "desc",
    }, db).entries;
  }

  return limitItems([
    ...data.task_verifications.map((verification) => ({ source: "verification", ...verification })),
    ...data.task_files.map((file) => ({ source: "file", ...file })),
    ...data.task_commits.map((commit) => ({ source: "commit", ...commit })),
    ...data.task_git_refs.map((ref) => ({ source: "git_ref", ...ref })),
    ...data.run_commands.map((command) => ({ source: "run_command", ...command })),
    ...data.run_artifacts.map((artifact) => ({ source: "run_artifact", ...artifact })),
  ].sort((left, right) => String((right as any).created_at ?? (right as any).run_at ?? "")
    .localeCompare(String((left as any).created_at ?? (left as any).run_at ?? ""))), limit);
}

export function listLocalSnapshotResources(): LocalSnapshotCatalogEntry[] {
  return SNAPSHOT_CATALOG.map((entry) => ({ ...entry }));
}

export function getLocalSnapshot(
  options: LocalSnapshotOptions,
  db?: Database,
): LocalSnapshot {
  if (!ALL_TYPES.includes(options.type)) {
    throw new Error(`Unknown local snapshot type: ${options.type}`);
  }
  const generatedAt = options.generatedAt ?? now();
  const limit = normalizeLimit(options.limit);
  const items = snapshotItems({ ...options, generatedAt, limit }, db);
  const cursor = latestTimestamp(items, generatedAt);
  const body = {
    type: options.type,
    filters: {
      project_id: options.project_id ?? null,
      since: options.since ?? null,
      limit,
    },
    cursor,
    items,
  };
  return {
    schema_version: TODOS_LOCAL_SNAPSHOT_SCHEMA_VERSION,
    kind: "hasna.todos.local-snapshot",
    type: options.type,
    local_only: true,
    no_network: true,
    redacted: true,
    generated_at: generatedAt,
    package: source(getPackageVersion(import.meta.url)),
    filters: body.filters,
    cursor,
    fingerprint: sha256(body),
    count: items.length,
    items,
    resources: {
      self: `todos://snapshots/${options.type}`,
      poll_tool: "poll_local_snapshots",
      markdown_tool: "get_local_snapshot",
    },
  };
}

export function pollLocalSnapshots(
  options: {
    types?: LocalSnapshotType[];
    project_id?: string;
    since?: string;
    generatedAt?: string;
    limit?: number;
  } = {},
  db?: Database,
): LocalSnapshotPollResult {
  const generatedAt = options.generatedAt ?? now();
  const types = options.types?.length ? options.types : ALL_TYPES;
  const snapshots = types
    .map((type) => getLocalSnapshot({
      type,
      project_id: options.project_id,
      since: options.since,
      generatedAt,
      limit: options.limit,
    }, db))
    .filter((snapshot) => !options.since || snapshot.cursor > options.since);
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: generatedAt,
    since: options.since ?? null,
    cursor: snapshots.map((snapshot) => snapshot.cursor).sort().at(-1) ?? options.since ?? generatedAt,
    changed: snapshots.length > 0,
    snapshots,
  };
}

export function renderLocalSnapshotMarkdown(snapshot: LocalSnapshot): string {
  const lines = [
    `# ${snapshot.type} snapshot`,
    "",
    `- generated_at: ${snapshot.generated_at}`,
    `- cursor: ${snapshot.cursor}`,
    `- count: ${snapshot.count}`,
    `- fingerprint: ${snapshot.fingerprint}`,
    "",
  ];
  for (const item of snapshot.items) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const title = String(record.title ?? record.name ?? record.id ?? record.task_id ?? "item");
    lines.push(`## ${title}`);
    for (const [key, value] of Object.entries(record)) {
      if (key === "title" || key === "name") continue;
      lines.push(`- ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
