import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPackageVersion } from "./package-version.js";
import {
  TODOS_LOCAL_BRIDGE_KIND,
  TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
  importLocalBridgeBundle,
  type ImportLocalBridgeOptions,
  type LocalBridgeImportResult,
  type TodosLocalBridgeBundle,
  type TodosLocalBridgeData,
} from "./local-bridge.js";

export const TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION = "2026-05-22";
export const TODOS_ONBOARDING_FIXTURE_SOURCE = "bundled-local-onboarding-fixtures";

export interface OnboardingFixtureSummary {
  name: string;
  description: string;
  version: string;
  local_only: true;
  no_network: true;
  redacted: true;
  workflow: string[];
  stats: Record<keyof TodosLocalBridgeData, number>;
}

export interface OnboardingFixture {
  summary: Omit<OnboardingFixtureSummary, "stats">;
  bundle: TodosLocalBridgeBundle;
}

export interface WriteOnboardingFixtureResult {
  directory: string;
  written: number;
  files: string[];
}

export interface ImportOnboardingFixtureOptions extends ImportLocalBridgeOptions {
  name?: string;
}

const exportedAt = "2026-05-22T00:00:00.000Z";
const createdAt = "2026-05-22T00:00:00.000Z";
const completedAt = "2026-05-22T00:30:00.000Z";

const ids = {
  project: "10000000-0000-4000-8000-000000000001",
  list: "10000000-0000-4000-8000-000000000002",
  plan: "10000000-0000-4000-8000-000000000003",
  taskCreateProject: "10000000-0000-4000-8000-000000000010",
  taskAddTodos: "10000000-0000-4000-8000-000000000011",
  taskRunAgent: "10000000-0000-4000-8000-000000000012",
  taskReview: "10000000-0000-4000-8000-000000000013",
  commentProject: "10000000-0000-4000-8000-000000000020",
  commentReview: "10000000-0000-4000-8000-000000000021",
  run: "10000000-0000-4000-8000-000000000030",
  eventStarted: "10000000-0000-4000-8000-000000000031",
  eventCommand: "10000000-0000-4000-8000-000000000032",
  eventArtifact: "10000000-0000-4000-8000-000000000033",
  eventCompleted: "10000000-0000-4000-8000-000000000034",
  command: "10000000-0000-4000-8000-000000000040",
  artifact: "10000000-0000-4000-8000-000000000041",
  file: "10000000-0000-4000-8000-000000000050",
  verification: "10000000-0000-4000-8000-000000000060",
  savedView: "10000000-0000-4000-8000-000000000070",
  board: "10000000-0000-4000-8000-000000000080",
};

function emptyData(): TodosLocalBridgeData {
  return {
    projects: [],
    task_lists: [],
    plans: [],
    tasks: [],
    task_dependencies: [],
    comments: [],
    runs: [],
    run_events: [],
    run_commands: [],
    run_artifacts: [],
    task_files: [],
    task_commits: [],
    task_git_refs: [],
    task_verifications: [],
    saved_views: [],
    task_boards: [],
    local_calendar_items: [],
  };
}

function stats(data: TodosLocalBridgeData): Record<keyof TodosLocalBridgeData, number> {
  return Object.fromEntries(
    (Object.keys(data) as Array<keyof TodosLocalBridgeData>).map((key) => [key, data[key].length]),
  ) as Record<keyof TodosLocalBridgeData, number>;
}

