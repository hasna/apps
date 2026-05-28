import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";
import { createTask } from "./tasks.js";
import { redactEvidenceText, redactValue } from "../lib/redaction.js";

export type RetrospectiveScope = "project" | "plan";
export type RetrospectiveExportFormat = "json" | "markdown";

export interface RetrospectiveRecord {
  id: string;
  title: string;
  scope: RetrospectiveScope;
  project_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  report: RetrospectiveReport;
  created_at: string;
  updated_at: string;
}

export interface CreateRetrospectiveInput {
  title?: string;
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  create_followups?: boolean;
}

export interface ListRetrospectivesOptions {
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  limit?: number;
}

export interface RetrospectiveReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  scope: RetrospectiveScope;
  scope_id: string;
  title: string;
  summary: {
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    completed_plans: number;
    missed_estimates: number;
    recurring_blockers: number;
    failed_verifications: number;
    follow_up_tasks: number;
  };
  completed_plans: Array<{ id: string; name: string; completed_tasks: number; total_tasks: number }>;
  missed_estimates: Array<{ id: string; short_id: string | null; title: string; estimated_minutes: number; actual_minutes: number; over_by_minutes: number }>;
  recurring_blockers: Array<{ blocker_task_id: string; short_id: string | null; title: string; status: string; blocks_count: number; blocked_task_ids: string[] }>;
  failed_verifications: Array<{ id: string; task_id: string; task_title: string; command: string; run_at: string }>;
  lessons: string[];
  follow_up_tasks: Array<{ title: string; description: string; priority: "low" | "medium" | "high" | "critical"; reason: string; created_task_id: string | null }>;
}

export interface RetrospectiveExport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  filters: Omit<ListRetrospectivesOptions, "limit">;
  count: number;
  retrospectives: RetrospectiveRecord[];
}

interface RetrospectiveRow {
  id: string;
  title: string;
  scope: string;
  project_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  report_json: string;
  created_at: string;
  updated_at: string;
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return 50;
  return Math.min(Math.floor(limit), 500);
}

function resolveKnownId(table: "projects" | "plans", value: string | undefined, db: Database): string | null {
  if (!value) return null;
  return resolvePartialId(db, table, value) || value;
}

