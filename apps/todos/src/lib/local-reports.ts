import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { isLockExpired } from "../db/database.js";
import { listPlans } from "../db/plans.js";
import { getBlockingDeps, listTasks } from "../db/tasks.js";
import type { Task } from "../types/index.js";

export const LOCAL_REPORT_SCHEMA_VERSION = 1;

export const LOCAL_REPORT_TYPES = [
  "ready",
  "blocked",
  "overdue",
  "standup",
  "sprint",
  "progress",
  "run_outcomes",
  "verification_evidence",
  "agent_summary",
] as const;

export type LocalReportType = typeof LOCAL_REPORT_TYPES[number];

export interface LocalReportOptions {
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  since?: string;
  until?: string;
  generated_at?: string;
  now?: string;
  limit?: number;
}

export interface LocalReportTaskSummary {
  id: string;
  short_id: string | null;
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  project_id: string | null;
  plan_id: string | null;
  assigned_to: string | null;
  due_at: string | null;
  updated_at: string;
}

export interface LocalReportBlockedTask extends LocalReportTaskSummary {
  blocked_by: LocalReportTaskSummary[];
}

export interface LocalReportTaskView<T extends LocalReportTaskSummary = LocalReportTaskSummary> {
  type: "ready" | "blocked" | "overdue";
  total: number;
  items: T[];
}

export interface LocalReportPlanSummary {
  id: string;
  name: string;
  status: string;
  project_id: string | null;
  agent_id: string | null;
  counts: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    cancelled: number;
    blocked: number;
    overdue: number;
  };
  progress_percent: number;
}

export interface LocalReportRunSummary {
  id: string;
  task_id: string;
  task_title: string;
  agent_id: string | null;
  status: string;
  summary: string | null;
  started_at: string;
  completed_at: string | null;
  command_outcomes: {
    passed: number;
    failed: number;
    unknown: number;
  };
  artifacts: number;
}

export interface LocalReportVerificationSummary {
  id: string;
  task_id: string;
  task_title: string;
  agent_id: string | null;
  status: string;
  command: string;
  output_summary: string | null;
  run_at: string;
}

export interface LocalReportAgentSummary {
  agent_id: string;
  task_counts: {
    total: number;
    pending: number;
    in_progress: number;
    completed: number;
    failed: number;
    cancelled: number;
    blocked: number;
    overdue: number;
  };
  run_outcomes: {
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  verification_outcomes: {
    passed: number;
    failed: number;
    unknown: number;
  };
}

export interface LocalReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  scope: {
    project_id: string | null;
    plan_id: string | null;
    agent_id: string | null;
    since: string | null;
    until: string | null;
  };
  report_types: LocalReportType[];
  views: {
    ready: LocalReportTaskView;
    blocked: LocalReportTaskView<LocalReportBlockedTask>;
    overdue: LocalReportTaskView;
  };
  plans: LocalReportPlanSummary[];
  runs: {
    outcomes: {
      running: number;
      completed: number;
      failed: number;
      cancelled: number;
    };
    recent: LocalReportRunSummary[];
  };
  verification: {
    outcomes: {
      passed: number;
      failed: number;
      unknown: number;
    };
    recent: LocalReportVerificationSummary[];
  };
  agents: LocalReportAgentSummary[];
  exports: {
    json_contract: "local_report";
    markdown_supported: true;
  };
}

interface RunRow {
  id: string;
  task_id: string;
  task_title: string;
  project_id: string | null;
  plan_id: string | null;
  task_agent_id: string | null;
  assigned_to: string | null;
  agent_id: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  summary: string | null;
  started_at: string;
  completed_at: string | null;
  passed_commands: number;
  failed_commands: number;
  unknown_commands: number;
  artifacts: number;
}

interface VerificationRow {
  id: string;
  task_id: string;
  task_title: string;
  project_id: string | null;
  plan_id: string | null;
  task_agent_id: string | null;
  assigned_to: string | null;
  agent_id: string | null;
  status: "passed" | "failed" | "unknown";
  command: string;
  output_summary: string | null;
  run_at: string;
}

function limitValue(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 20;
  return Math.max(1, Math.min(500, Math.trunc(value)));
}

function isTerminal(task: Task): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}

function sameAgent(task: Task, agentId?: string): boolean {
  if (!agentId) return true;
  return task.assigned_to === agentId || task.agent_id === agentId;
}

function withinTaskWindow(task: Task, options: LocalReportOptions): boolean {
  const time = Date.parse(task.updated_at);
  if (!Number.isFinite(time)) return true;
  if (options.since && time < Date.parse(options.since)) return false;
  if (options.until && time > Date.parse(options.until)) return false;
  return true;
}