function task(input: {
  id: string;
  title: string;
  description: string;
  status?: "pending" | "in_progress" | "completed";
  priority?: "low" | "medium" | "high" | "critical";
  assigned_to?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}) {
  return {
    id: input.id,
    short_id: null,
    project_id: ids.project,
    parent_id: null,
    plan_id: ids.plan,
    task_list_id: ids.list,
    title: input.title,
    description: input.description,
    status: input.status ?? "pending",
    priority: input.priority ?? "medium",
    agent_id: null,
    assigned_to: input.assigned_to ?? null,
    session_id: null,
    working_dir: "/workspace/demo",
    tags: ["onboarding", "demo", ...(input.tags ?? [])],
    metadata: {
      source: TODOS_ONBOARDING_FIXTURE_SOURCE,
      fixture: "agent-project-demo",
      redacted: true,
      ...input.metadata,
    },
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: createdAt,
    updated_at: input.completed_at ?? input.started_at ?? createdAt,
    started_at: input.started_at ?? null,
    completed_at: input.completed_at ?? null,
    due_at: null,
    estimated_minutes: 10,
    actual_minutes: input.completed_at ? 8 : null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    spawns_template_id: null,
    confidence: 0.9,
    reason: "Bundled deterministic onboarding fixture",
    spawned_from_session: null,
    assigned_by: null,
    assigned_from_project: null,
    task_type: "onboarding",
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 3,
    retry_after: null,
    sla_minutes: null,
    runner_id: null,
    runner_started_at: null,
    runner_completed_at: null,
    current_step: null,
    total_steps: null,
    cycle_id: null,
  };
}

