/**
 * Local agent run dispatcher — queue task/plan runs, claim one at a time,
 * record status transitions and evidence. No hosted API required.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";

export const AGENT_RUN_SCHEMA_VERSION = "todos.agent_run.v1";

export const AGENT_RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const AGENT_ADAPTER_TYPES = ["stdio", "tmux", "script"] as const;
export type AgentAdapterType = (typeof AGENT_ADAPTER_TYPES)[number];

export interface AgentAdapterConfig {
  name: string;
  type: AgentAdapterType;
  /** script adapter: shell command template with {task_id} placeholders */
  command?: string;
  /** tmux adapter: session:window.pane target */
  target?: string;
  sandbox_profile?: string;
  description?: string;
}

export interface AgentRun {
  schema_version: typeof AGENT_RUN_SCHEMA_VERSION;
  id: string;
  task_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  adapter: string;
  status: AgentRunStatus;
  evidence: Record<string, unknown>;
  error: string | null;
  retry_count: number;
  max_retries: number;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueAgentRunInput {
  task_id?: string;
  plan_id?: string;
  adapter: string;
  agent_id?: string;
  max_retries?: number;
  evidence?: Record<string, unknown>;
}

export interface ListAgentRunsFilter {
  status?: AgentRunStatus | AgentRunStatus[];
  adapter?: string;
  agent_id?: string;
  task_id?: string;
  plan_id?: string;
  limit?: number;
  offset?: number;
}

export interface AgentAdaptersFile {
  adapters: AgentAdapterConfig[];
}

function getAdaptersPath(): string {
  if (process.env["TODOS_AGENT_ADAPTERS_PATH"]) {
    return process.env["TODOS_AGENT_ADAPTERS_PATH"];
  }
  const local = join(process.cwd(), ".todos", "agent-adapters.json");
  if (existsSync(local)) return local;
  const home = process.env["HOME"] || "~";
  return join(home, ".hasna", "todos", "agent-adapters.json");
}

let cachedAdapters: AgentAdapterConfig[] | null = null;

export function resetAgentAdapterCache(): void {
  cachedAdapters = null;
}

export function getDefaultAgentAdapters(): AgentAdapterConfig[] {
  return [
    {
      name: "claude",
      type: "script",
      command: "claude --dangerously-skip-permissions",
      sandbox_profile: "default",
      description: "Claude Code CLI (local)",
    },
    {
      name: "codex",
      type: "script",
      command: "codex",
      sandbox_profile: "default",
      description: "OpenAI Codex CLI (local)",
    },
    {
      name: "cursor",
      type: "script",
      command: "cursor-agent",
      sandbox_profile: "default",
      description: "Cursor agent CLI (local)",
    },
    {
      name: "takumi",
      type: "script",
      command: "takumi --dangerously-skip-permissions",
      sandbox_profile: "default",
      description: "Takumi CLI (local)",
    },
    {
      name: "tmux",
      type: "tmux",
      target: "agents:0",
      description: "Send work to a local tmux pane",
    },
  ];
}

export function loadAgentAdapters(): AgentAdapterConfig[] {
  if (cachedAdapters) return cachedAdapters;
  const path = getAdaptersPath();
  if (!existsSync(path)) {
    cachedAdapters = getDefaultAgentAdapters();
    return cachedAdapters;
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as AgentAdaptersFile;
  cachedAdapters = parsed.adapters?.length ? parsed.adapters : getDefaultAgentAdapters();
  return cachedAdapters;
}

export function saveAgentAdapters(adapters: AgentAdapterConfig[]): void {
  const path = getAdaptersPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ adapters }, null, 2));
  cachedAdapters = adapters;
}

export function getAgentAdapter(name: string): AgentAdapterConfig | null {
  return loadAgentAdapters().find((a) => a.name === name) ?? null;
}

