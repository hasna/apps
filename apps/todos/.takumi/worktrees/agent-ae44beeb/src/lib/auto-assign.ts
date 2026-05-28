/**
 * Auto-assign tasks to agents using Cerebras LLM for intelligent routing.
 * Falls back to capability-based matching when the API key is unavailable or the call fails.
 */

import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getTask, updateTask, listTasks } from "../db/tasks.js";
import { listAgents, getCapableAgents } from "../db/agents.js";
import type { Task } from "../types/index.js";

const CEREBRAS_API_URL = "https://api.cerebras.ai/v1/chat/completions";
const CEREBRAS_MODEL = "llama-3.3-70b";

export interface AutoAssignResult {
  task_id: string;
  assigned_to: string | null;
  agent_name: string | null;
  method: "cerebras" | "capability_match" | "no_agents";
  reason?: string;
}

/**
 * Find the best agent to assign a task to (legacy simple version, no I/O).
 * Strategy: least-loaded agent with role "agent" (not admin/observer).
 */
export function findBestAgent(_task: Task, db?: Database): string | null {
  const d = db || getDatabase();
  const agents = listAgents(d).filter(a => (a.role || "agent") === "agent");
  if (agents.length === 0) return null;

  const inProgressTasks = listTasks({ status: "in_progress" as any }, d);
  const load = new Map<string, number>();
  for (const a of agents) load.set(a.name, 0);
  for (const t of inProgressTasks) {
    const name = t.assigned_to || t.agent_id;
    if (name && load.has(name)) {
      load.set(name, (load.get(name) || 0) + 1);
    }
  }

  let bestAgent = agents[0]!.name;
  let bestLoad = load.get(bestAgent) ?? 0;
  for (const a of agents) {
    const l = load.get(a.name) ?? 0;
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

function buildPrompt(
  task: { title: string; description?: string | null; priority: string; tags: string[] },
  agents: Array<{ id: string; name: string; role: string; capabilities: string[]; in_progress_tasks: number }>
): string {
  const agentList = agents.map(a =>
    `- ${a.name} (role: ${a.role}, caps: [${a.capabilities.join(", ")}], active_tasks: ${a.in_progress_tasks})`
  ).join("\n");

  return `You are a task routing assistant. Given a task and available agents, choose the SINGLE best agent.

TASK:
Title: ${task.title}
Priority: ${task.priority}
Tags: ${task.tags.join(", ") || "none"}
Description: ${task.description?.slice(0, 300) || "none"}

AVAILABLE AGENTS:
${agentList}

Rules:
- Match task tags/content to agent capabilities
- Prefer agents with fewer active tasks
- Prefer agents whose role fits the task (lead for critical, developer for features, qa for testing)
- If no clear match, pick the agent with fewest active tasks

Respond with ONLY a JSON object: {"agent_name": "<name>", "reason": "<one sentence>"}`;
}

async function callCerebras(prompt: string, apiKey: string): Promise<{ agent_name: string; reason: string } | null> {
  try {
    const resp = await fetch(CEREBRAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as any;
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    const match = content.match(/\{[^}]+\}/s);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/**
 * Auto-assign a task to the best available agent.
 * Uses Cerebras LLM (llama-3.3-70b) if CEREBRAS_API_KEY is set,
 * otherwise falls back to capability-based matching.
 */
export async function autoAssignTask(taskId: string, db?: Database): Promise<AutoAssignResult> {
  const d = db || getDatabase();
  const task = getTask(taskId, d);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const agents = listAgents(d).filter(a => a.status === "active");
  if (agents.length === 0) {
    return { task_id: taskId, assigned_to: null, agent_name: null, method: "no_agents" };
  }

  const workloads = getAgentWorkloads(d);
  const apiKey = process.env["CEREBRAS_API_KEY"];
  let selectedAgent: (typeof agents)[number] | null = null;
  let method: AutoAssignResult["method"] = "capability_match";
  let reason: string | undefined;

  if (apiKey) {
    const agentData = agents.map(a => ({
      id: a.id, name: a.name, role: a.role || "agent",
      capabilities: a.capabilities || [],
      in_progress_tasks: workloads.get(a.id) ?? 0,
    }));
    const result = await callCerebras(buildPrompt({
      title: task.title, description: task.description,
      priority: task.priority, tags: task.tags || [],
    }, agentData), apiKey);
    if (result?.agent_name) {
      selectedAgent = agents.find(a => a.name === result.agent_name) ?? null;
      if (selectedAgent) { method = "cerebras"; reason = result.reason; }
    }
  }

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
