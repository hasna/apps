import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, now, resolvePartialId } from "./database.js";
import { redactEvidenceText } from "../lib/redaction.js";

export interface AgentMetrics {
  agent_id: string;
  agent_name: string;
  tasks_completed: number;
  tasks_failed: number;
  tasks_in_progress: number;
  completion_rate: number;
  avg_completion_minutes: number | null;
  avg_confidence: number | null;
  review_score_avg: number | null;
  composite_score: number;
}

export interface LeaderboardEntry extends AgentMetrics {
  rank: number;
}

export interface AgentReliabilityScorecardOptions {
  project_id?: string;
  since?: string;
  stale_after_hours?: number;
}

export type AgentReliabilityGrade = "excellent" | "good" | "watch" | "at_risk";

export interface AgentReliabilityScorecard {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  agent_id: string;
  agent_name: string;
  scope: {
    project_id: string | null;
    since: string | null;
    stale_after_hours: number;
  };
  score: number;
  grade: AgentReliabilityGrade;
  components: {
    delivery: number;
    verification: number;
    run_reliability: number;
    lock_hygiene: number;
    retry_discipline: number;
    handoff_hygiene: number;
  };
  signals: {
    tasks_completed: number;
    tasks_failed: number;
    tasks_in_progress: number;
    completion_rate: number;
    passed_verifications: number;
    failed_verifications: number;
    unknown_verifications: number;
    completed_tasks_with_passed_verification: number;
    verification_coverage: number;
    runs_completed: number;
    runs_failed: number;
    run_success_rate: number;
    stale_task_locks: number;
    stale_resource_locks: number;
    handoffs_created: number;
    handoffs_with_task_refs: number;
    handoffs_with_blockers: number;
    retry_count: number;
    max_retry_count: number;
  };
  evidence: {
    failed_tasks: Array<{ id: string; short_id: string | null; title: string; updated_at: string }>;
    failed_verifications: Array<{ id: string; task_id: string; command: string; run_at: string }>;
    failed_runs: Array<{ id: string; task_id: string; title: string | null; completed_at: string | null }>;
    stale_locks: Array<{ kind: "task" | "resource"; id: string; locked_at: string; resource_type?: string }>;
  };
  recommendations: string[];
}

export interface AgentReliabilityExport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  filters: {
    agent_id: string | null;
    project_id: string | null;
    since: string | null;
    stale_after_hours: number;
  };
  count: number;
  scorecards: AgentReliabilityScorecard[];
}

/**
 * Compute metrics for a single agent from task data.
 */
