import type { Database, SQLQueryBindings } from "bun:sqlite";
import { getDatabase, lowerInClause, now, resolveAssignedToAliases } from "./database.js";
import { countTasks } from "./tasks.js";

export interface AgentBudget {
  agent_id: string;
  max_concurrent: number;
  max_cost_usd: number | null;
  max_task_minutes: number | null;
  period_hours: number;
  created_at: string;
  updated_at: string;
}

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  current_concurrent: number;
  max_concurrent: number;
  current_cost_usd?: number;
  max_cost_usd?: number;
}

export function setBudget(
  agentId: string,
  opts: { max_concurrent?: number; max_cost_usd?: number | null; max_task_minutes?: number | null; period_hours?: number },
  db?: Database,
): AgentBudget {
  const d = db || getDatabase();
  const timestamp = now();
  d.run(
    `INSERT INTO agent_budgets (agent_id, max_concurrent, max_cost_usd, max_task_minutes, period_hours, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(agent_id) DO UPDATE SET
       max_concurrent = COALESCE(?, max_concurrent),
       max_cost_usd = COALESCE(?, max_cost_usd),
       max_task_minutes = COALESCE(?, max_task_minutes),
       period_hours = COALESCE(?, period_hours),
       updated_at = ?`,
    [agentId, opts.max_concurrent ?? 5, opts.max_cost_usd ?? null, opts.max_task_minutes ?? null, opts.period_hours ?? 24, timestamp, timestamp,
     opts.max_concurrent ?? null, opts.max_cost_usd ?? null, opts.max_task_minutes ?? null, opts.period_hours ?? null, timestamp],
  );
  return getBudget(agentId, d)!;
}

export function getBudget(agentId: string, db?: Database): AgentBudget | null {
  const d = db || getDatabase();
  return d.query("SELECT * FROM agent_budgets WHERE agent_id = ?").get(agentId) as AgentBudget | null;
}

export function checkBudget(agentId: string, db?: Database): BudgetCheck {
  const d = db || getDatabase();
  const budget = getBudget(agentId, d);
  if (!budget) return { allowed: true, current_concurrent: 0, max_concurrent: 999 };

  // Check concurrent tasks. Already alias-resolved transitively: `countTasks`
  // (task-crud.ts) applies the shared `assigned_to` resolver itself (PR
  // #160) — no change needed at this call site.
  const concurrent = countTasks({ status: "in_progress", assigned_to: agentId }, d);
  if (concurrent >= budget.max_concurrent) {
    return { allowed: false, reason: `Concurrent limit reached (${concurrent}/${budget.max_concurrent})`, current_concurrent: concurrent, max_concurrent: budget.max_concurrent };
  }

  // Check cost in period. This one is NOT transitively covered — it is its
  // own raw query, unlike the concurrency check above. Alias-resolved
  // (task 84c77210) for the `assigned_to` leg — see database.ts for the
  // root cause.
  if (budget.max_cost_usd != null) {
    const periodStart = new Date(Date.now() - budget.period_hours * 60 * 60 * 1000).toISOString();
    const costParams: SQLQueryBindings[] = [];
    const assignedInClause = lowerInClause("assigned_to", resolveAssignedToAliases(d, agentId), costParams);
    const costRow = d.query(
      `SELECT COALESCE(SUM(cost_usd), 0) as total FROM tasks WHERE (${assignedInClause} OR agent_id = ?) AND updated_at > ?`
    ).get(...costParams, agentId, periodStart) as { total: number };
    if (costRow.total >= budget.max_cost_usd) {
      return { allowed: false, reason: `Cost limit reached ($${costRow.total.toFixed(2)}/$${budget.max_cost_usd.toFixed(2)} in ${budget.period_hours}h)`, current_concurrent: concurrent, max_concurrent: budget.max_concurrent, current_cost_usd: costRow.total, max_cost_usd: budget.max_cost_usd };
    }
  }

  return { allowed: true, current_concurrent: concurrent, max_concurrent: budget.max_concurrent };
}
