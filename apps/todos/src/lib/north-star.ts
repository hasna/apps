import type { Database } from "bun:sqlite";
import { assignedToAliasSet, getDatabase, resolvePartialId } from "../db/database.js";
import { getActiveWork, getStaleTasks } from "../db/task-lifecycle.js";
import { getLastHeartbeat } from "../db/checkpoints.js";

export interface NorthStarSnapshot {
  timestamp: string;
  active_tasks: number;
  stale_tasks: number;
  completion_rate_per_hour: number;
  agents_online: AgentActivity[];
  top_agent: string | null;
  health: "healthy" | "degraded" | "critical";
}

export interface AgentActivity {
  agent_id: string;
  active_tasks: number;
  last_heartbeat?: string | null;
  completions_last_hour: number;
}

/**
 * 1-minute north star loop — fires every 60s to track progress.
 * Returns a snapshot of current system health and throughput.
 */
export function getNorthStarSnapshot(
  filters?: { project_id?: string },
  db?: Database,
): NorthStarSnapshot {
  const d = db || getDatabase();
  const active = getActiveWork(filters, d);
  const stale = getStaleTasks(30, filters, d);

  // Count completions in the last hour
  const conditions: string[] = ["completed_at > ?"];
  const params: (string | number)[] = [new Date(Date.now() - 60 * 60 * 1000).toISOString()];

  if (filters?.project_id) {
    conditions.push("project_id = ?");
    params.push(filters.project_id);
  }

  const recentCompletions = d.query(
    `SELECT COUNT(*) as count FROM tasks WHERE ${conditions.join(" AND ")}`,
  ).get(...params) as { count: number };

  // Alias-resolved (task 84c77210): `assigned_to` holds an agent id from one
  // write path and a resolved name from another — see database.ts for the
  // root cause. Bucketing by the raw string (as this did before) silently
  // split one real agent's activity into two disjoint buckets whenever some
  // of its tasks were recorded under the other form, which can misreport
  // `top_agent` — the exact "a rate/ranking nobody questions because it
  // carries no obvious scale" shape 84c77210 named for agent-metrics.
  // Canonicalise every raw key to the agent's registered id before it goes
  // into `agentMap`, so aliases of the same agent merge into one bucket.
  const canonicalAgentKey = (raw: string): string => {
    try {
      return resolvePartialId(d, "agents", raw) ?? raw;
    } catch {
      return raw;
    }
  };

  // Group active tasks by agent
  const agentMap = new Map<string, AgentActivity>();
  for (const task of active) {
    const agentId = canonicalAgentKey(task.assigned_to || task.locked_by || "unassigned");
    const existing = agentMap.get(agentId);
    if (existing) {
      existing.active_tasks++;
    } else {
      agentMap.set(agentId, {
        agent_id: agentId,
        active_tasks: 1,
        completions_last_hour: 0,
      });
    }
  }

  // Count completions per agent
  const agentCompletions = d.query(
    `SELECT assigned_to, COUNT(*) as count FROM tasks
     WHERE completed_at > ? AND assigned_to IS NOT NULL
     GROUP BY assigned_to`,
  ).all(new Date(Date.now() - 60 * 60 * 1000).toISOString()) as { assigned_to: string; count: number }[];

  // GROUP BY on the raw column splits one agent's completions across its
  // alias forms just like the active-work bucketing above, so canonicalise
  // here too and ADD into an existing bucket rather than overwrite — two raw
  // rows can canonicalise to the same agent.
  for (const row of agentCompletions) {
    const canonicalId = canonicalAgentKey(row.assigned_to);
    const agent = agentMap.get(canonicalId);
    if (agent) {
      agent.completions_last_hour += row.count;
    } else {
      agentMap.set(canonicalId, {
        agent_id: canonicalId,
        active_tasks: 0,
        completions_last_hour: row.count,
      });
    }
  }

  // Get last heartbeats for active agents
  for (const agent of agentMap.values()) {
    // Get last heartbeat for this agent's first active task. `agent.agent_id`
    // is canonicalised above; `t.assigned_to` on the raw task is not, so
    // match it via the same alias set rather than a bare `===`.
    const agentAliases = assignedToAliasSet(d, agent.agent_id);
    const agentTask = active.find(t => agentAliases.has((t.assigned_to ?? "").toLowerCase()) || t.locked_by === agent.agent_id);
    if (agentTask) {
      const hb = getLastHeartbeat(agentTask.id, d);
      if (hb) agent.last_heartbeat = hb.created_at;
    }
  }

  const agents = Array.from(agentMap.values());
  const topAgent = agents.sort((a, b) => b.completions_last_hour - a.completions_last_hour)[0]?.agent_id ?? null;

  // Health scoring
  const health = computeHealth({
    activeCount: active.length,
    staleCount: stale.length,
    completionRate: recentCompletions.count,
    agentCount: agents.length,
  });

  return {
    timestamp: new Date().toISOString(),
    active_tasks: active.length,
    stale_tasks: stale.length,
    completion_rate_per_hour: recentCompletions.count,
    agents_online: agents,
    top_agent: topAgent,
    health,
  };
}

function computeHealth(metrics: {
  activeCount: number;
  staleCount: number;
  completionRate: number;
  agentCount: number;
}): "healthy" | "degraded" | "critical" {
  // Critical: more stale tasks than active, or zero completions with active tasks
  if (metrics.staleCount > metrics.activeCount || (metrics.activeCount > 0 && metrics.completionRate === 0 && metrics.agentCount === 0)) {
    return "critical";
  }

  // Degraded: any stale tasks or low throughput
  if (metrics.staleCount > 0 || metrics.completionRate < 2) {
    return "degraded";
  }

  return "healthy";
}

/**
 * Start a recurring north star loop that logs snapshots.
 * Returns a stop function.
 */
export function startNorthStarLoop(
  opts?: { interval_ms?: number; project_id?: string; logger?: (snapshot: NorthStarSnapshot) => void },
): () => void {
  const intervalMs = opts?.interval_ms ?? 60_000;
  const logger = opts?.logger ?? defaultLogger;

  const timer = setInterval(() => {
    const snapshot = getNorthStarSnapshot(opts?.project_id ? { project_id: opts.project_id } : undefined);
    logger(snapshot);
  }, intervalMs);

  timer.unref?.();

  return () => clearInterval(timer);
}

function defaultLogger(snapshot: NorthStarSnapshot) {
  console.log(
    `[north-star] ${snapshot.timestamp} | active:${snapshot.active_tasks} stale:${snapshot.stale_tasks} | ${snapshot.completion_rate_per_hour}/hr | health:${snapshot.health}`,
  );
}