export function getAgentMetrics(agentId: string, opts?: { project_id?: string }, db?: Database): AgentMetrics | null {
  const d = getDatabase(db);

  // Resolve agent name
  const agent = d.query("SELECT id, name FROM agents WHERE id = ? OR LOWER(name) = LOWER(?)").get(agentId, agentId) as { id: string; name: string } | null;
  if (!agent) return null;

  let projectFilter = "";
  const params: string[] = [agent.id, agent.id];
  if (opts?.project_id) {
    projectFilter = " AND project_id = ?";
    params.push(opts.project_id);
  }

  // Task counts
  const completed = (d.query(
    `SELECT COUNT(*) as count FROM tasks WHERE (agent_id = ? OR assigned_to = ?) AND status = 'completed'${projectFilter}`,
  ).get(...params) as { count: number }).count;

  const failed = (d.query(
    `SELECT COUNT(*) as count FROM tasks WHERE (agent_id = ? OR assigned_to = ?) AND status = 'failed'${projectFilter}`,
  ).get(...params) as { count: number }).count;

  const inProgress = (d.query(
    `SELECT COUNT(*) as count FROM tasks WHERE (agent_id = ? OR assigned_to = ?) AND status = 'in_progress'${projectFilter}`,
  ).get(...params) as { count: number }).count;

  const total = completed + failed;
  const completionRate = total > 0 ? completed / total : 0;

  // Average completion time (minutes)
  const avgTime = d.query(
    `SELECT AVG(
       (julianday(completed_at) - julianday(created_at)) * 24 * 60
     ) as avg_minutes
     FROM tasks
     WHERE (agent_id = ? OR assigned_to = ?) AND status = 'completed' AND completed_at IS NOT NULL${projectFilter}`,
  ).get(...params) as { avg_minutes: number | null };

  // Average confidence
  const avgConf = d.query(
    `SELECT AVG(confidence) as avg_confidence
     FROM tasks
     WHERE (agent_id = ? OR assigned_to = ?) AND status = 'completed' AND confidence IS NOT NULL${projectFilter}`,
  ).get(...params) as { avg_confidence: number | null };

  // Review score average (from metadata._review_score)
  const reviewTasks = d.query(
    `SELECT metadata FROM tasks
     WHERE (agent_id = ? OR assigned_to = ?) AND status = 'completed'${projectFilter}
       AND metadata LIKE '%_review_score%'`,
  ).all(...params) as { metadata: string }[];

  let reviewScoreAvg: number | null = null;
  if (reviewTasks.length > 0) {
    let total = 0;
    let count = 0;
    for (const row of reviewTasks) {
      try {
        const meta = JSON.parse(row.metadata);
        if (typeof meta._review_score === "number") {
          total += meta._review_score;
          count++;
        }
      } catch {}
    }
    if (count > 0) reviewScoreAvg = total / count;
  }

  // Composite score: weighted combination
  // completion_rate: 0.3, speed (normalized): 0.2, confidence: 0.3, volume bonus: 0.2
  const speedScore = avgTime?.avg_minutes != null
    ? Math.max(0, 1 - (avgTime.avg_minutes / (60 * 24))) // 0-1, 1 = instant, 0 = 24h+
    : 0.5;
  const confidenceScore = avgConf?.avg_confidence ?? 0.5;
  const volumeScore = Math.min(1, completed / 50); // Cap at 50 tasks for max score

  const compositeScore = (
    completionRate * 0.3 +
    speedScore * 0.2 +
    confidenceScore * 0.3 +
    volumeScore * 0.2
  );

  return {
    agent_id: agent.id,
    agent_name: agent.name,
    tasks_completed: completed,
    tasks_failed: failed,
    tasks_in_progress: inProgress,
    completion_rate: Math.round(completionRate * 1000) / 1000,
    avg_completion_minutes: avgTime?.avg_minutes != null ? Math.round(avgTime.avg_minutes * 10) / 10 : null,
    avg_confidence: avgConf?.avg_confidence != null ? Math.round(avgConf.avg_confidence * 1000) / 1000 : null,
    review_score_avg: reviewScoreAvg != null ? Math.round(reviewScoreAvg * 1000) / 1000 : null,
    composite_score: Math.round(compositeScore * 1000) / 1000,
  };
}

/**
 * Get leaderboard: all agents ranked by composite score.
 */
export function getLeaderboard(opts?: { project_id?: string; limit?: number }, db?: Database): LeaderboardEntry[] {
  const d = getDatabase(db);
  const agents = d.query("SELECT id FROM agents ORDER BY name").all() as { id: string }[];

  const entries: AgentMetrics[] = [];
  for (const agent of agents) {
    const metrics = getAgentMetrics(agent.id, { project_id: opts?.project_id }, d);
    if (metrics && (metrics.tasks_completed > 0 || metrics.tasks_failed > 0 || metrics.tasks_in_progress > 0)) {
      entries.push(metrics);
    }
  }

  entries.sort((a, b) => b.composite_score - a.composite_score);

  const limit = opts?.limit || 20;
  return entries.slice(0, limit).map((entry, idx) => ({
    ...entry,
    rank: idx + 1,
  }));
}

/**
 * Score a task completion (store review score in metadata).
 */
