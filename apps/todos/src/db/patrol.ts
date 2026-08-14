import type { Database } from "bun:sqlite";
import type { Task, TaskRow } from "../types/index.js";
import { getDatabase } from "./database.js";

// Re-use rowToTask from tasks.ts pattern
function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    requires_approval: Boolean(row.requires_approval),
  };
}

export interface PatrolIssue {
  type: "stuck" | "low_confidence" | "orphaned" | "needs_review" | "zombie_blocked";
  task_id: string;
  task_title: string;
  severity: "low" | "medium" | "high" | "critical";
  detail: string;
}

export interface PatrolResult {
  issues: PatrolIssue[];
  total_issues: number;
  scanned_at: string;
}

/**
 * Patrol tasks for issues:
 * - stuck: in_progress for longer than threshold
 * - low_confidence: completed with confidence below threshold
 * - orphaned: no project, no agent, not completed
 * - needs_review: requires_approval but not approved, and completed
 * - zombie_blocked: pending tasks whose blockers are all failed/cancelled
 */
export function patrolTasks(
  opts?: {
    stuck_minutes?: number;
    confidence_threshold?: number;
    project_id?: string;
  },
  db?: Database,
): PatrolResult {
  const d = db || getDatabase();
  const stuckMinutes = opts?.stuck_minutes || 60;
  const confidenceThreshold = opts?.confidence_threshold || 0.5;
  const issues: PatrolIssue[] = [];

  let projectFilter = "";
  const projectParams: string[] = [];
  if (opts?.project_id) {
    projectFilter = " AND project_id = ?";
    projectParams.push(opts.project_id);
  }

  // 1. Stuck tasks (in_progress for too long)
  const stuckCutoff = new Date(Date.now() - stuckMinutes * 60 * 1000).toISOString();
  const stuckRows = d.query(
    `SELECT * FROM tasks WHERE status = 'in_progress' AND updated_at < ?${projectFilter} ORDER BY updated_at ASC`,
  ).all(stuckCutoff, ...projectParams) as TaskRow[];

  for (const row of stuckRows) {
    const task = rowToTask(row);
    const minutesStuck = Math.round((Date.now() - new Date(task.updated_at).getTime()) / 60000);
    issues.push({
      type: "stuck",
      task_id: task.id,
      task_title: task.title,
      severity: minutesStuck > 480 ? "critical" : minutesStuck > 120 ? "high" : "medium",
      detail: `In progress for ${minutesStuck} minutes without update`,
    });
  }

  // 2. Low confidence completions
  const lowConfRows = d.query(
    `SELECT * FROM tasks WHERE status = 'completed' AND confidence IS NOT NULL AND confidence < ?${projectFilter} ORDER BY confidence ASC`,
  ).all(confidenceThreshold, ...projectParams) as TaskRow[];

  for (const row of lowConfRows) {
    const task = rowToTask(row);
    issues.push({
      type: "low_confidence",
      task_id: task.id,
      task_title: task.title,
      severity: (task.confidence ?? 0) < 0.3 ? "high" : "medium",
      detail: `Completed with confidence ${task.confidence} (threshold: ${confidenceThreshold})`,
    });
  }

  // 3. Orphaned tasks (no project AND no agent, still pending)
  const orphanedRows = d.query(
    `SELECT * FROM tasks WHERE status = 'pending' AND project_id IS NULL AND agent_id IS NULL AND assigned_to IS NULL ORDER BY created_at ASC`,
  ).all() as TaskRow[];

  for (const row of orphanedRows) {
    const task = rowToTask(row);
    issues.push({
      type: "orphaned",
      task_id: task.id,
      task_title: task.title,
      severity: "low",
      detail: "Pending task with no project, no agent, and no assignee",
    });
  }

  // 4. Needs review (completed + requires_approval but not approved)
  const needsReviewRows = d.query(
    `SELECT * FROM tasks WHERE status = 'completed' AND requires_approval = 1 AND approved_by IS NULL${projectFilter} ORDER BY completed_at DESC`,
  ).all(...projectParams) as TaskRow[];

  for (const row of needsReviewRows) {
    const task = rowToTask(row);
    issues.push({
      type: "needs_review",
      task_id: task.id,
      task_title: task.title,
      severity: "medium",
      detail: "Completed but requires approval — not yet reviewed",
    });
  }

  // 5. Zombie blocked: pending tasks where ALL blockers are failed or cancelled
  const pendingWithDeps = d.query(
    `SELECT t.* FROM tasks t
     WHERE t.status = 'pending'${projectFilter}
       AND t.id IN (SELECT task_id FROM task_dependencies)`,
  ).all(...projectParams) as TaskRow[];

  for (const row of pendingWithDeps) {
    const deps = d.query(
      `SELECT d.depends_on, t.status FROM task_dependencies d
       JOIN tasks t ON t.id = d.depends_on
       WHERE d.task_id = ?`,
    ).all(row.id) as { depends_on: string; status: string }[];

    if (deps.length > 0 && deps.every(dep => dep.status === "failed" || dep.status === "cancelled")) {
      const task = rowToTask(row);
      issues.push({
        type: "zombie_blocked",
        task_id: task.id,
        task_title: task.title,
        severity: "high",
        detail: `Blocked by ${deps.length} task(s) that are all failed/cancelled — will never unblock`,
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return {
    issues,
    total_issues: issues.length,
    scanned_at: new Date().toISOString(),
  };
}

/**
 * Get review queue: tasks that need human/agent review.
 */
export function getReviewQueue(
  opts?: { project_id?: string; limit?: number },
  db?: Database,
): Task[] {
  const d = db || getDatabase();
  let sql = `SELECT * FROM tasks WHERE status = 'completed' AND (
    (requires_approval = 1 AND approved_by IS NULL)
    OR (confidence IS NOT NULL AND confidence < 0.5)
  )`;
  const params: (string | number)[] = [];
  if (opts?.project_id) {
    sql += " AND project_id = ?";
    params.push(opts.project_id);
  }
  sql += " ORDER BY CASE WHEN requires_approval = 1 AND approved_by IS NULL THEN 0 ELSE 1 END, confidence ASC";
  if (opts?.limit) {
    sql += " LIMIT ?";
    params.push(opts.limit);
  }

  return (d.query(sql).all(...params) as TaskRow[]).map(rowToTask);
}
