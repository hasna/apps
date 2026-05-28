/**
 * One-command local agent workflow demo — agents, projects, tasks, and runs.
 * Fully local; uses in-memory or temp SQLite. No hosted dependencies.
 */

import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase, now } from "../db/database.js";
import { registerAgent, isAgentConflict } from "../db/agents.js";
import { createProject } from "../db/projects.js";
import { createTaskList } from "../db/task-lists.js";
import { createTask, claimNextTask, completeTask, addDependency, listTasks } from "../db/tasks.js";
import { logProgress } from "../db/comments.js";
import { getStatus } from "../db/task-status.js";
import {
  enqueueAgentRun,
  claimNextAgentRun,
  completeAgentRun,
  resetAgentAdapterCache,
} from "./agent-run-dispatcher.js";
import {
  createRunRecord,
  appendRunCommand,
  completeRunRecord,
} from "./run-records.js";

export const AGENT_WORKFLOW_DEMO_SCHEMA = "todos.agent_workflow_demo.v1";

export const DEMO_DEFAULT_AGENT = "demo-agent";
export const DEMO_DEFAULT_PROJECT = "Agent Workflow Demo";
export const DEMO_PROJECT_PATH = "/tmp/todos-agent-workflow-demo";

export interface DemoStep {
  step: number;
  action: string;
  detail: string;
  status: "ok" | "skipped";
}

export interface AgentWorkflowDemoResult {
  schema_version: typeof AGENT_WORKFLOW_DEMO_SCHEMA;
  ephemeral: boolean;
  db_path: string;
  agent: { id: string; name: string };
  project: { id: string; name: string; path: string; task_prefix: string | null };
  task_list: { id: string; slug: string; name: string };
  tasks: Array<{ id: string; short_id: string | null; title: string; status: string }>;
  agent_run: { id: string; status: string; task_id: string | null; adapter: string };
  run_record: { id: string; status: string; objective: string | null };
  status_summary: {
    pending: number;
    in_progress: number;
    completed: number;
    total: number;
  };
  steps: DemoStep[];
  completed_at: string;
  message: string;
}

export interface RunAgentWorkflowDemoOptions {
  db?: Database;
  ephemeral?: boolean;
  persist?: boolean;
  db_path?: string;
  agent_name?: string;
  project_name?: string;
  project_path?: string;
  exported_at?: string;
}

export interface EphemeralDbHandle {
  db_path: string;
  restore: () => void;
}

function pushStep(steps: DemoStep[], action: string, detail: string, status: DemoStep["status"] = "ok"): void {
  steps.push({ step: steps.length + 1, action, detail, status });
}

export function setupEphemeralDemoDb(options: { persist?: boolean; db_path?: string } = {}): EphemeralDbHandle {
  const prevPath = process.env["TODOS_DB_PATH"];
  const prevHasnaPath = process.env["HASNA_TODOS_DB_PATH"];

  let db_path: string;
  if (options.db_path) {
    db_path = options.db_path;
  } else if (options.persist) {
    db_path = join(mkdtempSync(join(tmpdir(), "todos-demo-")), "todos.db");
  } else {
    db_path = ":memory:";
  }

  closeDatabase();
  resetDatabase();
  resetAgentAdapterCache();
  process.env["TODOS_DB_PATH"] = db_path;
  delete process.env["HASNA_TODOS_DB_PATH"];
  getDatabase();

  return {
    db_path,
    restore: () => {
      closeDatabase();
      resetDatabase();
      resetAgentAdapterCache();
      if (prevPath !== undefined) process.env["TODOS_DB_PATH"] = prevPath;
      else delete process.env["TODOS_DB_PATH"];
      if (prevHasnaPath !== undefined) process.env["HASNA_TODOS_DB_PATH"] = prevHasnaPath;
      else delete process.env["HASNA_TODOS_DB_PATH"];
    },
  };
}