function rowToRun(row: Record<string, unknown>): AgentRun {
  return {
    schema_version: AGENT_RUN_SCHEMA_VERSION,
    id: row.id as string,
    task_id: (row.task_id as string) ?? null,
    plan_id: (row.plan_id as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    adapter: row.adapter as string,
    status: row.status as AgentRunStatus,
    evidence: row.evidence ? JSON.parse(row.evidence as string) : {},
    error: (row.error as string) ?? null,
    retry_count: row.retry_count as number,
    max_retries: row.max_retries as number,
    claimed_at: (row.claimed_at as string) ?? null,
    started_at: (row.started_at as string) ?? null,
    completed_at: (row.completed_at as string) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function requireAdapter(name: string): AgentAdapterConfig {
  const adapter = getAgentAdapter(name);
  if (!adapter) throw new Error(`Unknown agent adapter: ${name}`);
  return adapter;
}

export function enqueueAgentRun(input: EnqueueAgentRunInput, db?: Database): AgentRun {
  if (!input.task_id && !input.plan_id) {
    throw new Error("Either task_id or plan_id is required");
  }
  requireAdapter(input.adapter);

  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  const evidence = {
    adapter_type: getAgentAdapter(input.adapter)!.type,
    ...(input.evidence ?? {}),
  };

  d.run(
    `INSERT INTO agent_runs (
      id, task_id, plan_id, agent_id, adapter, status, evidence,
      retry_count, max_retries, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'queued', ?, 0, ?, ?, ?)`,
    [
      id,
      input.task_id ?? null,
      input.plan_id ?? null,
      input.agent_id ?? null,
      input.adapter,
      JSON.stringify(evidence),
      input.max_retries ?? 3,
      ts,
      ts,
    ],
  );

  const row = d.query("SELECT * FROM agent_runs WHERE id = ?").get(id) as Record<string, unknown>;
  return rowToRun(row);
}

export function getAgentRun(id: string, db?: Database): AgentRun | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM agent_runs WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToRun(row) : null;
}

export function listAgentRuns(filter: ListAgentRunsFilter = {}, db?: Database): AgentRun[] {
  const d = db || getDatabase();
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (filter.adapter) {
    conditions.push("adapter = ?");
    params.push(filter.adapter);
  }
  if (filter.agent_id) {
    conditions.push("agent_id = ?");
    params.push(filter.agent_id);
  }
  if (filter.task_id) {
    conditions.push("task_id = ?");
    params.push(filter.task_id);
  }
  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM agent_runs WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT ? OFFSET ?`;
  const rows = d.query(sql).all(...[...params, limit, offset] as any) as Record<string, unknown>[];
  return rows.map(rowToRun);
}

export function claimNextAgentRun(
  agentId: string,
  options: { adapter?: string } = {},
  db?: Database,
): AgentRun | null {
  const d = db || getDatabase();

  const tx = d.transaction(() => {
    const conditions = ["status = 'queued'"];
    const params: unknown[] = [];
    if (options.adapter) {
      conditions.push("adapter = ?");
      params.push(options.adapter);
    }

    const row = d
      .query(`SELECT * FROM agent_runs WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT 1`)
      .get(...params) as Record<string, unknown> | null;

    if (!row) return null;

    const ts = now();
    d.run(
      `UPDATE agent_runs SET status = 'running', agent_id = ?, claimed_at = ?, started_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`,
      [agentId, ts, ts, ts, row.id],
    );

    const updated = d.query("SELECT * FROM agent_runs WHERE id = ?").get(row.id) as Record<string, unknown>;
    if (updated.status !== "running") return null;
    return rowToRun(updated);
  });

  return tx();
}

export function completeAgentRun(
  id: string,
  evidence: Record<string, unknown> = {},
  db?: Database,
): AgentRun {
  const d = db || getDatabase();
  const existing = getAgentRun(id, d);
  if (!existing) throw new Error(`Agent run not found: ${id}`);
  if (existing.status !== "running") {
    throw new Error(`Cannot complete run in status '${existing.status}'`);
  }

  const ts = now();
  const merged = { ...existing.evidence, ...evidence, completed_by: existing.agent_id };
  d.run(
    `UPDATE agent_runs SET status = 'completed', evidence = ?, completed_at = ?, updated_at = ?, error = NULL
     WHERE id = ?`,
    [JSON.stringify(merged), ts, ts, id],
  );

  return getAgentRun(id, d)!;
}

export function failAgentRun(
  id: string,
  error: string,
  options: { retry?: boolean } = {},
  db?: Database,
): AgentRun {
  const d = db || getDatabase();
  const existing = getAgentRun(id, d);
  if (!existing) throw new Error(`Agent run not found: ${id}`);
  if (existing.status !== "running" && existing.status !== "queued") {
    throw new Error(`Cannot fail run in status '${existing.status}'`);
  }

  const ts = now();
  const shouldRetry = options.retry !== false
    && existing.retry_count < existing.max_retries;

  if (shouldRetry) {
    d.run(
      `UPDATE agent_runs SET status = 'queued', error = ?, retry_count = retry_count + 1,
       agent_id = NULL, claimed_at = NULL, started_at = NULL, updated_at = ?
       WHERE id = ?`,
      [error, ts, id],
    );
  } else {
    d.run(
      `UPDATE agent_runs SET status = 'failed', error = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [error, ts, ts, id],
    );
  }

  return getAgentRun(id, d)!;
}

export function cancelAgentRun(id: string, db?: Database): AgentRun {
  const d = db || getDatabase();
  const existing = getAgentRun(id, d);
  if (!existing) throw new Error(`Agent run not found: ${id}`);
  if (existing.status === "completed" || existing.status === "cancelled") {
    throw new Error(`Cannot cancel run in status '${existing.status}'`);
  }

  const ts = now();
  d.run(
    `UPDATE agent_runs SET status = 'cancelled', completed_at = ?, updated_at = ? WHERE id = ?`,
    [ts, ts, id],
  );

  return getAgentRun(id, d)!;
}

export function retryAgentRun(id: string, db?: Database): AgentRun {
  const d = db || getDatabase();
  const existing = getAgentRun(id, d);
  if (!existing) throw new Error(`Agent run not found: ${id}`);
  if (existing.status !== "failed" && existing.status !== "cancelled") {
    throw new Error(`Can only retry failed or cancelled runs (got '${existing.status}')`);
  }
  if (existing.retry_count >= existing.max_retries) {
    throw new Error(`Max retries (${existing.max_retries}) exceeded`);
  }

  const ts = now();
  d.run(
    `UPDATE agent_runs SET status = 'queued', error = NULL, agent_id = NULL,
     claimed_at = NULL, started_at = NULL, completed_at = NULL,
     retry_count = retry_count + 1, updated_at = ?
     WHERE id = ?`,
    [ts, id],
  );

  return getAgentRun(id, d)!;
}