function rowToRetrospective(row: RetrospectiveRow): RetrospectiveRecord {
  const report = JSON.parse(row.report_json) as RetrospectiveReport;
  return {
    id: row.id,
    title: redactEvidenceText(row.title),
    scope: row.scope as RetrospectiveScope,
    project_id: row.project_id,
    plan_id: row.plan_id,
    agent_id: row.agent_id,
    report: redactValue(report) as RetrospectiveReport,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function scopeFromInput(input: CreateRetrospectiveInput, db: Database): { scope: RetrospectiveScope; scopeId: string; projectId: string | null; planId: string | null; where: string } {
  const planId = resolveKnownId("plans", input.plan_id, db);
  const projectId = resolveKnownId("projects", input.project_id, db);
  if (planId) return { scope: "plan", scopeId: planId, projectId, planId, where: "plan_id = ?" };
  if (projectId) return { scope: "project", scopeId: projectId, projectId, planId: null, where: "project_id = ?" };
  throw new Error("Retrospective requires --plan or --project");
}

function buildLessons(report: Omit<RetrospectiveReport, "lessons" | "follow_up_tasks">): string[] {
  const lessons: string[] = [];
  if (report.summary.missed_estimates > 0) {
    lessons.push(`${report.summary.missed_estimates} completed task(s) exceeded their estimate; update future plans with actual runtime evidence.`);
  }
  if (report.summary.recurring_blockers > 0) {
    lessons.push(`${report.summary.recurring_blockers} blocker(s) affected multiple tasks; resolve shared prerequisites before assigning downstream work.`);
  }
  if (report.summary.failed_verifications > 0) {
    lessons.push(`${report.summary.failed_verifications} failed verification record(s) should become explicit acceptance criteria or preflight checks.`);
  }
  if (report.summary.failed_tasks > 0) {
    lessons.push(`${report.summary.failed_tasks} task(s) ended failed; keep failure notes linked to retry or follow-up work.`);
  }
  if (lessons.length === 0) lessons.push("No missed estimates, repeated blockers, or failed verification records were found in local evidence.");
  return lessons;
}

function buildFollowUps(report: Omit<RetrospectiveReport, "lessons" | "follow_up_tasks">): RetrospectiveReport["follow_up_tasks"] {
  const followUps: RetrospectiveReport["follow_up_tasks"] = [];
  if (report.summary.missed_estimates > 0) {
    followUps.push({
      title: `Review estimates for ${report.title}`,
      description: "Compare estimated minutes with actual minutes and update future planning defaults.",
      priority: "medium",
      reason: "missed_estimates",
      created_task_id: null,
    });
  }
  if (report.summary.recurring_blockers > 0) {
    followUps.push({
      title: `Reduce recurring blockers for ${report.title}`,
      description: "Break down shared prerequisites and unblock downstream tasks before the next plan starts.",
      priority: "high",
      reason: "recurring_blockers",
      created_task_id: null,
    });
  }
  if (report.summary.failed_verifications > 0) {
    followUps.push({
      title: `Convert failed checks into preflight criteria for ${report.title}`,
      description: "Turn failed verification commands into explicit local acceptance checks.",
      priority: "high",
      reason: "failed_verifications",
      created_task_id: null,
    });
  }
  return followUps;
}

function buildReport(input: CreateRetrospectiveInput, db: Database): RetrospectiveReport {
  const scope = scopeFromInput(input, db);
  const generatedAt = now();
  const title = input.title?.trim() || `${scope.scope === "plan" ? "Plan" : "Project"} retrospective ${scope.scopeId.slice(0, 8)}`;
  const tasks = db.query(
    `SELECT id, short_id, title, status, estimated_minutes, actual_minutes
     FROM tasks WHERE ${scope.where}`,
  ).all(scope.scopeId) as Array<{ id: string; short_id: string | null; title: string; status: string; estimated_minutes: number | null; actual_minutes: number | null }>;

  const completedPlans = scope.scope === "project"
    ? db.query(
      `SELECT p.id, p.name,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        COUNT(t.id) as total_tasks
       FROM plans p
       LEFT JOIN tasks t ON t.plan_id = p.id
       WHERE p.project_id = ? AND p.status = 'completed'
       GROUP BY p.id, p.name
       ORDER BY p.updated_at DESC`,
    ).all(scope.scopeId) as Array<{ id: string; name: string; completed_tasks: number; total_tasks: number }>
    : db.query(
      `SELECT p.id, p.name,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed_tasks,
        COUNT(t.id) as total_tasks
       FROM plans p
       LEFT JOIN tasks t ON t.plan_id = p.id
       WHERE p.id = ? AND p.status = 'completed'
       GROUP BY p.id, p.name`,
    ).all(scope.scopeId) as Array<{ id: string; name: string; completed_tasks: number; total_tasks: number }>;

  const missedEstimates = tasks
    .filter((task) => task.estimated_minutes !== null && task.actual_minutes !== null && task.actual_minutes > task.estimated_minutes)
    .map((task) => ({
      id: task.id,
      short_id: task.short_id,
      title: redactEvidenceText(task.title),
      estimated_minutes: task.estimated_minutes!,
      actual_minutes: task.actual_minutes!,
      over_by_minutes: task.actual_minutes! - task.estimated_minutes!,
    }))
    .sort((left, right) => right.over_by_minutes - left.over_by_minutes);

  const blockers = db.query(
    `SELECT dep.id as blocker_task_id, dep.short_id, dep.title, dep.status,
       COUNT(t.id) as blocks_count,
       json_group_array(t.id) as blocked_task_ids
     FROM task_dependencies td
     JOIN tasks t ON t.id = td.task_id
     JOIN tasks dep ON dep.id = td.depends_on
     WHERE t.${scope.where}
     GROUP BY dep.id, dep.short_id, dep.title, dep.status
     HAVING COUNT(t.id) > 1
     ORDER BY blocks_count DESC, dep.title ASC`,
  ).all(scope.scopeId) as Array<{ blocker_task_id: string; short_id: string | null; title: string; status: string; blocks_count: number; blocked_task_ids: string }>;

  const failedVerifications = db.query(
    `SELECT tv.id, tv.task_id, t.title as task_title, tv.command, tv.run_at
     FROM task_verifications tv
     JOIN tasks t ON t.id = tv.task_id
     WHERE t.${scope.where} AND tv.status = 'failed'
     ORDER BY tv.run_at DESC`,
  ).all(scope.scopeId) as Array<{ id: string; task_id: string; task_title: string; command: string; run_at: string }>;

  const base = {
    schema_version: 1 as const,
    local_only: true as const,
    no_network: true as const,
    generated_at: generatedAt,
    scope: scope.scope,
    scope_id: scope.scopeId,
    title: redactEvidenceText(title),
    summary: {
      total_tasks: tasks.length,
      completed_tasks: tasks.filter((task) => task.status === "completed").length,
      failed_tasks: tasks.filter((task) => task.status === "failed").length,
      completed_plans: completedPlans.length,
      missed_estimates: missedEstimates.length,
      recurring_blockers: blockers.length,
      failed_verifications: failedVerifications.length,
      follow_up_tasks: 0,
    },
    completed_plans: completedPlans.map((plan) => ({ ...plan, name: redactEvidenceText(plan.name), completed_tasks: Number(plan.completed_tasks || 0), total_tasks: Number(plan.total_tasks || 0) })),
    missed_estimates: missedEstimates,
    recurring_blockers: blockers.map((blocker) => ({
      blocker_task_id: blocker.blocker_task_id,
      short_id: blocker.short_id,
      title: redactEvidenceText(blocker.title),
      status: blocker.status,
      blocks_count: Number(blocker.blocks_count),
      blocked_task_ids: JSON.parse(blocker.blocked_task_ids || "[]") as string[],
    })),
    failed_verifications: failedVerifications.map((verification) => ({
      ...verification,
      task_title: redactEvidenceText(verification.task_title),
      command: redactEvidenceText(verification.command),
    })),
  };
  const lessons = buildLessons(base);
  const followUpTasks = buildFollowUps(base);
  base.summary.follow_up_tasks = followUpTasks.length;
  return { ...base, lessons, follow_up_tasks: followUpTasks };
}

export function createRetrospective(input: CreateRetrospectiveInput, db?: Database): RetrospectiveRecord {
  const d = db || getDatabase();
  const report = buildReport(input, d);
  const scope = scopeFromInput(input, d);
  const timestamp = now();
  if (input.create_followups) {
    for (const followUp of report.follow_up_tasks) {
      const task = createTask({
        title: followUp.title,
        description: followUp.description,
        priority: followUp.priority,
        project_id: scope.projectId || undefined,
        plan_id: scope.planId || undefined,
        tags: ["retrospective", followUp.reason],
      }, d);
      followUp.created_task_id = task.id;
    }
  }
  const id = uuid();
  d.run(
    `INSERT INTO local_retrospectives (id, title, scope, project_id, plan_id, agent_id, report_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, report.title, report.scope, scope.projectId, scope.planId, input.agent_id || null, JSON.stringify(report), timestamp, timestamp],
  );
  return getRetrospective(id, d)!;
}

export function getRetrospective(id: string, db?: Database): RetrospectiveRecord | null {
  const d = db || getDatabase();
  const resolved = resolvePartialId(d, "local_retrospectives", id) || id;
  const row = d.query("SELECT * FROM local_retrospectives WHERE id = ?").get(resolved) as RetrospectiveRow | null;
  return row ? rowToRetrospective(row) : null;
}

export function listRetrospectives(options: ListRetrospectivesOptions = {}, db?: Database): RetrospectiveRecord[] {
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  const projectId = resolveKnownId("projects", options.project_id, d);
  if (projectId) { conditions.push("project_id = ?"); params.push(projectId); }
  const planId = resolveKnownId("plans", options.plan_id, d);
  if (planId) { conditions.push("plan_id = ?"); params.push(planId); }
  if (options.agent_id) { conditions.push("agent_id = ?"); params.push(options.agent_id); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(clampLimit(options.limit));
  return (d.query(`SELECT * FROM local_retrospectives ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as RetrospectiveRow[])
    .map(rowToRetrospective);
}

export function createRetrospectiveExport(options: ListRetrospectivesOptions = {}, db?: Database): RetrospectiveExport {
  const { limit: _limit, ...filters } = options;
  const retrospectives = listRetrospectives(options, db);
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: now(),
    filters,
    count: retrospectives.length,
    retrospectives,
  };
}

export function renderRetrospectiveMarkdown(record: RetrospectiveRecord | RetrospectiveExport): string {
  if ("retrospectives" in record) {
    return record.retrospectives.map(renderRetrospectiveMarkdown).join("\n");
  }
  const report = record.report;
  const lines = [
    `# ${report.title}`,
    "",
    `Generated: ${report.generated_at}`,
    `Scope: ${report.scope} ${report.scope_id}`,
    "",
    "## Summary",
    "",
    `- Tasks: ${report.summary.completed_tasks}/${report.summary.total_tasks} completed`,
    `- Completed plans: ${report.summary.completed_plans}`,
    `- Missed estimates: ${report.summary.missed_estimates}`,
    `- Recurring blockers: ${report.summary.recurring_blockers}`,
    `- Failed verifications: ${report.summary.failed_verifications}`,
    "",
    "## Lessons",
    "",
  ];
  for (const lesson of report.lessons) lines.push(`- ${lesson}`);
  if (report.follow_up_tasks.length > 0) {
    lines.push("", "## Follow-up Tasks", "");
    for (const task of report.follow_up_tasks) lines.push(`- ${task.title} (${task.priority})`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