function scopedTasks(options: LocalReportOptions, db: Database): Task[] {
  return listTasks({
    project_id: options.project_id,
    plan_id: options.plan_id,
    include_archived: false,
  }, db).filter((task) => sameAgent(task, options.agent_id) && withinTaskWindow(task, options));
}

function summarizeTask(task: Task): LocalReportTaskSummary {
  return {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    plan_id: task.plan_id,
    assigned_to: task.assigned_to,
    due_at: task.due_at,
    updated_at: task.updated_at,
  };
}

function overdueTasks(tasks: Task[], nowIso: string): Task[] {
  const now = Date.parse(nowIso);
  return tasks.filter((task) => {
    if (isTerminal(task) || !task.due_at) return false;
    const due = Date.parse(task.due_at);
    return Number.isFinite(due) && due < now;
  });
}

function isReady(task: Task, db: Database): boolean {
  if (task.status !== "pending") return false;
  if (task.locked_by && !isLockExpired(task.locked_at)) return false;
  return getBlockingDeps(task.id, db).length === 0;
}

function pushTaskCounts(summary: LocalReportAgentSummary, task: Task, blockedIds: Set<string>, overdueIds: Set<string>): void {
  summary.task_counts.total += 1;
  summary.task_counts[task.status] += 1;
  if (blockedIds.has(task.id)) summary.task_counts.blocked += 1;
  if (overdueIds.has(task.id)) summary.task_counts.overdue += 1;
}

function initialAgentSummary(agentId: string): LocalReportAgentSummary {
  return {
    agent_id: agentId,
    task_counts: {
      total: 0,
      pending: 0,
      in_progress: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      blocked: 0,
      overdue: 0,
    },
    run_outcomes: {
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    },
    verification_outcomes: {
      passed: 0,
      failed: 0,
      unknown: 0,
    },
  };
}

function addScopeClauses(where: string[], params: SQLQueryBindings[], options: LocalReportOptions, timeColumn: string): void {
  if (options.project_id) {
    where.push("t.project_id = ?");
    params.push(options.project_id);
  }
  if (options.plan_id) {
    where.push("t.plan_id = ?");
    params.push(options.plan_id);
  }
  if (options.agent_id) {
    where.push("(r.agent_id = ? OR t.agent_id = ? OR t.assigned_to = ?)");
    params.push(options.agent_id, options.agent_id, options.agent_id);
  }
  if (options.since) {
    where.push(`${timeColumn} >= ?`);
    params.push(options.since);
  }
  if (options.until) {
    where.push(`${timeColumn} <= ?`);
    params.push(options.until);
  }
}

function loadRuns(options: LocalReportOptions, db: Database): RunRow[] {
  const where = ["t.archived_at IS NULL"];
  const params: SQLQueryBindings[] = [];
  addScopeClauses(where, params, options, "r.started_at");
  return db.query(`
    SELECT
      r.id,
      r.task_id,
      t.title AS task_title,
      t.project_id,
      t.plan_id,
      t.agent_id AS task_agent_id,
      t.assigned_to,
      r.agent_id,
      r.status,
      r.summary,
      r.started_at,
      r.completed_at,
      SUM(CASE WHEN c.status = 'passed' THEN 1 ELSE 0 END) AS passed_commands,
      SUM(CASE WHEN c.status = 'failed' THEN 1 ELSE 0 END) AS failed_commands,
      SUM(CASE WHEN c.status = 'unknown' THEN 1 ELSE 0 END) AS unknown_commands,
      COUNT(DISTINCT a.id) AS artifacts
    FROM task_runs r
    JOIN tasks t ON t.id = r.task_id
    LEFT JOIN task_run_commands c ON c.run_id = r.id
    LEFT JOIN task_run_artifacts a ON a.run_id = r.id
    WHERE ${where.join(" AND ")}
    GROUP BY r.id
    ORDER BY r.started_at DESC, r.created_at DESC
  `).all(...params) as RunRow[];
}

