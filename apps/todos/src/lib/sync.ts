import type { SyncPrefer, SyncResult } from "./sync-types.js";
import { pullFromClaudeTaskList, pushToClaudeTaskList, syncClaudeTaskList } from "./claude-tasks.js";
import { pullFromAgentTaskList, pushToAgentTaskList, syncAgentTaskList } from "./agent-tasks.js";
import { getSyncAgentsFromConfig } from "./config.js";

export type SyncDirection = "push" | "pull" | "both";
export interface SyncOptions {
  prefer?: SyncPrefer;
}

function normalizeAgent(agent: string): string {
  return agent.trim().toLowerCase();
}

function isClaudeAgent(agent: string): boolean {
  const a = normalizeAgent(agent);
  return a === "claude" || a === "claude-code" || a === "claude_code";
}

export function defaultSyncAgents(): string[] {
  const env = process.env["TODOS_SYNC_AGENTS"];
  if (env) {
    return env.split(",").map((a) => a.trim()).filter(Boolean);
  }
  const fromConfig = getSyncAgentsFromConfig();
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  return ["claude", "codex", "gemini"];
}

export function syncWithAgent(
  agent: string,
  taskListId: string,
  projectId?: string,
  direction: SyncDirection = "both",
  options: SyncOptions = {},
): SyncResult {
  const normalized = normalizeAgent(agent);
  if (isClaudeAgent(normalized)) {
    if (direction === "push") return pushToClaudeTaskList(taskListId, projectId, options);
    if (direction === "pull") return pullFromClaudeTaskList(taskListId, projectId, options);
    return syncClaudeTaskList(taskListId, projectId, options);
  }

  if (direction === "push") return pushToAgentTaskList(normalized, taskListId, projectId, options);
  if (direction === "pull") return pullFromAgentTaskList(normalized, taskListId, projectId, options);
  return syncAgentTaskList(normalized, taskListId, projectId, options);
}

export function syncWithAgents(
  agents: string[],
  taskListIdByAgent: (agent: string) => string | null,
  projectId?: string,
  direction: SyncDirection = "both",
  options: SyncOptions = {},
): SyncResult {
  let pushed = 0;
  let pulled = 0;
  const errors: string[] = [];

  const normalized = agents.map(normalizeAgent);

  if (direction === "pull" || direction === "both") {
    for (const agent of normalized) {
      const listId = taskListIdByAgent(agent);
      if (!listId) {
        errors.push(`sync ${agent}: missing task list id`);
        continue;
      }
      const result = syncWithAgent(agent, listId, projectId, "pull", options);
      pushed += result.pushed;
      pulled += result.pulled;
      errors.push(...result.errors.map((e) => `${agent}: ${e}`));
    }
  }

  if (direction === "push" || direction === "both") {
    for (const agent of normalized) {
      const listId = taskListIdByAgent(agent);
      if (!listId) {
        errors.push(`sync ${agent}: missing task list id`);
        continue;
      }
      const result = syncWithAgent(agent, listId, projectId, "push", options);
      pushed += result.pushed;
      pulled += result.pulled;
      errors.push(...result.errors.map((e) => `${agent}: ${e}`));
    }
  }

  return { pushed, pulled, errors };
}
