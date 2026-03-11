import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { listAgents } from "../db/agents.js";
import { listTasks } from "../db/tasks.js";
import type { Task } from "../types/index.js";

/**
 * Find the best agent to assign a task to.
 * Strategy: least-loaded agent with role "agent" (not admin/observer).
 * Returns agent name or null if no agents available.
 */
export function findBestAgent(task: Task, db?: Database): string | null {
  const d = db || getDatabase();
  const agents = listAgents(d).filter(a => (a.role || "agent") === "agent");
  if (agents.length === 0) return null;

  const inProgressTasks = listTasks({ status: "in_progress" as any }, d);

  // Count in-progress tasks per agent
  const load = new Map<string, number>();
  for (const a of agents) load.set(a.name, 0);
  for (const t of inProgressTasks) {
    const name = t.assigned_to || t.agent_id;
    if (name && load.has(name)) {
      load.set(name, (load.get(name) || 0) + 1);
    }
  }

  // Pick agent with lowest load
  let bestAgent = agents[0]!.name;
  let bestLoad = load.get(bestAgent) ?? 0;
  for (const a of agents) {
    const l = load.get(a.name) ?? 0;
    if (l < bestLoad) {
      bestAgent = a.name;
      bestLoad = l;
    }
  }

  return bestAgent;
}
