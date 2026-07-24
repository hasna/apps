/**
 * Auto-assign tasks to agents using local capability and workload data only.
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getTask, updateTask, listTasks } from "../db/tasks.js";
import { listAgents, getCapableAgents } from "../db/agents.js";
import type { Task } from "../types/index.js";

export interface AutoAssignResult {
  task_id: string;
  assigned_to: string | null;
  agent_name: string | null;
  method: "capability_match" | "no_agents";
  reason?: string;
}

/**
 * Find the best agent to assign a task to (legacy simple version, no I/O).
 * Strategy: least-loaded agent with role "agent" (not admin/observer).
 */
export function findBestAgent(_task: Task, db?: Database): string | null {
  const d = getDatabase(db);
  const agents = listAgents(d).filter(a => (a.role || "agent") === "agent");
  if (agents.length === 0) return null;

  const inProgressTasks = listTasks({ status: "in_progress" as any }, d);
  const idToName = new Map<string, string>();
  const load = new Map<string, number>();
  for (const a of agents) {
    idToName.set(a.id, a.name);
    load.set(a.id, 0);
  }
  for (const t of inProgressTasks) {
    const agentId = t.assigned_to || t.agent_id;
    if (agentId && load.has(agentId)) {
      load.set(agentId, (load.get(agentId) || 0) + 1);
    }
  }

  let bestAgent = agents[0]!.name;
  let bestLoad = load.get(agents[0]!.id) ?? 0;
  for (const a of agents) {
    const l = load.get(a.id) ?? 0;
    if (l < bestLoad) { bestAgent = a.name; bestLoad = l; }
  }
  return bestAgent;
}

function getAgentWorkloads(d: Database): Map<string, number> {
  const rows = d.query(
    "SELECT assigned_to, COUNT(*) as count FROM tasks WHERE status = 'in_progress' AND assigned_to IS NOT NULL GROUP BY assigned_to"
  ).all() as Array<{ assigned_to: string; count: number }>;
  return new Map(rows.map(r => [r.assigned_to, r.count]));
}

/**
 * Auto-assign a task to the best available agent.
 * Uses only local SQLite state and never calls hosted provider APIs.
 */
export async function autoAssignTask(taskId: string, db?: Database): Promise<AutoAssignResult> {
  const d = getDatabase(db);
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const agents = listAgents(d).filter(a => a.status === "active");
  if (agents.length === 0) {
    return { task_id: taskId, assigned_to: null, agent_name: null, method: "no_agents" };
  }

  const workloads = getAgentWorkloads(d);
  let selectedAgent: (typeof agents)[number] | null = null;
  let method: AutoAssignResult["method"] = "capability_match";
  let reason: string | undefined;

  // Fallback: capability-based matching
  if (!selectedAgent) {
    const taskTags = task.tags || [];
    const capable = getCapableAgents(taskTags, { min_score: 0.0, limit: 10 }, d);
    if (capable.length > 0) {
      const sorted = capable.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (workloads.get(a.agent.id) ?? 0) - (workloads.get(b.agent.id) ?? 0);
      });
      selectedAgent = sorted[0]!.agent;
      reason = `Capability match (score: ${sorted[0]!.score.toFixed(2)})`;
    } else {
      selectedAgent = agents.slice().sort((a, b) =>
        (workloads.get(a.id) ?? 0) - (workloads.get(b.id) ?? 0)
      )[0]!;
      reason = `Least busy agent (${workloads.get(selectedAgent.id) ?? 0} active tasks)`;
    }
  }

  if (selectedAgent) {
    updateTask(taskId, { assigned_to: selectedAgent.id, version: task.version }, d);
  }

  return {
    task_id: taskId,
    assigned_to: selectedAgent?.id ?? null,
    agent_name: selectedAgent?.name ?? null,
    method,
    reason,
  };
}
