import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";
import { redactEvidenceText, redactValue } from "../lib/redaction.js";

export type ProjectRiskStatus = "open" | "mitigating" | "resolved" | "accepted";
export type ProjectRiskSeverity = "low" | "medium" | "high" | "critical";
export type ProjectRiskProbability = "low" | "medium" | "high";
export type ProjectHealthStatus = "healthy" | "watch" | "at_risk" | "critical";
export type RiskExportFormat = "json" | "markdown";

export interface ProjectRiskRecord {
  id: string;
  title: string;
  description: string | null;
  status: ProjectRiskStatus;
  severity: ProjectRiskSeverity;
  probability: ProjectRiskProbability;
  owner: string | null;
  mitigation: string | null;
  due_at: string | null;
  project_id: string | null;
  plan_id: string | null;
  task_id: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface CreateRiskInput {
  title: string;
  description?: string;
  status?: ProjectRiskStatus;
  severity?: ProjectRiskSeverity;
  probability?: ProjectRiskProbability;
  owner?: string;
  mitigation?: string;
  due_at?: string;
  project_id?: string;
  plan_id?: string;
  task_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateRiskInput {
  title?: string;
  description?: string | null;
  status?: ProjectRiskStatus;
  severity?: ProjectRiskSeverity;
  probability?: ProjectRiskProbability;
  owner?: string | null;
  mitigation?: string | null;
  due_at?: string | null;
  project_id?: string | null;
  plan_id?: string | null;
  task_id?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListRisksOptions {
  status?: ProjectRiskStatus;
  severity?: ProjectRiskSeverity;
  probability?: ProjectRiskProbability;
  owner?: string;
  project_id?: string;
  plan_id?: string;
  task_id?: string;
  tag?: string;
  include_closed?: boolean;
  limit?: number;
}

export interface ProjectHealthReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  scope: "plan" | "project";
  scope_id: string;
  score: number;
  status: ProjectHealthStatus;
  components: {
    total_tasks: number;
    blocked_tasks: number;
    overdue_tasks: number;
    failed_checks: number;
    failed_runs: number;
    dependency_depth: number;
    open_risks: number;
    critical_risks: number;
    overdue_risks: number;
  };
  penalties: Record<string, number>;
  blocked: Array<{ id: string; short_id: string | null; title: string; blockers: Array<{ id: string; short_id: string | null; title: string; status: string }> }>;
  overdue: Array<{ id: string; short_id: string | null; title: string; due_at: string }>;
  failed_checks: Array<{ id: string; task_id: string; command: string; run_at: string }>;
  failed_runs: Array<{ id: string; task_id: string; title: string | null; completed_at: string | null }>;
  risks: ProjectRiskRecord[];
  recommendations: string[];
}

export interface RiskRegisterExport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  filters: Omit<ListRisksOptions, "limit">;
  count: number;
  risks: ProjectRiskRecord[];
}

interface ProjectRiskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  probability: string;
  owner: string | null;
  mitigation: string | null;
  due_at: string | null;
  project_id: string | null;
  plan_id: string | null;
  task_id: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

interface TaskHealthRow {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  due_at: string | null;
}

const VALID_STATUSES = new Set<ProjectRiskStatus>(["open", "mitigating", "resolved", "accepted"]);
const VALID_SEVERITIES = new Set<ProjectRiskSeverity>(["low", "medium", "high", "critical"]);
const VALID_PROBABILITIES = new Set<ProjectRiskProbability>(["low", "medium", "high"]);

function parseArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags || []).flatMap((tag) => tag.split(",")).map((tag) => tag.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertStatus(status: ProjectRiskStatus): void {
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid risk status: ${status}`);
}

function assertSeverity(severity: ProjectRiskSeverity): void {
  if (!VALID_SEVERITIES.has(severity)) throw new Error(`Invalid risk severity: ${severity}`);
}

function assertProbability(probability: ProjectRiskProbability): void {
  if (!VALID_PROBABILITIES.has(probability)) throw new Error(`Invalid risk probability: ${probability}`);
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return 50;
  return Math.min(Math.floor(limit), 500);
}

function rowToRisk(row: ProjectRiskRow): ProjectRiskRecord {
  return {
    id: row.id,
    title: redactEvidenceText(row.title),
    description: row.description ? redactEvidenceText(row.description) : null,
    status: row.status as ProjectRiskStatus,
    severity: row.severity as ProjectRiskSeverity,
    probability: row.probability as ProjectRiskProbability,
    owner: row.owner ? redactEvidenceText(row.owner) : null,
    mitigation: row.mitigation ? redactEvidenceText(row.mitigation) : null,
    due_at: row.due_at,
    project_id: row.project_id,
    plan_id: row.plan_id,
    task_id: row.task_id,
    tags: parseArray(row.tags),
    metadata: redactValue(parseObject(row.metadata)) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
  };
}

function resolveKnownId(table: "tasks" | "projects" | "plans" | "project_risks", value: string | null | undefined, db: Database): string | null {
  if (!value) return null;
  return resolvePartialId(db, table, value) || value;
}

export function createRisk(input: CreateRiskInput, db?: Database): ProjectRiskRecord {
  const title = input.title.trim();
  if (!title) throw new Error("Risk title is required");
  const status = input.status || "open";
  const severity = input.severity || "medium";
  const probability = input.probability || "medium";
  assertStatus(status);
  assertSeverity(severity);
  assertProbability(probability);

  const d = db || getDatabase();
  const timestamp = now();
  const id = uuid();
  const closedAt = status === "resolved" || status === "accepted" ? timestamp : null;
  d.run(
    `INSERT INTO project_risks (
      id, title, description, status, severity, probability, owner, mitigation, due_at,
      project_id, plan_id, task_id, tags, metadata, created_at, updated_at, closed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      title,
      normalizeText(input.description),
      status,
      severity,
      probability,
      normalizeText(input.owner),
      normalizeText(input.mitigation),
      normalizeText(input.due_at),
      resolveKnownId("projects", input.project_id, d),
      resolveKnownId("plans", input.plan_id, d),
      resolveKnownId("tasks", input.task_id, d),
      JSON.stringify(normalizeTags(input.tags)),
      JSON.stringify(input.metadata || {}),
      timestamp,
      timestamp,
      closedAt,
    ],
  );
  return getRisk(id, d)!;
}