export function scoreTask(taskId: string, score: number, reviewerId?: string, db?: Database): void {
  const d = getDatabase(db);
  if (score < 0 || score > 1) throw new Error("Score must be between 0 and 1");

  const task = d.query("SELECT metadata FROM tasks WHERE id = ?").get(taskId) as { metadata: string } | null;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const metadata = JSON.parse(task.metadata || "{}");
  metadata._review_score = score;
  if (reviewerId) metadata._reviewed_by = reviewerId;
  metadata._reviewed_at = now();

  d.run("UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?", [JSON.stringify(metadata), now(), taskId]);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function round(value: number, decimals = 3): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function parseArray(value: string | null | undefined): unknown[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function scoreToGrade(score: number): AgentReliabilityGrade {
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 55) return "watch";
  return "at_risk";
}

function resolveProjectId(value: string | undefined, db: Database): string | null {
  if (!value) return null;
  return resolvePartialId(db, "projects", value) || value;
}

function resolveAgent(agentId: string, db: Database): { id: string; name: string } | null {
  return db.query("SELECT id, name FROM agents WHERE id = ? OR LOWER(name) = LOWER(?)").get(agentId, agentId) as { id: string; name: string } | null;
}

function agentTaskWhere(agent: { id: string; name: string }, options: AgentReliabilityScorecardOptions, db: Database): {
  where: string;
  params: SQLQueryBindings[];
  project_id: string | null;
} {
  const conditions = ["(t.agent_id = ? OR t.assigned_to = ? OR LOWER(t.assigned_to) = LOWER(?))"];
  const params: SQLQueryBindings[] = [agent.id, agent.id, agent.name];
  const projectId = resolveProjectId(options.project_id, db);
  if (projectId) {
    conditions.push("t.project_id = ?");
    params.push(projectId);
  }
  if (options.since) {
    conditions.push("t.created_at >= ?");
    params.push(options.since);
  }
  return { where: conditions.join(" AND "), params, project_id: projectId };
}

function agentEvidenceWhere(agent: { id: string; name: string }, options: AgentReliabilityScorecardOptions, db: Database, evidenceAlias: string): {
  where: string;
  params: SQLQueryBindings[];
  project_id: string | null;
} {
  const conditions = [`((t.agent_id = ? OR t.assigned_to = ? OR LOWER(t.assigned_to) = LOWER(?)) OR (${evidenceAlias}.agent_id = ? OR LOWER(${evidenceAlias}.agent_id) = LOWER(?)))`];
  const params: SQLQueryBindings[] = [agent.id, agent.id, agent.name, agent.id, agent.name];
  const projectId = resolveProjectId(options.project_id, db);
  if (projectId) {
    conditions.push("t.project_id = ?");
    params.push(projectId);
  }
  if (options.since) {
    conditions.push(`(${evidenceAlias}.created_at >= ? OR t.created_at >= ?)`);
    params.push(options.since, options.since);
  }
  return { where: conditions.join(" AND "), params, project_id: projectId };
}

function countByStatus(db: Database, where: string, params: SQLQueryBindings[]): Record<string, number> {
  const rows = db.query(`SELECT t.status, COUNT(*) as count FROM tasks t WHERE ${where} GROUP BY t.status`).all(...params) as Array<{ status: string; count: number }>;
  return Object.fromEntries(rows.map((row) => [row.status, row.count]));
}

function scoreHandoffs(created: number, withTaskRefs: number, withBlockers: number): number {
  if (created === 0) return 70;
  const taskRefRate = withTaskRefs / created;
  const blockerPenalty = withBlockers / created;
  return clampScore(75 + taskRefRate * 25 - blockerPenalty * 10);
}

export function getAgentReliabilityScorecard(
  agentId: string,
  options: AgentReliabilityScorecardOptions = {},
  db?: Database,
): AgentReliabilityScorecard | null {
  const d = getDatabase(db);
  const agent = resolveAgent(agentId, d);
  if (!agent) return null;

  const generatedAt = now();
  const staleAfterHours = Number.isFinite(options.stale_after_hours) && options.stale_after_hours! > 0
    ? Math.min(Math.floor(options.stale_after_hours!), 24 * 30)
    : 24;
  const staleCutoff = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000).toISOString();
  const taskFilter = agentTaskWhere(agent, options, d);
  const counts = countByStatus(d, taskFilter.where, taskFilter.params);
  const completed = counts.completed || 0;
  const failed = counts.failed || 0;
  const inProgress = counts.in_progress || 0;
  const totalClosed = completed + failed;
  const completionRate = totalClosed > 0 ? completed / totalClosed : 0;

  const failedTasks = d.query(
    `SELECT t.id, t.short_id, t.title, t.updated_at
     FROM tasks t
     WHERE ${taskFilter.where} AND t.status = 'failed'
     ORDER BY t.updated_at DESC, t.created_at DESC
     LIMIT 10`,
  ).all(...taskFilter.params) as Array<{ id: string; short_id: string | null; title: string; updated_at: string }>;

  const retryRow = d.query(
    `SELECT COALESCE(SUM(t.retry_count), 0) as retry_count, COALESCE(MAX(t.retry_count), 0) as max_retry_count
     FROM tasks t
     WHERE ${taskFilter.where}`,
  ).get(...taskFilter.params) as { retry_count: number; max_retry_count: number };

  const verificationFilter = agentEvidenceWhere(agent, options, d, "tv");
  const verificationRows = d.query(
    `SELECT tv.status, COUNT(*) as count
     FROM task_verifications tv
     JOIN tasks t ON t.id = tv.task_id
     WHERE ${verificationFilter.where}
     GROUP BY tv.status`,
  ).all(...verificationFilter.params) as Array<{ status: string; count: number }>;
  const verificationCounts = Object.fromEntries(verificationRows.map((row) => [row.status, row.count]));
  const passedVerifications = verificationCounts.passed || 0;
  const failedVerifications = verificationCounts.failed || 0;
  const unknownVerifications = verificationCounts.unknown || 0;
  const totalVerifications = passedVerifications + failedVerifications + unknownVerifications;
  const completedWithPassed = d.query(
    `SELECT COUNT(DISTINCT t.id) as count
     FROM tasks t
     JOIN task_verifications tv ON tv.task_id = t.id
     WHERE ${taskFilter.where} AND t.status = 'completed' AND tv.status = 'passed'`,
  ).get(...taskFilter.params) as { count: number };
  const verificationCoverage = completed > 0 ? completedWithPassed.count / completed : 0;

  const failedVerificationEvidence = d.query(
    `SELECT tv.id, tv.task_id, tv.command, tv.run_at
     FROM task_verifications tv
     JOIN tasks t ON t.id = tv.task_id
     WHERE ${verificationFilter.where} AND tv.status = 'failed'
     ORDER BY tv.run_at DESC, tv.created_at DESC
     LIMIT 10`,
  ).all(...verificationFilter.params) as Array<{ id: string; task_id: string; command: string; run_at: string }>;

  const runFilter = agentEvidenceWhere(agent, options, d, "tr");
  const runRows = d.query(
    `SELECT tr.status, COUNT(*) as count
     FROM task_runs tr
     JOIN tasks t ON t.id = tr.task_id
     WHERE ${runFilter.where}
     GROUP BY tr.status`,
  ).all(...runFilter.params) as Array<{ status: string; count: number }>;
  const runCounts = Object.fromEntries(runRows.map((row) => [row.status, row.count]));
  const runsCompleted = runCounts.completed || 0;
  const runsFailed = runCounts.failed || 0;
  const closedRuns = runsCompleted + runsFailed;
  const runSuccessRate = closedRuns > 0 ? runsCompleted / closedRuns : 1;
  const failedRunEvidence = d.query(
    `SELECT tr.id, tr.task_id, tr.title, tr.completed_at
     FROM task_runs tr
     JOIN tasks t ON t.id = tr.task_id
     WHERE ${runFilter.where} AND tr.status = 'failed'
     ORDER BY COALESCE(tr.completed_at, tr.started_at) DESC
     LIMIT 10`,
  ).all(...runFilter.params) as Array<{ id: string; task_id: string; title: string | null; completed_at: string | null }>;

  const taskLockParams: SQLQueryBindings[] = [agent.id, agent.name, staleCutoff];
  let taskLockProjectClause = "";
  if (taskFilter.project_id) {
    taskLockProjectClause = " AND project_id = ?";
    taskLockParams.push(taskFilter.project_id);
  }
  const staleTaskLocks = d.query(
    `SELECT id, locked_at FROM tasks
     WHERE locked_by IN (?, ?) AND locked_at IS NOT NULL AND locked_at < ?${taskLockProjectClause}
     ORDER BY locked_at ASC
     LIMIT 25`,
  ).all(...taskLockParams) as Array<{ id: string; locked_at: string }>;
  const staleResourceLocks = d.query(
    `SELECT resource_type, resource_id, locked_at FROM resource_locks
     WHERE (agent_id = ? OR LOWER(agent_id) = LOWER(?)) AND expires_at < ?
     ORDER BY locked_at ASC
     LIMIT 25`,
  ).all(agent.id, agent.name, generatedAt) as Array<{ resource_type: string; resource_id: string; locked_at: string }>;

  const handoffParams: SQLQueryBindings[] = [agent.id, agent.name];
  const handoffConditions = ["(agent_id = ? OR LOWER(agent_id) = LOWER(?))"];
  if (taskFilter.project_id) {
    handoffConditions.push("project_id = ?");
    handoffParams.push(taskFilter.project_id);
  }
  if (options.since) {
    handoffConditions.push("created_at >= ?");
    handoffParams.push(options.since);
  }
  const handoffs = d.query(
    `SELECT task_ids, blockers FROM handoffs WHERE ${handoffConditions.join(" AND ")}`,
  ).all(...handoffParams) as Array<{ task_ids: string | null; blockers: string | null }>;
  const handoffsWithTaskRefs = handoffs.filter((handoff) => parseArray(handoff.task_ids).length > 0).length;
  const handoffsWithBlockers = handoffs.filter((handoff) => parseArray(handoff.blockers).length > 0).length;

  const deliveryScore = totalClosed > 0 ? completionRate * 100 : 60;
  const verificationScore = totalVerifications > 0
    ? (passedVerifications / totalVerifications) * 70 + verificationCoverage * 30
    : (completed > 0 ? verificationCoverage * 100 : 65);
  const runScore = closedRuns > 0 ? runSuccessRate * 100 : 80;
  const lockScore = clampScore(100 - staleTaskLocks.length * 20 - staleResourceLocks.length * 10);
  const retryScore = clampScore(100 - retryRow.retry_count * 8 - retryRow.max_retry_count * 4);
  const handoffScore = scoreHandoffs(handoffs.length, handoffsWithTaskRefs, handoffsWithBlockers);
  const components = {
    delivery: clampScore(deliveryScore),
    verification: clampScore(verificationScore),
    run_reliability: clampScore(runScore),
    lock_hygiene: lockScore,
    retry_discipline: retryScore,
    handoff_hygiene: handoffScore,
  };
  const score = clampScore(
    components.delivery * 0.25 +
    components.verification * 0.25 +
    components.run_reliability * 0.2 +
    components.lock_hygiene * 0.12 +
    components.retry_discipline * 0.1 +
    components.handoff_hygiene * 0.08,
  );

  const recommendations: string[] = [];
  if (failed > 0) recommendations.push("Review failed tasks before assigning more work to this agent.");
  if (failedVerifications > 0) recommendations.push("Re-run or replace failed verification evidence with passing local checks.");
  if (completed > 0 && verificationCoverage < 0.8) recommendations.push("Increase passed verification coverage for completed tasks.");
  if (runsFailed > 0) recommendations.push("Inspect failed local run ledgers and record follow-up tasks for recurring failures.");
  if (staleTaskLocks.length + staleResourceLocks.length > 0) recommendations.push("Release or refresh stale locks owned by this agent.");
  if (retryRow.retry_count > 0) recommendations.push("Check retry history for repeated failure patterns.");
  if (handoffs.length > 0 && handoffsWithTaskRefs < handoffs.length) recommendations.push("Attach task references to handoffs so future agents can resume from local context.");
  if (recommendations.length === 0) recommendations.push("No immediate local reliability risks detected.");

  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: generatedAt,
    agent_id: agent.id,
    agent_name: agent.name,
    scope: {
      project_id: taskFilter.project_id,
      since: options.since || null,
      stale_after_hours: staleAfterHours,
    },
    score,
    grade: scoreToGrade(score),
    components,
    signals: {
      tasks_completed: completed,
      tasks_failed: failed,
      tasks_in_progress: inProgress,
      completion_rate: round(completionRate),
      passed_verifications: passedVerifications,
      failed_verifications: failedVerifications,
      unknown_verifications: unknownVerifications,
      completed_tasks_with_passed_verification: completedWithPassed.count,
      verification_coverage: round(verificationCoverage),
      runs_completed: runsCompleted,
      runs_failed: runsFailed,
      run_success_rate: round(runSuccessRate),
      stale_task_locks: staleTaskLocks.length,
      stale_resource_locks: staleResourceLocks.length,
      handoffs_created: handoffs.length,
      handoffs_with_task_refs: handoffsWithTaskRefs,
      handoffs_with_blockers: handoffsWithBlockers,
      retry_count: retryRow.retry_count,
      max_retry_count: retryRow.max_retry_count,
    },
    evidence: {
      failed_tasks: failedTasks.map((task) => ({ ...task, title: redactEvidenceText(task.title) })),
      failed_verifications: failedVerificationEvidence.map((verification) => ({ ...verification, command: redactEvidenceText(verification.command) })),
      failed_runs: failedRunEvidence.map((run) => ({ ...run, title: run.title ? redactEvidenceText(run.title) : null })),
      stale_locks: [
        ...staleTaskLocks.map((lock) => ({ kind: "task" as const, id: lock.id, locked_at: lock.locked_at })),
        ...staleResourceLocks.map((lock) => ({ kind: "resource" as const, id: lock.resource_id, locked_at: lock.locked_at, resource_type: lock.resource_type })),
      ],
    },
    recommendations,
  };
}

