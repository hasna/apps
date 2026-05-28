import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createTask, startTask, completeTask, failTask, getTask, stealTask, claimOrSteal, logCost, getNextTask } from "./tasks.js";
import { registerAgent } from "./agents.js";
import { logTrace, getTaskTraces, getTraceStats } from "./traces.js";
import { saveSnapshot, getLatestSnapshot, listSnapshots } from "./snapshots.js";
import { setBudget, getBudget, checkBudget } from "./budgets.js";
import { createProject } from "./projects.js";

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("work stealing", () => {
  it("should steal a stale task from another agent", () => {
    const db = getDatabase();
    const agent1 = registerAgent({ name: "worker1" }) as any;
    const agent2 = registerAgent({ name: "worker2" }) as any;
    const task = createTask({ title: "Stealable task" }, db);
    startTask(task.id, agent1.id, db);
    // Make it stale
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const stolen = stealTask(agent2.id, { stale_minutes: 30 }, db);
    expect(stolen).not.toBeNull();
    expect(stolen!.assigned_to).toBe(agent2.id);
    expect(stolen!.locked_by).toBe(agent2.id);
  });

  it("should return null when no stale tasks", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "lonely" }) as any;
    const task = createTask({ title: "Fresh task" }, db);
    startTask(task.id, agent.id, db);
    // Task is fresh — should not be stealable
    const stolen = stealTask("other-agent", { stale_minutes: 30 }, db);
    expect(stolen).toBeNull();
  });

  it("should prefer higher priority stale tasks", () => {
    const db = getDatabase();
    const agent1 = registerAgent({ name: "holder" }) as any;
    const low = createTask({ title: "Low task", priority: "low" }, db);
    const high = createTask({ title: "High task", priority: "high" }, db);
    startTask(low.id, agent1.id, db);
    startTask(high.id, agent1.id, db);
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id IN (?, ?)", [staleTime, staleTime, low.id, high.id]);

    const stolen = stealTask("thief", { stale_minutes: 30 }, db);
    expect(stolen!.title).toBe("High task");
  });
});

describe("claimOrSteal", () => {
  it("should claim pending task before stealing", () => {
    const db = getDatabase();
    createTask({ title: "Pending task" }, db);
    const result = claimOrSteal("agent1", undefined, db);
    expect(result).not.toBeNull();
    expect(result!.stolen).toBe(false);
    expect(result!.task.status).toBe("in_progress");
  });

  it("should steal when no pending tasks", () => {
    const db = getDatabase();
    const agent1 = registerAgent({ name: "holder2" }) as any;
    const task = createTask({ title: "Only task" }, db);
    startTask(task.id, agent1.id, db);
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE tasks SET updated_at = ?, locked_at = ? WHERE id = ?", [staleTime, staleTime, task.id]);

    const result = claimOrSteal("agent2", undefined, db);
    expect(result).not.toBeNull();
    expect(result!.stolen).toBe(true);
  });
});

describe("cost tracking", () => {
  it("should accumulate cost on a task", () => {
    const db = getDatabase();
    const task = createTask({ title: "Expensive task" }, db);
    logCost(task.id, 1000, 0.05, db);
    logCost(task.id, 2000, 0.10, db);
    const updated = getTask(task.id, db)!;
    expect(updated.cost_tokens).toBe(3000);
    expect(updated.cost_usd).toBeCloseTo(0.15);
  });
});

describe("task traces", () => {
  it("should log and retrieve traces", () => {
    const db = getDatabase();
    const task = createTask({ title: "Traced task" }, db);
    logTrace({ task_id: task.id, agent_id: "agent1", trace_type: "llm_call", name: "claude-opus", tokens: 500, cost_usd: 0.01 }, db);
    logTrace({ task_id: task.id, agent_id: "agent1", trace_type: "tool_call", name: "read_file", duration_ms: 50 }, db);
    logTrace({ task_id: task.id, trace_type: "error", name: "TypeError", output_summary: "undefined is not a function" }, db);

    const traces = getTaskTraces(task.id, db);
    expect(traces).toHaveLength(3);
    const types = traces.map(t => t.trace_type).sort();
    expect(types).toEqual(["error", "llm_call", "tool_call"]);
  });

  it("should compute trace stats", () => {
    const db = getDatabase();
    const task = createTask({ title: "Stats task" }, db);
    logTrace({ task_id: task.id, trace_type: "llm_call", tokens: 1000, cost_usd: 0.05, duration_ms: 200 }, db);
    logTrace({ task_id: task.id, trace_type: "llm_call", tokens: 500, cost_usd: 0.02, duration_ms: 100 }, db);
    logTrace({ task_id: task.id, trace_type: "tool_call", duration_ms: 30 }, db);
    logTrace({ task_id: task.id, trace_type: "error" }, db);

    const stats = getTraceStats(task.id, db);
    expect(stats.total).toBe(4);
    expect(stats.llm_calls).toBe(2);
    expect(stats.tool_calls).toBe(1);
    expect(stats.errors).toBe(1);
    expect(stats.total_tokens).toBe(1500);
    expect(stats.total_cost_usd).toBeCloseTo(0.07);
    expect(stats.total_duration_ms).toBe(330);
  });
});