function createAgentProjectDemoBundle(): TodosLocalBridgeBundle {
  const data = emptyData();
  data.projects.push({
    id: ids.project,
    name: "Agent Project Demo",
    path: "/workspace/demo",
    description: "Deterministic local onboarding project for agent-native todo workflows.",
    task_list_id: ids.list,
    task_prefix: "DEMO",
    task_counter: 4,
    created_at: createdAt,
    updated_at: completedAt,
  });
  data.task_lists.push({
    id: ids.list,
    project_id: ids.project,
    slug: "agent-demo",
    name: "Agent Demo",
    description: "Create a project, add todos, run an agent, and review evidence.",
    metadata: { source: TODOS_ONBOARDING_FIXTURE_SOURCE, local_only: true },
    created_at: createdAt,
    updated_at: completedAt,
  });
  data.plans.push({
    id: ids.plan,
    project_id: ids.project,
    task_list_id: ids.list,
    agent_id: "demo-agent",
    name: "Ship the local demo workflow",
    description: "A compact one-tab demo: create a project, add todos, run an agent, review evidence, and export/import state.",
    status: "completed",
    created_at: createdAt,
    updated_at: completedAt,
  });
  data.tasks.push(
    task({
      id: ids.taskCreateProject,
      title: "Create the project",
      description: "Register a local project and task list without hosted services.",
      status: "completed",
      priority: "high",
      assigned_to: "demo-agent",
      started_at: createdAt,
      completed_at: "2026-05-22T00:05:00.000Z",
      tags: ["project"],
    }),
    task({
      id: ids.taskAddTodos,
      title: "Add the first todos",
      description: "Capture setup, implementation, verification, and review tasks.",
      status: "completed",
      priority: "high",
      assigned_to: "demo-agent",
      started_at: "2026-05-22T00:05:00.000Z",
      completed_at: "2026-05-22T00:12:00.000Z",
      tags: ["tasks"],
    }),
    task({
      id: ids.taskRunAgent,
      title: "Run the agent on the plan",
      description: "Claim the implementation task, run local commands, and record redacted evidence.",
      status: "completed",
      priority: "critical",
      assigned_to: "demo-agent",
      started_at: "2026-05-22T00:12:00.000Z",
      completed_at: completedAt,
      tags: ["agent-run", "evidence"],
    }),
    task({
      id: ids.taskReview,
      title: "Review completion evidence",
      description: "Inspect the run ledger, verification record, and local export/import dry-run.",
      status: "pending",
      priority: "medium",
      tags: ["review"],
    }),
  );
  data.task_dependencies.push(
    { task_id: ids.taskAddTodos, depends_on: ids.taskCreateProject, external_project_id: null, external_task_id: null },
    { task_id: ids.taskRunAgent, depends_on: ids.taskAddTodos, external_project_id: null, external_task_id: null },
    { task_id: ids.taskReview, depends_on: ids.taskRunAgent, external_project_id: null, external_task_id: null },
  );
  data.comments.push(
    {
      id: ids.commentProject,
      task_id: ids.taskCreateProject,
      agent_id: "demo-agent",
      session_id: "demo-session",
      content: "Created local project and task list. No hosted account or network call required.",
      type: "comment",
      progress_pct: 100,
      created_at: "2026-05-22T00:05:00.000Z",
    },
    {
      id: ids.commentReview,
      task_id: ids.taskReview,
      agent_id: "reviewer",
      session_id: "demo-session",
      content: "Ready for operator review: run ledger, verification, and bridge bundle are all local and redacted.",
      type: "note",
      progress_pct: null,
      created_at: completedAt,
    },
  );
  data.runs.push({
    id: ids.run,
    task_id: ids.taskRunAgent,
    agent_id: "demo-agent",
    title: "Execute demo plan",
    status: "completed",
    summary: "Agent completed the local demo task and recorded deterministic evidence.",
    metadata: { local_only: true, no_network: true, redacted: true },
    started_at: "2026-05-22T00:12:00.000Z",
    completed_at: completedAt,
    created_at: "2026-05-22T00:12:00.000Z",
    updated_at: completedAt,
  });
  data.run_events.push(
    { id: ids.eventStarted, run_id: ids.run, task_id: ids.taskRunAgent, event_type: "started", message: "demo run started", data: { claim: true }, agent_id: "demo-agent", created_at: "2026-05-22T00:12:00.000Z" },
    { id: ids.eventCommand, run_id: ids.run, task_id: ids.taskRunAgent, event_type: "command", message: "local smoke command passed", data: { command: "todos list --json" }, agent_id: "demo-agent", created_at: "2026-05-22T00:20:00.000Z" },
    { id: ids.eventArtifact, run_id: ids.run, task_id: ids.taskRunAgent, event_type: "artifact", message: "redacted evidence artifact recorded", data: { path: "evidence/demo-run.json" }, agent_id: "demo-agent", created_at: "2026-05-22T00:25:00.000Z" },
    { id: ids.eventCompleted, run_id: ids.run, task_id: ids.taskRunAgent, event_type: "completed", message: "demo run completed", data: { status: "completed" }, agent_id: "demo-agent", created_at: completedAt },
  );
  data.run_commands.push({
    id: ids.command,
    run_id: ids.run,
    task_id: ids.taskRunAgent,
    command: "todos list --json",
    status: "passed",
    exit_code: 0,
    output_summary: "Listed demo tasks from local SQLite.",
    artifact_path: "evidence/demo-run.json",
    agent_id: "demo-agent",
    started_at: "2026-05-22T00:20:00.000Z",
    completed_at: "2026-05-22T00:20:01.000Z",
    created_at: "2026-05-22T00:20:00.000Z",
  });
  data.run_artifacts.push({
    id: ids.artifact,
    run_id: ids.run,
    task_id: ids.taskRunAgent,
    path: "evidence/demo-run.json",
    artifact_type: "verification",
    description: "Redacted deterministic local run evidence.",
    size_bytes: 168,
    sha256: "3e5f2e8b4d0d2d0f0b1b0f1e5cbb0f3f4c4f2e3d1c0b0a090807060504030201",
    metadata: { local_only: true, redacted: true },
    agent_id: "demo-agent",
    created_at: "2026-05-22T00:25:00.000Z",
  });
  data.task_files.push({
    id: ids.file,
    task_id: ids.taskRunAgent,
    path: "README.md",
    status: "modified",
    agent_id: "demo-agent",
    note: "Demo fixture file touch record.",
    created_at: "2026-05-22T00:24:00.000Z",
    updated_at: "2026-05-22T00:24:00.000Z",
  });
  data.task_verifications.push({
    id: ids.verification,
    task_id: ids.taskRunAgent,
    command: "todos export --format bridge --json",
    status: "passed",
    output_summary: "Bridge export created locally and can be dry-run imported.",
    artifact_path: "evidence/demo-run.json",
    agent_id: "demo-agent",
    run_at: completedAt,
    created_at: completedAt,
  });
  data.saved_views.push({
    id: ids.savedView,
    name: "onboarding-demo-ready",
    description: "Ready or pending items in the bundled onboarding demo.",
    scope: "tasks",
    filters: { project_id: ids.project, status: ["pending", "in_progress"] },
    created_at: createdAt,
    updated_at: completedAt,
  });
  data.task_boards.push({
    id: ids.board,
    name: "Onboarding Demo Board",
    scope: "tasks",
    project_id: ids.project,
    task_list_id: ids.list,
    plan_id: ids.plan,
    agent_id: "demo-agent",
    lanes: [
      { id: "todo", name: "Todo", statuses: ["pending"], wip_limit: null, position: 0 },
      { id: "running", name: "Running", statuses: ["in_progress"], wip_limit: null, position: 1 },
      { id: "done", name: "Done", statuses: ["completed"], wip_limit: null, position: 2 },
    ],
    filters: { project_id: ids.project },
    created_at: createdAt,
    updated_at: completedAt,
  });

  return {
    schemaVersion: TODOS_LOCAL_BRIDGE_SCHEMA_VERSION,
    kind: TODOS_LOCAL_BRIDGE_KIND,
    exportedAt,
    package: {
      packageName: "@hasna/todos",
      repository: "hasna/todos",
      version: getPackageVersion(import.meta.url),
    },
    source: {
      project_id: ids.project,
      project_path: "/workspace/demo",
    },
    data,
    artifact_contents: [],
    stats: stats(data),
  };
}