export function getRisk(id: string, db?: Database): ProjectRiskRecord | null {
  const d = db || getDatabase();
  const resolved = resolveKnownId("project_risks", id, d) || id;
  const row = d.query("SELECT * FROM project_risks WHERE id = ?").get(resolved) as ProjectRiskRow | null;
  return row ? rowToRisk(row) : null;
}

export function updateRisk(id: string, input: UpdateRiskInput, db?: Database): ProjectRiskRecord {
  const d = db || getDatabase();
  const current = getRisk(id, d);
  if (!current) throw new Error(`Risk not found: ${id}`);
  const resolved = current.id;
  const sets: string[] = ["updated_at = ?"];
  const params: SQLQueryBindings[] = [now()];

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new Error("Risk title is required");
    sets.push("title = ?");
    params.push(title);
  }
  if (input.description !== undefined) { sets.push("description = ?"); params.push(normalizeText(input.description)); }
  if (input.status !== undefined) {
    assertStatus(input.status);
    sets.push("status = ?");
    params.push(input.status);
    sets.push("closed_at = ?");
    params.push(input.status === "resolved" || input.status === "accepted" ? now() : null);
  }
  if (input.severity !== undefined) { assertSeverity(input.severity); sets.push("severity = ?"); params.push(input.severity); }
  if (input.probability !== undefined) { assertProbability(input.probability); sets.push("probability = ?"); params.push(input.probability); }
  if (input.owner !== undefined) { sets.push("owner = ?"); params.push(normalizeText(input.owner)); }
  if (input.mitigation !== undefined) { sets.push("mitigation = ?"); params.push(normalizeText(input.mitigation)); }
  if (input.due_at !== undefined) { sets.push("due_at = ?"); params.push(normalizeText(input.due_at)); }
  if (input.project_id !== undefined) { sets.push("project_id = ?"); params.push(resolveKnownId("projects", input.project_id, d)); }
  if (input.plan_id !== undefined) { sets.push("plan_id = ?"); params.push(resolveKnownId("plans", input.plan_id, d)); }
  if (input.task_id !== undefined) { sets.push("task_id = ?"); params.push(resolveKnownId("tasks", input.task_id, d)); }
  if (input.tags !== undefined) { sets.push("tags = ?"); params.push(JSON.stringify(normalizeTags(input.tags))); }
  if (input.metadata !== undefined) { sets.push("metadata = ?"); params.push(JSON.stringify(input.metadata)); }

  params.push(resolved);
  d.run(`UPDATE project_risks SET ${sets.join(", ")} WHERE id = ?`, params);
  return getRisk(resolved, d)!;
}

export function closeRisk(id: string, status: "resolved" | "accepted" = "resolved", db?: Database): ProjectRiskRecord {
  return updateRisk(id, { status }, db);
}

