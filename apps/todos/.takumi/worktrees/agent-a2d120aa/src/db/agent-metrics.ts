import type { Database } from "bun:sqlite";
import { getDatabase, now } from "./database.js";

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

/**
 * Compute metrics for a single agent from task data.
 */
export function getAgentMetrics(agentId: string, opts?: { project_id?: string }, db?: Database): AgentMetrics | null {
  const d = db || getDatabase();

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
  const d = db || getDatabase();
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
  const d = db || getDatabase();
  if (score < 0 || score > 1) throw new Error("Score must be between 0 and 1");

  const task = d.query("SELECT metadata FROM tasks WHERE id = ?").get(taskId) as { metadata: string } | null;
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const metadata = JSON.parse(task.metadata || "{}");
  metadata._review_score = score;
  if (reviewerId) metadata._reviewed_by = reviewerId;
  metadata._reviewed_at = now();

  d.run("UPDATE tasks SET metadata = ?, updated_at = ? WHERE id = ?", [JSON.stringify(metadata), now(), taskId]);
}
