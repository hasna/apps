import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.js";

export type TraceType = "tool_call" | "llm_call" | "error" | "handoff" | "custom";

export interface TaskTrace {
  id: string;
  task_id: string;
  agent_id: string | null;
  trace_type: TraceType;
  name: string | null;
  input_summary: string | null;
  output_summary: string | null;
  duration_ms: number | null;
  tokens: number | null;
  cost_usd: number | null;
  created_at: string;
}

export interface LogTraceInput {
  task_id: string;
  agent_id?: string;
  trace_type: TraceType;
  name?: string;
  input_summary?: string;
  output_summary?: string;
  duration_ms?: number;
  tokens?: number;
  cost_usd?: number;
}

export function logTrace(input: LogTraceInput, db?: Database): TaskTrace {
  const d = db || getDatabase();
  const id = uuid();
  const timestamp = now();
  d.run(
    `INSERT INTO task_traces (id, task_id, agent_id, trace_type, name, input_summary, output_summary, duration_ms, tokens, cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.task_id, input.agent_id || null, input.trace_type, input.name || null,
     input.input_summary || null, input.output_summary || null,
     input.duration_ms ?? null, input.tokens ?? null, input.cost_usd ?? null, timestamp],
  );
  return { id, task_id: input.task_id, agent_id: input.agent_id || null, trace_type: input.trace_type,
    name: input.name || null, input_summary: input.input_summary || null, output_summary: input.output_summary || null,
    duration_ms: input.duration_ms ?? null, tokens: input.tokens ?? null, cost_usd: input.cost_usd ?? null, created_at: timestamp };
}

export function getTaskTraces(taskId: string, db?: Database): TaskTrace[] {
  const d = db || getDatabase();
  return d.query("SELECT * FROM task_traces WHERE task_id = ? ORDER BY created_at DESC").all(taskId) as TaskTrace[];
}

export function getTraceStats(taskId: string, db?: Database): { total: number; tool_calls: number; llm_calls: number; errors: number; total_tokens: number; total_cost_usd: number; total_duration_ms: number } {
  const d = db || getDatabase();
  const row = d.query(
    `SELECT COUNT(*) as total,
       SUM(CASE WHEN trace_type = 'tool_call' THEN 1 ELSE 0 END) as tool_calls,
       SUM(CASE WHEN trace_type = 'llm_call' THEN 1 ELSE 0 END) as llm_calls,
       SUM(CASE WHEN trace_type = 'error' THEN 1 ELSE 0 END) as errors,
       COALESCE(SUM(tokens), 0) as total_tokens,
       COALESCE(SUM(cost_usd), 0) as total_cost_usd,
       COALESCE(SUM(duration_ms), 0) as total_duration_ms
     FROM task_traces WHERE task_id = ?`
  ).get(taskId) as any;
  return row;
}