function buildRiskFilters(options: ListRisksOptions, db: Database): { where: string; params: SQLQueryBindings[] } {
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (!options.include_closed) conditions.push("status IN ('open', 'mitigating')");
  if (options.status) { assertStatus(options.status); conditions.push("status = ?"); params.push(options.status); }
  if (options.severity) { assertSeverity(options.severity); conditions.push("severity = ?"); params.push(options.severity); }
  if (options.probability) { assertProbability(options.probability); conditions.push("probability = ?"); params.push(options.probability); }
  if (options.owner) { conditions.push("owner = ?"); params.push(options.owner); }
  const projectId = resolveKnownId("projects", options.project_id, db);
  if (projectId) { conditions.push("project_id = ?"); params.push(projectId); }
  const planId = resolveKnownId("plans", options.plan_id, db);
  if (planId) { conditions.push("plan_id = ?"); params.push(planId); }
  const taskId = resolveKnownId("tasks", options.task_id, db);
  if (taskId) { conditions.push("task_id = ?"); params.push(taskId); }
  if (options.tag) { conditions.push("EXISTS (SELECT 1 FROM json_each(project_risks.tags) WHERE value = ?)"); params.push(options.tag); }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function listRisks(options: ListRisksOptions = {}, db?: Database): ProjectRiskRecord[] {
  const d = db || getDatabase();
  const { where, params } = buildRiskFilters(options, d);
  params.push(clampLimit(options.limit));
  return (d.query(`SELECT * FROM project_risks ${where} ORDER BY due_at IS NULL, due_at ASC, updated_at DESC LIMIT ?`).all(...params) as ProjectRiskRow[])
    .map(rowToRisk);
}

function scopeCondition(scope: "plan" | "project", scopeId: string, db: Database): { where: string; id: string } {
  const table = scope === "plan" ? "plans" : "projects";
  const resolved = resolveKnownId(table, scopeId, db) || scopeId;
  return { where: scope === "plan" ? "plan_id = ?" : "project_id = ?", id: resolved };
}

function calculateDependencyDepth(taskIds: Set<string>, db: Database): number {
  const rows = db.query("SELECT task_id, depends_on FROM task_dependencies").all() as { task_id: string; depends_on: string }[];
  const byTask = new Map<string, string[]>();
  for (const row of rows) {
    const deps = byTask.get(row.task_id) || [];
    deps.push(row.depends_on);
    byTask.set(row.task_id, deps);
  }
  const memo = new Map<string, number>();
  const depth = (taskId: string, visiting = new Set<string>()): number => {
    if (memo.has(taskId)) return memo.get(taskId)!;
    if (visiting.has(taskId)) return 0;
    visiting.add(taskId);
    const deps = byTask.get(taskId) || [];
    const value = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => 1 + depth(dep, visiting)));
    visiting.delete(taskId);
    memo.set(taskId, value);
    return value;
  };
  let max = 0;
  for (const taskId of taskIds) max = Math.max(max, depth(taskId));
  return max;
}