function loadVerifications(options: LocalReportOptions, db: Database): VerificationRow[] {
  const where = ["t.archived_at IS NULL"];
  const params: SQLQueryBindings[] = [];
  if (options.project_id) {
    where.push("t.project_id = ?");
    params.push(options.project_id);
  }
  if (options.plan_id) {
    where.push("t.plan_id = ?");
    params.push(options.plan_id);
  }
  if (options.agent_id) {
    where.push("(v.agent_id = ? OR t.agent_id = ? OR t.assigned_to = ?)");
    params.push(options.agent_id, options.agent_id, options.agent_id);
  }
  if (options.since) {
    where.push("v.run_at >= ?");
    params.push(options.since);
  }
  if (options.until) {
    where.push("v.run_at <= ?");
    params.push(options.until);
  }
  return db.query(`
    SELECT
      v.id,
      v.task_id,
      t.title AS task_title,
      t.project_id,
      t.plan_id,
      t.agent_id AS task_agent_id,
      t.assigned_to,
      v.agent_id,
      v.status,
      v.command,
      v.output_summary,
      v.run_at
    FROM task_verifications v
    JOIN tasks t ON t.id = v.task_id
    WHERE ${where.join(" AND ")}
    ORDER BY v.run_at DESC, v.created_at DESC
  `).all(...params) as VerificationRow[];
}

function agentKey(value: string | null | undefined): string {
  return value || "unassigned";
}

export function listLocalReportTypes(): LocalReportType[] {
  return [...LOCAL_REPORT_TYPES];
}

export function createLocalReport(options: LocalReportOptions = {}, db?: Database): LocalReport {
  const d = db || getDatabase();
  const limit = limitValue(options.limit);
  const generatedAt = options.generated_at ?? new Date().toISOString();
  const nowIso = options.now ?? generatedAt;
  const tasks = scopedTasks(options, d);
  const overdue = overdueTasks(tasks, nowIso);
  const overdueIds = new Set(overdue.map((task) => task.id));
  const blocked = tasks
    .filter((task) => task.status === "pending")
    .map((task) => ({ task, blockers: getBlockingDeps(task.id, d) }))
    .filter((item) => item.blockers.length > 0);
  const blockedIds = new Set(blocked.map((item) => item.task.id));
  const ready = tasks.filter((task) => isReady(task, d));
  const runs = loadRuns(options, d);
  const verifications = loadVerifications(options, d);

  const planSummaries = listPlans(options.project_id, d)
    .filter((plan) => !options.plan_id || plan.id === options.plan_id)
    .map((plan): LocalReportPlanSummary => {
      const planTasks = tasks.filter((task) => task.plan_id === plan.id);
      const completed = planTasks.filter((task) => task.status === "completed").length;
      const total = planTasks.length;
      return {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        project_id: plan.project_id,
        agent_id: plan.agent_id,
        counts: {
          total,
          pending: planTasks.filter((task) => task.status === "pending").length,
          in_progress: planTasks.filter((task) => task.status === "in_progress").length,
          completed,
          failed: planTasks.filter((task) => task.status === "failed").length,
          cancelled: planTasks.filter((task) => task.status === "cancelled").length,
          blocked: planTasks.filter((task) => blockedIds.has(task.id)).length,
          overdue: planTasks.filter((task) => overdueIds.has(task.id)).length,
        },
        progress_percent: total === 0 ? 0 : Math.round((completed / total) * 100),
      };
    })
    .filter((plan) => plan.counts.total > 0 || options.plan_id === plan.id);

  const runOutcomes = { running: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const run of runs) runOutcomes[run.status] += 1;
  const verificationOutcomes = { passed: 0, failed: 0, unknown: 0 };
  for (const verification of verifications) verificationOutcomes[verification.status] += 1;

  const agents = new Map<string, LocalReportAgentSummary>();
  function getAgent(id: string): LocalReportAgentSummary {
    if (!agents.has(id)) agents.set(id, initialAgentSummary(id));
    return agents.get(id)!;
  }
  for (const task of tasks) {
    const summary = getAgent(agentKey(task.assigned_to || task.agent_id));
    pushTaskCounts(summary, task, blockedIds, overdueIds);
  }
  for (const run of runs) {
    const summary = getAgent(agentKey(run.agent_id || run.assigned_to || run.task_agent_id));
    summary.run_outcomes[run.status] += 1;
  }
  for (const verification of verifications) {
    const summary = getAgent(agentKey(verification.agent_id || verification.assigned_to || verification.task_agent_id));
    summary.verification_outcomes[verification.status] += 1;
  }

  return {
    schema_version: LOCAL_REPORT_SCHEMA_VERSION,
    local_only: true,
    no_network: true,
    generated_at: generatedAt,
    scope: {
      project_id: options.project_id ?? null,
      plan_id: options.plan_id ?? null,
      agent_id: options.agent_id ?? null,
      since: options.since ?? null,
      until: options.until ?? null,
    },
    report_types: listLocalReportTypes(),
    views: {
      ready: {
        type: "ready",
        total: ready.length,
        items: ready.slice(0, limit).map(summarizeTask),
      },
      blocked: {
        type: "blocked",
        total: blocked.length,
        items: blocked.slice(0, limit).map(({ task, blockers }) => ({
          ...summarizeTask(task),
          blocked_by: blockers.map(summarizeTask),
        })),
      },
      overdue: {
        type: "overdue",
        total: overdue.length,
        items: overdue.slice(0, limit).map(summarizeTask),
      },
    },
    plans: planSummaries,
    runs: {
      outcomes: runOutcomes,
      recent: runs.slice(0, limit).map((run) => ({
        id: run.id,
        task_id: run.task_id,
        task_title: run.task_title,
        agent_id: run.agent_id,
        status: run.status,
        summary: run.summary,
        started_at: run.started_at,
        completed_at: run.completed_at,
        command_outcomes: {
          passed: Number(run.passed_commands || 0),
          failed: Number(run.failed_commands || 0),
          unknown: Number(run.unknown_commands || 0),
        },
        artifacts: Number(run.artifacts || 0),
      })),
    },
    verification: {
      outcomes: verificationOutcomes,
      recent: verifications.slice(0, limit).map((verification) => ({
        id: verification.id,
        task_id: verification.task_id,
        task_title: verification.task_title,
        agent_id: verification.agent_id,
        status: verification.status,
        command: verification.command,
        output_summary: verification.output_summary,
        run_at: verification.run_at,
      })),
    },
    agents: [...agents.values()].sort((left, right) => left.agent_id.localeCompare(right.agent_id)),
    exports: {
      json_contract: "local_report",
      markdown_supported: true,
    },
  };
}

