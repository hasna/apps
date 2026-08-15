import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask } from "./tasks.js";
import { logTrace, getTaskTraces, getTraceStats } from "./traces.js";
import type { Database } from "bun:sqlite";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

function setupTask(title = "Test") {
  const projId = "proj-" + Math.random().toString(36).slice(2, 10);
  db.run("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)", [projId, "test", "/tmp/test-" + projId]);
  return createTask({ title, project_id: projId }, db);
}

describe("logTrace", () => {
  it("should log a trace with minimal fields", () => {
    const task = setupTask();
    const trace = logTrace({ task_id: task.id, trace_type: "tool_call" });
    expect(trace.id).toBeTruthy();
    expect(trace.task_id).toBe(task.id);
    expect(trace.trace_type).toBe("tool_call");
    expect(trace.agent_id).toBeNull();
    expect(trace.name).toBeNull();
    expect(trace.created_at).toBeTruthy();
  });

  it("should log a trace with all fields", () => {
    const task = setupTask();
    const trace = logTrace({
      task_id: task.id,
      agent_id: "agent-1",
      trace_type: "llm_call",
      name: "gpt-4-call",
      input_summary: "Generate code for auth",
      output_summary: "200 lines of TypeScript",
      duration_ms: 1500,
      tokens: 500,
      cost_usd: 0.03,
    });
    expect(trace.agent_id).toBe("agent-1");
    expect(trace.trace_type).toBe("llm_call");
    expect(trace.name).toBe("gpt-4-call");
    expect(trace.input_summary).toBe("Generate code for auth");
    expect(trace.output_summary).toBe("200 lines of TypeScript");
    expect(trace.duration_ms).toBe(1500);
    expect(trace.tokens).toBe(500);
    expect(trace.cost_usd).toBe(0.03);
  });

  it("should handle all trace types", () => {
    const task = setupTask();
    const types = ["tool_call", "llm_call", "error", "handoff", "custom"] as const;
    for (const type of types) {
      const trace = logTrace({ task_id: task.id, trace_type: type });
      expect(trace.trace_type).toBe(type);
    }
  });
});

describe("getTaskTraces", () => {
  it("should return empty array for no traces", () => {
    expect(getTaskTraces("nonexistent")).toEqual([]);
  });

  it("should return traces for a task ordered by recency DESC", () => {
    const task = setupTask();
    logTrace({ task_id: task.id, trace_type: "tool_call", name: "oldest" });
    Bun.sleepSync(1100);
    logTrace({ task_id: task.id, trace_type: "llm_call", name: "newest" });
    const traces = getTaskTraces(task.id);
    expect(traces).toHaveLength(2);
    expect(traces[0].name).toBe("newest");
    expect(traces[1].name).toBe("oldest");
  });

  it("should only return traces for the specified task", () => {
    const task1 = setupTask("Task 1");
    const task2 = setupTask("Task 2");
    logTrace({ task_id: task1.id, trace_type: "tool_call" });
    logTrace({ task_id: task2.id, trace_type: "llm_call" });
    const traces = getTaskTraces(task1.id);
    expect(traces).toHaveLength(1);
    expect(traces[0].trace_type).toBe("tool_call");
  });
});

describe("getTraceStats", () => {
  it("should return zero total for no traces", () => {
    const stats = getTraceStats("nonexistent");
    expect(stats.total).toBe(0);
    // SQLite SUM returns null for empty result sets (not coalesced for CASE aggregates)
    expect(stats.tool_calls).toBeNull();
    expect(stats.llm_calls).toBeNull();
    expect(stats.errors).toBeNull();
    expect(stats.total_tokens).toBe(0);
    expect(stats.total_cost_usd).toBe(0);
    expect(stats.total_duration_ms).toBe(0);
  });

  it("should aggregate trace stats correctly", () => {
    const task = setupTask();
    logTrace({ task_id: task.id, trace_type: "tool_call", tokens: 100, cost_usd: 0.01, duration_ms: 50 });
    logTrace({ task_id: task.id, trace_type: "tool_call", tokens: 200, cost_usd: 0.02, duration_ms: 60 });
    logTrace({ task_id: task.id, trace_type: "error", tokens: 50, duration_ms: 10 });
    const stats = getTraceStats(task.id);
    expect(stats.total).toBe(3);
    expect(stats.tool_calls).toBe(2);
    expect(stats.errors).toBe(1);
    expect(stats.total_tokens).toBe(350);
    expect(stats.total_cost_usd).toBe(0.03);
    expect(stats.total_duration_ms).toBe(120);
  });
});