export function listAgentReliabilityScorecards(
  options: AgentReliabilityScorecardOptions & { agent_id?: string; limit?: number } = {},
  db?: Database,
): AgentReliabilityScorecard[] {
  const d = getDatabase(db);
  const agents = options.agent_id
    ? (resolveAgent(options.agent_id, d) ? [resolveAgent(options.agent_id, d)!] : [])
    : d.query("SELECT id, name FROM agents ORDER BY name").all() as Array<{ id: string; name: string }>;
  const limit = Number.isFinite(options.limit) && options.limit! > 0 ? Math.min(Math.floor(options.limit!), 500) : 50;
  return agents
    .map((agent) => getAgentReliabilityScorecard(agent.id, options, d))
    .filter((scorecard): scorecard is AgentReliabilityScorecard => Boolean(scorecard))
    .filter((scorecard) => {
      const signals = scorecard.signals;
      return signals.tasks_completed + signals.tasks_failed + signals.tasks_in_progress + signals.runs_failed + signals.handoffs_created + signals.stale_task_locks + signals.stale_resource_locks > 0;
    })
    .sort((left, right) => right.score - left.score || left.agent_name.localeCompare(right.agent_name))
    .slice(0, limit);
}

export function createAgentReliabilityExport(
  options: AgentReliabilityScorecardOptions & { agent_id?: string; limit?: number } = {},
  db?: Database,
): AgentReliabilityExport {
  const scorecards = listAgentReliabilityScorecards(options, db);
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: now(),
    filters: {
      agent_id: options.agent_id || null,
      project_id: options.project_id || null,
      since: options.since || null,
      stale_after_hours: Number.isFinite(options.stale_after_hours) && options.stale_after_hours! > 0 ? Math.floor(options.stale_after_hours!) : 24,
    },
    count: scorecards.length,
    scorecards,
  };
}