export function runAgentWorkflowDemo(options: RunAgentWorkflowDemoOptions = {}): AgentWorkflowDemoResult {
  const ephemeral = options.ephemeral !== false && !options.db;
  let dbHandle: EphemeralDbHandle | null = null;
  let db_path = options.db_path ?? ":memory:";

  if (!options.db && ephemeral) {
    dbHandle = setupEphemeralDemoDb({ persist: options.persist, db_path: options.db_path });
    db_path = dbHandle.db_path;
  }

  const d = options.db ?? getDatabase();
  const steps: DemoStep[] = [];
  const agentName = options.agent_name ?? DEMO_DEFAULT_AGENT;
  const projectName = options.project_name ?? DEMO_DEFAULT_PROJECT;
  const projectPath = options.project_path ?? DEMO_PROJECT_PATH;
  const exportedAt = options.exported_at ?? now();

  try {
    const registered = registerAgent({ name: agentName, description: "Demo quickstart agent", force: true }, d);
    if (isAgentConflict(registered)) {
      throw new Error(`Failed to register demo agent: ${registered.message}`);
    }
    const agent = registered;
    pushStep(steps, "register_agent", `Registered agent '${agent.name}' (${agent.id.slice(0, 8)})`);

    const project = createProject({ name: projectName, path: projectPath, description: "Local demo project" }, d);
    pushStep(steps, "create_project", `Created project '${project.name}' prefix=${project.task_prefix ?? "auto"}`);

    const taskList = createTaskList({
      project_id: project.id,
      name: "Demo Backlog",
      slug: "demo-backlog",
    }, d);
    pushStep(steps, "create_task_list", `Created task list '${taskList.slug}'`);

    const taskDefs = [
      { title: "Register agent and bootstrap project", priority: "high" as const },
      { title: "Claim and start next task", priority: "medium" as const },
      { title: "Complete work with run evidence", priority: "medium" as const },
    ];

    const createdTasks = taskDefs.map((def) => createTask({
      title: def.title,
      project_id: project.id,
      task_list_id: taskList.id,
      priority: def.priority,
      tags: ["demo", "quickstart"],
    }, d));

    addDependency(createdTasks[1]!.id, createdTasks[0]!.id, d);
    addDependency(createdTasks[2]!.id, createdTasks[1]!.id, d);
    pushStep(steps, "create_tasks", `Created ${createdTasks.length} linked demo tasks`);

    const first = claimNextTask(agent.id, { project_id: project.id }, d);
    if (!first) throw new Error("Expected claimable demo task");
    pushStep(steps, "claim_next_task", `Claimed ${first.short_id ?? first.id.slice(0, 8)} — ${first.title}`);

    logProgress(first.id, "Reviewed local setup and project registration", 50, agent.id, d);
    pushStep(steps, "log_progress", "Logged 50% progress on first task");

    completeTask(first.id, agent.id, d, { notes: "Demo: project and agent ready" });
    pushStep(steps, "complete_task", `Completed ${first.short_id ?? first.id.slice(0, 8)}`);

    const second = claimNextTask(agent.id, { project_id: project.id }, d);
    if (!second) throw new Error("Expected second claimable demo task");
    pushStep(steps, "claim_next_task", `Claimed ${second.short_id ?? second.id.slice(0, 8)} — ${second.title}`);

    completeTask(second.id, agent.id, d, { notes: "Demo: claim/start/complete cycle finished" });
    pushStep(steps, "complete_task", `Completed ${second.short_id ?? second.id.slice(0, 8)}`);

    const third = createdTasks[2]!;
    const demoAdapter = "claude";
    const queuedRun = enqueueAgentRun({
      task_id: third.id,
      adapter: demoAdapter,
      agent_id: agent.id,
      evidence: { demo: true, source: "agent_workflow_demo" },
    }, d);
    pushStep(steps, "enqueue_agent_run", `Queued agent run on task ${third.short_id ?? third.id.slice(0, 8)}`);

    const claimedRun = claimNextAgentRun(agent.id, { adapter: demoAdapter }, d);
    if (!claimedRun) throw new Error("Expected queued agent run");
    pushStep(steps, "claim_next_agent_run", `Claimed run ${claimedRun.id.slice(0, 8)} (${claimedRun.status})`);

    const completedRun = completeAgentRun(claimedRun.id, { demo_completed: true, commit_hash: "demo0000" }, d);
    pushStep(steps, "complete_agent_run", `Completed run ${completedRun.id.slice(0, 8)}`);

    const runRecord = createRunRecord({
      agent_run_id: completedRun.id,
      agent_id: agent.id,
      objective: "Demonstrate local run record with evidence",
      claimed_task_ids: [third.id],
      metadata: { demo: true },
    }, d);
    pushStep(steps, "create_run_record", `Created run record ${runRecord.id.slice(0, 8)}`);

    appendRunCommand(runRecord.id, "todos demo run", {
      exit_code: 0,
      stdout: "Agent workflow demo completed successfully",
      duration_ms: 42,
    }, d);
    pushStep(steps, "append_run_command", "Recorded demo command output (redacted-safe)");

    const finishedRecord = completeRunRecord(runRecord.id, "Demo run finished with evidence", d);
    pushStep(steps, "complete_run_record", `Run record status=${finishedRecord.status}`);

    completeTask(third.id, agent.id, d, { notes: "Demo: finished via agent run + run record" });
    pushStep(steps, "complete_task", `Completed ${third.short_id ?? third.id.slice(0, 8)}`);

    const status = getStatus({ project_id: project.id }, agent.id, undefined, d);
    const tasks = listTasks({ project_id: project.id }, d).map((t) => ({
      id: t.id,
      short_id: t.short_id,
      title: t.title,
      status: t.status,
    }));

    return {
      schema_version: AGENT_WORKFLOW_DEMO_SCHEMA,
      ephemeral,
      db_path,
      agent: { id: agent.id, name: agent.name },
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        task_prefix: project.task_prefix ?? null,
      },
      task_list: { id: taskList.id, slug: taskList.slug, name: taskList.name },
      tasks,
      agent_run: {
        id: completedRun.id,
        status: completedRun.status,
        task_id: completedRun.task_id,
        adapter: completedRun.adapter,
      },
      run_record: {
        id: finishedRecord.id,
        status: finishedRecord.status,
        objective: finishedRecord.objective,
      },
      status_summary: {
        pending: status.pending,
        in_progress: status.in_progress,
        completed: status.completed,
        total: status.total,
      },
      steps,
      completed_at: exportedAt,
      message: `Demo complete: ${status.completed}/${status.total} tasks done, 1 agent run, 1 run record`,
    };
  } finally {
    if (dbHandle) dbHandle.restore();
  }
}