function scoreHealth(scope: "plan" | "project", scopeId: string, db?: Database): ProjectHealthReport {
  const d = db || getDatabase();
  const generatedAt = now();
  const scopeInfo = scopeCondition(scope, scopeId, d);
  const tasks = d.query(`SELECT id, short_id, title, status, due_at FROM tasks WHERE ${scopeInfo.where}`).all(scopeInfo.id) as TaskHealthRow[];
  const taskIds = new Set(tasks.map((task) => task.id));
  const activeTaskIds = new Set(tasks.filter((task) => task.status !== "completed" && task.status !== "cancelled").map((task) => task.id));

  const blocked = tasks
    .filter((task) => activeTaskIds.has(task.id))
    .map((task) => {
      const blockers = d.query(
        `SELECT dep.id, dep.short_id, dep.title, dep.status
         FROM task_dependencies td
         JOIN tasks dep ON dep.id = td.depends_on
         WHERE td.task_id = ? AND dep.status != 'completed'`,
      ).all(task.id) as Array<{ id: string; short_id: string | null; title: string; status: string }>;
      return { id: task.id, short_id: task.short_id, title: redactEvidenceText(task.title), blockers };
    })
    .filter((entry) => entry.blockers.length > 0);

  const overdue = tasks
    .filter((task): task is TaskHealthRow & { due_at: string } => activeTaskIds.has(task.id) && Boolean(task.due_at && task.due_at < generatedAt))
    .map((task) => ({ id: task.id, short_id: task.short_id, title: redactEvidenceText(task.title), due_at: task.due_at }));

  const failedChecks = d.query(
    `SELECT tv.id, tv.task_id, tv.command, tv.run_at
     FROM task_verifications tv
     JOIN tasks t ON t.id = tv.task_id
     WHERE t.${scopeInfo.where} AND tv.status = 'failed'
     ORDER BY tv.run_at DESC`,
  ).all(scopeInfo.id) as Array<{ id: string; task_id: string; command: string; run_at: string }>;

  const failedRuns = d.query(
    `SELECT tr.id, tr.task_id, tr.title, tr.completed_at
     FROM task_runs tr
     JOIN tasks t ON t.id = tr.task_id
     WHERE t.${scopeInfo.where} AND tr.status = 'failed'
     ORDER BY coalesce(tr.completed_at, tr.started_at) DESC`,
  ).all(scopeInfo.id) as Array<{ id: string; task_id: string; title: string | null; completed_at: string | null }>;

  const riskOptions: ListRisksOptions = scope === "plan"
    ? { plan_id: scopeInfo.id, include_closed: false, limit: 500 }
    : { project_id: scopeInfo.id, include_closed: false, limit: 500 };
  const risks = listRisks(riskOptions, d);
  const criticalRisks = risks.filter((risk) => risk.severity === "critical").length;
  const overdueRisks = risks.filter((risk) => risk.due_at !== null && risk.due_at < generatedAt).length;
  const dependencyDepth = calculateDependencyDepth(taskIds, d);

  const penalties = {
    blocked_tasks: blocked.length * 15,
    overdue_tasks: overdue.length * 12,
    failed_checks: failedChecks.length * 8,
    failed_runs: failedRuns.length * 10,
    dependency_depth: Math.max(0, dependencyDepth - 3) * 5,
    open_risks: risks.reduce((sum, risk) => sum + ({ low: 2, medium: 5, high: 9, critical: 14 }[risk.severity]), 0),
    overdue_risks: overdueRisks * 10,
  };
  const totalPenalty = Object.values(penalties).reduce((sum, penalty) => sum + penalty, 0);
  const score = Math.max(0, 100 - Math.min(100, totalPenalty));
  const status: ProjectHealthStatus = score < 40 ? "critical" : score < 70 ? "at_risk" : score < 85 ? "watch" : "healthy";
  const recommendations: string[] = [];
  if (blocked.length > 0) recommendations.push("Clear blocking dependencies before starting more work.");
  if (overdue.length > 0) recommendations.push("Reschedule or complete overdue open tasks.");
  if (failedChecks.length > 0 || failedRuns.length > 0) recommendations.push("Review failed verification evidence before marking the plan healthy.");
  if (criticalRisks > 0) recommendations.push("Mitigate or accept critical open risks with an owner.");
  if (overdueRisks > 0) recommendations.push("Update overdue risk mitigations and due dates.");
  if (dependencyDepth > 3) recommendations.push("Flatten deep dependency chains to reduce execution risk.");
  if (recommendations.length === 0) recommendations.push("No immediate local health risks detected.");

  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: generatedAt,
    scope,
    scope_id: scopeInfo.id,
    score,
    status,
    components: {
      total_tasks: tasks.length,
      blocked_tasks: blocked.length,
      overdue_tasks: overdue.length,
      failed_checks: failedChecks.length,
      failed_runs: failedRuns.length,
      dependency_depth: dependencyDepth,
      open_risks: risks.length,
      critical_risks: criticalRisks,
      overdue_risks: overdueRisks,
    },
    penalties,
    blocked,
    overdue,
    failed_checks: failedChecks.map((check) => ({ ...check, command: redactEvidenceText(check.command) })),
    failed_runs: failedRuns.map((run) => ({ ...run, title: run.title ? redactEvidenceText(run.title) : null })),
    risks,
    recommendations,
  };
}

export function scorePlanHealth(planId: string, db?: Database): ProjectHealthReport {
  return scoreHealth("plan", planId, db);
}

export function scoreProjectHealth(projectId: string, db?: Database): ProjectHealthReport {
  return scoreHealth("project", projectId, db);
}

export function createRiskRegisterExport(options: ListRisksOptions = {}, db?: Database): RiskRegisterExport {
  const { limit: _limit, ...filters } = options;
  const risks = listRisks(options, db);
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: now(),
    filters,
    count: risks.length,
    risks,
  };
}

export function renderRiskRegisterMarkdown(report: RiskRegisterExport): string {
  const lines = [
    "# Risk Register",
    "",
    `Generated: ${report.generated_at}`,
    `Risks: ${report.count}`,
    "",
  ];
  for (const risk of report.risks) {
    lines.push(`## ${risk.title}`, "");
    lines.push(`- Status: ${risk.status}`);
    lines.push(`- Severity: ${risk.severity}`);
    lines.push(`- Probability: ${risk.probability}`);
    if (risk.owner) lines.push(`- Owner: ${risk.owner}`);
    if (risk.due_at) lines.push(`- Due: ${risk.due_at}`);
    if (risk.project_id) lines.push(`- Project: ${risk.project_id}`);
    if (risk.plan_id) lines.push(`- Plan: ${risk.plan_id}`);
    if (risk.task_id) lines.push(`- Task: ${risk.task_id}`);
    if (risk.tags.length > 0) lines.push(`- Tags: ${risk.tags.join(", ")}`);
    lines.push("");
    if (risk.description) lines.push(risk.description, "");
    if (risk.mitigation) lines.push("Mitigation:", "", risk.mitigation, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