function allFixtures(): OnboardingFixture[] {
  return [
    {
      summary: {
        name: "agent-project-demo",
        description: "One-tab local demo for creating a project, adding todos, running an agent, reviewing evidence, and importing/exporting data.",
        version: TODOS_ONBOARDING_FIXTURE_LIBRARY_VERSION,
        local_only: true,
        no_network: true,
        redacted: true,
        workflow: [
          "Create a local project and task list",
          "Add todos into a plan",
          "Run an agent against the plan",
          "Record command, artifact, and verification evidence",
          "Review remaining work",
          "Export and import the local bridge bundle",
        ],
      },
      bundle: createAgentProjectDemoBundle(),
    },
  ];
}

export function listOnboardingFixtures(): OnboardingFixtureSummary[] {
  return allFixtures().map((fixture) => ({
    ...fixture.summary,
    workflow: [...fixture.summary.workflow],
    stats: { ...fixture.bundle.stats },
  }));
}

export function getOnboardingFixture(name = "agent-project-demo"): OnboardingFixture {
  const fixture = allFixtures().find((entry) => entry.summary.name === name);
  if (!fixture) throw new Error(`Onboarding fixture not found: ${name}`);
  return {
    summary: {
      ...fixture.summary,
      workflow: [...fixture.summary.workflow],
    },
    bundle: JSON.parse(JSON.stringify(fixture.bundle)) as TodosLocalBridgeBundle,
  };
}

export function getOnboardingFixtureBundle(name = "agent-project-demo"): TodosLocalBridgeBundle {
  return getOnboardingFixture(name).bundle;
}

export function writeOnboardingFixtureFiles(directory: string): WriteOnboardingFixtureResult {
  mkdirSync(directory, { recursive: true });
  const files: string[] = [];
  for (const fixture of allFixtures()) {
    const path = join(directory, `${fixture.summary.name}.bridge.json`);
    writeFileSync(path, `${JSON.stringify(fixture.bundle, null, 2)}\n`, "utf-8");
    files.push(path);
  }
  return { directory, written: files.length, files };
}

export function importOnboardingFixture(
  options: ImportOnboardingFixtureOptions = {},
): LocalBridgeImportResult {
  const bundle = getOnboardingFixtureBundle(options.name ?? "agent-project-demo");
  return importLocalBridgeBundle(bundle, {
    dryRun: options.dryRun,
    conflictStrategy: options.conflictStrategy,
  });
}