export function sanitizeDemoVolatileIds(text: string): string {
  return text.replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\b[0-9a-f]{8}\b/gi, "<id>");
}

export function normalizeAgentWorkflowDemoResult(
  result: AgentWorkflowDemoResult,
  exportedAt = "2026-01-01T00:00:00.000Z",
): Record<string, unknown> {
  const idMap = new Map<string, string>();
  let counter = 0;
  const alias = (id: string | null | undefined): string | null => {
    if (!id) return null;
    if (!idMap.has(id)) idMap.set(id, `<id-${++counter}>`);
    return idMap.get(id)!;
  };

  const agentId = alias(result.agent.id);
  const projectId = alias(result.project.id);
  const taskListId = alias(result.task_list.id);
  const agentRunId = alias(result.agent_run.id);
  const agentRunTaskId = alias(result.agent_run.task_id);
  const runRecordId = alias(result.run_record.id);

  const tasks = [...result.tasks]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((t, i) => ({
      id: alias(t.id),
      short_id: t.short_id ? `DEMO-${String(i + 1).padStart(5, "0")}` : null,
      title: t.title,
      status: t.status,
    }));

  return {
    schema_version: result.schema_version,
    ephemeral: result.ephemeral,
    db_path: result.ephemeral ? ":memory:" : result.db_path,
    agent: { id: agentId, name: result.agent.name },
    project: {
      id: projectId,
      name: result.project.name,
      path: result.project.path,
      task_prefix: result.project.task_prefix,
    },
    task_list: {
      id: taskListId,
      slug: result.task_list.slug,
      name: result.task_list.name,
    },
    tasks,
    agent_run: {
      id: agentRunId,
      status: result.agent_run.status,
      task_id: agentRunTaskId,
      adapter: result.agent_run.adapter,
    },
    run_record: {
      id: runRecordId,
      status: result.run_record.status,
      objective: result.run_record.objective,
    },
    status_summary: result.status_summary,
    steps: result.steps.map((s) => ({
      ...s,
      detail: sanitizeDemoVolatileIds(s.detail),
    })),
    completed_at: exportedAt,
    message: result.message,
  };
}