export function renderAgentReliabilityMarkdown(report: AgentReliabilityExport | AgentReliabilityScorecard): string {
  const exportReport: AgentReliabilityExport = "scorecards" in report
    ? report
    : {
      schema_version: 1,
      local_only: true,
      no_network: true,
      generated_at: report.generated_at,
      filters: {
        agent_id: report.agent_id,
        project_id: report.scope.project_id,
        since: report.scope.since,
        stale_after_hours: report.scope.stale_after_hours,
      },
      count: 1,
      scorecards: [report],
    };
  const lines = [
    "# Agent Reliability Scorecards",
    "",
    `Generated: ${exportReport.generated_at}`,
    `Agents: ${exportReport.count}`,
    "",
  ];
  for (const scorecard of exportReport.scorecards) {
    lines.push(`## ${scorecard.agent_name}`, "");
    lines.push(`- Score: ${scorecard.score}/100`);
    lines.push(`- Grade: ${scorecard.grade}`);
    lines.push(`- Completed: ${scorecard.signals.tasks_completed}`);
    lines.push(`- Failed tasks: ${scorecard.signals.tasks_failed}`);
    lines.push(`- Failed verifications: ${scorecard.signals.failed_verifications}`);
    lines.push(`- Failed runs: ${scorecard.signals.runs_failed}`);
    lines.push(`- Stale locks: ${scorecard.signals.stale_task_locks + scorecard.signals.stale_resource_locks}`);
    lines.push(`- Retries: ${scorecard.signals.retry_count}`);
    lines.push("");
    for (const recommendation of scorecard.recommendations) lines.push(`- ${recommendation}`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