describe("context snapshots", () => {
  it("should save and retrieve snapshots", () => {
    const db = getDatabase();
    const task = createTask({ title: "Auth task" }, db);
    const snap = saveSnapshot({
      agent_id: "agent1", task_id: task.id, snapshot_type: "interrupt",
      plan_summary: "Working on auth refactor",
      files_open: ["src/auth.ts", "src/middleware.ts"],
      blockers: ["Need DB migration"],
      next_steps: "Run migration then update middleware",
    }, db);
    expect(snap.id).toBeTruthy();
    expect(snap.plan_summary).toBe("Working on auth refactor");
    expect(snap.files_open).toEqual(["src/auth.ts", "src/middleware.ts"]);

    const latest = getLatestSnapshot("agent1", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest!.plan_summary).toBe("Working on auth refactor");
  });

  it("should return latest snapshot when multiple exist", () => {
    const db = getDatabase();
    const s1 = saveSnapshot({ agent_id: "agent1", snapshot_type: "checkpoint", plan_summary: "First" }, db);
    // Manually set earlier timestamp for first snapshot
    db.run("UPDATE context_snapshots SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", [s1.id]);
    saveSnapshot({ agent_id: "agent1", snapshot_type: "interrupt", plan_summary: "Second" }, db);
    const latest = getLatestSnapshot("agent1", undefined, db);
    expect(latest!.plan_summary).toBe("Second");
  });

  it("should list snapshots with filters", () => {
    const db = getDatabase();
    saveSnapshot({ agent_id: "a1", snapshot_type: "checkpoint" }, db);
    saveSnapshot({ agent_id: "a2", snapshot_type: "interrupt" }, db);
    saveSnapshot({ agent_id: "a1", snapshot_type: "handoff" }, db);
    const all = listSnapshots({ agent_id: "a1" }, db);
    expect(all).toHaveLength(2);
  });
});

describe("agent budgets", () => {
  it("should set and check budget", () => {
    const db = getDatabase();
    const budget = setBudget("agent1", { max_concurrent: 3 }, db);
    expect(budget.max_concurrent).toBe(3);

    const check = checkBudget("agent1", db);
    expect(check.allowed).toBe(true);
    expect(check.current_concurrent).toBe(0);
  });

  it("should block when concurrent limit reached", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "busy-agent" }, db) as any;
    setBudget(agent.id, { max_concurrent: 2 }, db);

    const t1 = createTask({ title: "Task 1" }, db);
    const t2 = createTask({ title: "Task 2" }, db);
    startTask(t1.id, agent.id, db);
    startTask(t2.id, agent.id, db);

    const check = checkBudget(agent.id, db);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Concurrent limit");
  });

  it("should allow when no budget set", () => {
    const db = getDatabase();
    const check = checkBudget("unknown-agent", db);
    expect(check.allowed).toBe(true);
  });
});

describe("retry with exponential backoff", () => {
  it("should create retry with incremented count", () => {
    const db = getDatabase();
    const task = createTask({ title: "Flaky task" }, db);
    startTask(task.id, "agent1", db);
    const result = failTask(task.id, "agent1", "Timeout", { retry: true }, db);
    expect(result.retryTask).toBeDefined();
    // Check retry fields on the new task
    const retry = getTask(result.retryTask!.id, db)!;
    expect(retry.retry_count).toBe(1);
    expect(retry.retry_after).toBeTruthy();
  });

  it("should stop retrying after max_retries", () => {
    const db = getDatabase();
    const task = createTask({ title: "Doomed task" }, db);
    // Simulate already at max retries
    db.run("UPDATE tasks SET retry_count = 3, max_retries = 3 WHERE id = ?", [task.id]);
    startTask(task.id, "agent1", db);
    const result = failTask(task.id, "agent1", "Still failing", { retry: true }, db);
    expect(result.retryTask).toBeUndefined(); // No retry created
  });
});

describe("dependency auto-notification", () => {
  it("should detect unblocked tasks when dependency completes", () => {
    const db = getDatabase();
    const blocker = createTask({ title: "Blocker task" }, db);
    const dependent = createTask({ title: "Dependent task" }, db);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)", [dependent.id, blocker.id]);

    startTask(blocker.id, "agent1", db);
    const completed = completeTask(blocker.id, "agent1", db);
    // Check that unblocked info is in metadata
    expect(completed.metadata._unblocked).toBeDefined();
    const unblocked = completed.metadata._unblocked as any[];
    expect(unblocked).toHaveLength(1);
    expect(unblocked[0].id).toBe(dependent.id);
  });

  it("should not mark as unblocked if other deps remain", () => {
    const db = getDatabase();
    const blocker1 = createTask({ title: "Blocker 1" }, db);
    const blocker2 = createTask({ title: "Blocker 2" }, db);
    const dependent = createTask({ title: "Needs both" }, db);
    db.run("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?), (?, ?)", [dependent.id, blocker1.id, dependent.id, blocker2.id]);

    startTask(blocker1.id, "agent1", db);
    const completed = completeTask(blocker1.id, "agent1", db);
    // dependent still blocked by blocker2
    expect(completed.metadata._unblocked).toBeUndefined();
  });
});