export function formatAgentWorkflowDemoReport(
  result: AgentWorkflowDemoResult,
  exportedAt = "2026-01-01T00:00:00.000Z",
  options?: { deterministic?: boolean },
): string {
  if (options?.deterministic) {
    const normalized = normalizeAgentWorkflowDemoResult(result, exportedAt) as {
      agent: { id: string | null; name: string };
      project: { name: string; path: string; task_prefix: string | null };
      task_list: { slug: string };
      tasks: Array<{ id: string | null; short_id: string | null; title: string; status: string }>;
      agent_run: { id: string | null; status: string; adapter: string };
      run_record: { id: string | null; status: string; objective: string | null };
      status_summary: AgentWorkflowDemoResult["status_summary"];
      steps: DemoStep[];
      message: string;
      ephemeral: boolean;
      db_path: string;
    };

    const lines = [
      "=== Agent Workflow Demo (local-only) ===",
      normalized.message,
      `Completed: ${exportedAt}`,
      `Database: ${normalized.ephemeral ? ":memory: (ephemeral)" : normalized.db_path}`,
      "",
      `Agent: ${normalized.agent.name} (${normalized.agent.id})`,
      `Project: ${normalized.project.name} [${normalized.project.task_prefix ?? "—"}] @ ${normalized.project.path}`,
      `Task list: ${normalized.task_list.slug}`,
      "",
      "Tasks:",
      ...normalized.tasks.map((t) => `  ${t.short_id ?? t.id}  ${t.status.padEnd(11)}  ${t.title}`),
      "",
      `Agent run: ${normalized.agent_run.id}  ${normalized.agent_run.status}  adapter=${normalized.agent_run.adapter}`,
      `Run record: ${normalized.run_record.id}  ${normalized.run_record.status}  ${normalized.run_record.objective ?? ""}`,
      "",
      `Status: ${normalized.status_summary.completed}/${normalized.status_summary.total} completed, ${normalized.status_summary.pending} pending, ${normalized.status_summary.in_progress} in progress`,
      "",
      "Steps:",
      ...normalized.steps.map((s) => `  ${String(s.step).padStart(2, " ")}. [${s.status}] ${s.action}: ${s.detail}`),
      "",
      "Try next:",
      "  todos claim <agent>     # pick + lock + start best pending task",
      "  todos status            # project health snapshot",
      "  todos runs queue --task <id> --adapter claude",
      "  todos mcp               # MCP tools for agents (TODOS_PROFILE=minimal)",
    ];
    return lines.join("\n");
  }

  const lines = [
    "=== Agent Workflow Demo (local-only) ===",
    result.message,
    `Completed: ${exportedAt}`,
    `Database: ${result.ephemeral ? ":memory: (ephemeral)" : result.db_path}`,
    "",
    `Agent: ${result.agent.name} (${result.agent.id.slice(0, 8)})`,
    `Project: ${result.project.name} [${result.project.task_prefix ?? "—"}] @ ${result.project.path}`,
    `Task list: ${result.task_list.slug}`,
    "",
    "Tasks:",
    ...result.tasks.map((t) => `  ${t.short_id ?? t.id.slice(0, 8)}  ${t.status.padEnd(11)}  ${t.title}`),
    "",
    `Agent run: ${result.agent_run.id.slice(0, 8)}  ${result.agent_run.status}  adapter=${result.agent_run.adapter}`,
    `Run record: ${result.run_record.id.slice(0, 8)}  ${result.run_record.status}  ${result.run_record.objective ?? ""}`,
    "",
    `Status: ${result.status_summary.completed}/${result.status_summary.total} completed, ${result.status_summary.pending} pending, ${result.status_summary.in_progress} in progress`,
    "",
    "Steps:",
    ...result.steps.map((s) => `  ${String(s.step).padStart(2, " ")}. [${s.status}] ${s.action}: ${s.detail}`),
    "",
    "Try next:",
    "  todos claim <agent>     # pick + lock + start best pending task",
    "  todos status            # project health snapshot",
    "  todos runs queue --task <id> --adapter claude",
    "  todos mcp               # MCP tools for agents (TODOS_PROFILE=minimal)",
  ];
  return lines.join("\n");
}

export function getAgentWorkflowDemoDocs(): string {
  return `# Agent workflow demo (local-only)

One command walks through agents, projects, tasks, agent runs, and run records using an ephemeral SQLite database.

## CLI

\`\`\`bash
todos demo run              # in-memory demo (default)
todos demo run --json       # JSON result
todos demo run --persist    # temp file DB (still local)
todos demo docs             # this guide
\`\`\`

## MCP

- \`run_agent_workflow_demo\` — execute the scripted demo
- \`get_agent_workflow_demo_docs\` — quickstart documentation

## What the demo does

1. Register a demo agent
2. Create a demo project and task list
3. Create three linked tasks (dependencies enforce order)
4. Claim, log progress, and complete tasks
5. Enqueue and complete a local agent run
6. Create a run record with command evidence
7. Print a health summary

No network calls or hosted services are required.

Schema: \`${AGENT_WORKFLOW_DEMO_SCHEMA}\`
`;
}
