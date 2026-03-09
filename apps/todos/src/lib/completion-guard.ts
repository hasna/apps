import type { Database } from "bun:sqlite";
import type { Task } from "../types/index.js";
import { CompletionGuardError } from "../types/index.js";
import { getCompletionGuardConfig, type CompletionGuardConfig } from "./config.js";
import { getProject } from "../db/projects.js";

/**
 * Checks completion guards before allowing a task to be marked as completed.
 * Throws CompletionGuardError if any guard condition is violated.
 *
 * Guards:
 * 1. Status check — task must be in_progress
 * 2. Minimum work duration — must have spent enough time since startTask()
 * 3. Rate limit — max completions per agent per time window
 * 4. Cooldown — minimum gap between consecutive completions
 *
 * @param configOverride - Optional config override (used in tests)
 */
export function checkCompletionGuard(
  task: Task,
  agentId: string | null,
  db: Database,
  configOverride?: Required<CompletionGuardConfig>,
): void {
  let config: Required<CompletionGuardConfig>;
  if (configOverride) {
    config = configOverride;
  } else {
    const projectPath = task.project_id ? getProject(task.project_id, db)?.path : null;
    config = getCompletionGuardConfig(projectPath);
  }

  if (!config.enabled) return;

  // 1. Require in_progress status
  if (task.status !== "in_progress") {
    throw new CompletionGuardError(
      `Task must be in 'in_progress' status before completing (current: '${task.status}'). Use start_task first.`,
    );
  }

  const agent = agentId || task.assigned_to || task.agent_id;

  // 2. Minimum work duration (uses locked_at from startTask)
  if (config.min_work_seconds && task.locked_at) {
    const startedAt = new Date(task.locked_at).getTime();
    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    if (elapsedSeconds < config.min_work_seconds) {
      const remaining = Math.ceil(config.min_work_seconds - elapsedSeconds);
      throw new CompletionGuardError(
        `Too fast: task was started ${Math.floor(elapsedSeconds)}s ago. Minimum work duration is ${config.min_work_seconds}s. Wait ${remaining}s.`,
        remaining,
      );
    }
  }

  // 3. Rate limit (agent-scoped)
  if (agent && config.max_completions_per_window && config.window_minutes) {
    const windowStart = new Date(
      Date.now() - config.window_minutes * 60 * 1000,
    ).toISOString();
    const result = db
      .query(
        `SELECT COUNT(*) as count FROM tasks
         WHERE completed_at > ? AND (assigned_to = ? OR agent_id = ?)`,
      )
      .get(windowStart, agent, agent) as { count: number };

    if (result.count >= config.max_completions_per_window) {
      throw new CompletionGuardError(
        `Rate limit: ${result.count} tasks completed in the last ${config.window_minutes} minutes (max ${config.max_completions_per_window}). Slow down.`,
      );
    }
  }

  // 4. Cooldown between completions (agent-scoped)
  if (agent && config.cooldown_seconds) {
    const result = db
      .query(
        `SELECT MAX(completed_at) as last_completed FROM tasks
         WHERE completed_at IS NOT NULL AND (assigned_to = ? OR agent_id = ?) AND id != ?`,
      )
      .get(agent, agent, task.id) as { last_completed: string | null };

    if (result.last_completed) {
      const elapsedSeconds =
        (Date.now() - new Date(result.last_completed).getTime()) / 1000;
      if (elapsedSeconds < config.cooldown_seconds) {
        const remaining = Math.ceil(config.cooldown_seconds - elapsedSeconds);
        throw new CompletionGuardError(
          `Cooldown: last completion was ${Math.floor(elapsedSeconds)}s ago. Wait ${remaining}s between completions.`,
          remaining,
        );
      }
    }
  }
}