function taskLine(task: LocalReportTaskSummary): string {
  const due = task.due_at ? ` due ${task.due_at.slice(0, 10)}` : "";
  const assignee = task.assigned_to ? ` @${task.assigned_to}` : "";
  return `- ${task.short_id || task.id.slice(0, 8)} ${task.title} [${task.status}/${task.priority}]${assignee}${due}`;
}

function outcomeLine(values: Record<string, number>): string {
  return Object.entries(values).map(([key, value]) => `${key}: ${value}`).join(", ");
}

export function renderLocalReportMarkdown(report: LocalReport): string {
  const lines: string[] = [
    "# Local Agent Report",
    "",
    `Generated: ${report.generated_at}`,
    `Scope: project ${report.scope.project_id ?? "all"}; plan ${report.scope.plan_id ?? "all"}; agent ${report.scope.agent_id ?? "all"}`,
    "",
    "## Task Views",
    "",
    `Ready (${report.views.ready.total})`,
    ...(report.views.ready.items.length ? report.views.ready.items.map(taskLine) : ["- none"]),
    "",
    `Blocked (${report.views.blocked.total})`,
    ...(report.views.blocked.items.length
      ? report.views.blocked.items.map((task) => `${taskLine(task)}; blocked by ${task.blocked_by.map((item) => item.short_id || item.id.slice(0, 8)).join(", ")}`)
      : ["- none"]),
    "",
    `Overdue (${report.views.overdue.total})`,
    ...(report.views.overdue.items.length ? report.views.overdue.items.map(taskLine) : ["- none"]),
    "",
    "## Plans",
  ];

  if (report.plans.length === 0) lines.push("- none");
  for (const plan of report.plans) {
    lines.push(`- ${plan.name}: ${plan.progress_percent}% complete, ${plan.counts.blocked} blocked, ${plan.counts.overdue} overdue`);
  }

  lines.push("", "## Runs", outcomeLine(report.runs.outcomes));
  for (const run of report.runs.recent) {
    lines.push(`- ${run.id.slice(0, 8)} ${run.status} ${run.task_title}${run.summary ? `: ${run.summary}` : ""}`);
  }

  lines.push("", "## Verification", outcomeLine(report.verification.outcomes));
  for (const verification of report.verification.recent) {
    lines.push(`- ${verification.status} ${verification.task_title}: ${verification.output_summary || verification.command}`);
  }

  lines.push("", "## Agents");
  if (report.agents.length === 0) lines.push("- none");
  for (const agent of report.agents) {
    lines.push(`- ${agent.agent_id}: ${agent.task_counts.total} tasks, ${agent.task_counts.blocked} blocked, ${agent.task_counts.overdue} overdue, runs ${outcomeLine(agent.run_outcomes)}, verification ${outcomeLine(agent.verification_outcomes)}`);
  }

  return `${lines.join("\n")}\n`;
}
