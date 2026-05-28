import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "../db/database.js";
import { createTask, startTask, completeTask, updateTask, getTask } from "../db/tasks.js";
import { createProject } from "../db/projects.js";
import { CompletionGuardError } from "../types/index.js";
import { checkCompletionGuard } from "./completion-guard.js";
import { getCompletionGuardConfig, type CompletionGuardConfig } from "./config.js";

let db: Database;

function guardConfig(overrides: Partial<CompletionGuardConfig> = {}): Required<CompletionGuardConfig> {
  return {
    enabled: true,
    min_work_seconds: 30,
    max_completions_per_window: 5,
    window_minutes: 10,
    cooldown_seconds: 60,
    ...overrides,
  };
}

/** Helper: create a task, set it to in_progress with locked_at in the past */
function createStartedTask(
  title: string,
  agentId: string,
  secondsAgo: number,
  extra: Partial<Parameters<typeof createTask>[0]> = {},
) {
  const task = createTask({ title, status: "in_progress", assigned_to: agentId, ...extra }, db);
  const pastTime = new Date(Date.now() - secondsAgo * 1000).toISOString();
  db.run("UPDATE tasks SET locked_at = ?, locked_by = ? WHERE id = ?", [pastTime, agentId, task.id]);
  return getTask(task.id, db)!;
}

/** Helper: complete a task directly in DB at a given time in the past */
function completeTaskAt(taskId: string, secondsAgo: number) {
  const pastTime = new Date(Date.now() - secondsAgo * 1000).toISOString();
  db.run("UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?", [pastTime, taskId]);
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

// ─── STATUS CHECK ────────────────────────────────────────────────────────────

describe("completion guard - status check", () => {
  it("should block completing a pending task", () => {
    const task = createTask({ title: "Test task" }, db);
    expect(() => checkCompletionGuard(task, null, db, guardConfig())).toThrow(CompletionGuardError);
    expect(() => checkCompletionGuard(task, null, db, guardConfig())).toThrow(/must be in 'in_progress' status/);
  });

  it("should block completing a failed task", () => {
    const task = createTask({ title: "Test task", status: "failed" }, db);
    expect(() => checkCompletionGuard(task, null, db, guardConfig())).toThrow(/current: 'failed'/);
  });

  it("should block completing a cancelled task", () => {
    const task = createTask({ title: "Test task", status: "cancelled" }, db);
    expect(() => checkCompletionGuard(task, null, db, guardConfig())).toThrow(/current: 'cancelled'/);
  });

  it("should block completing an already-completed task", () => {
    const task = createTask({ title: "Test task", status: "completed" }, db);
    expect(() => checkCompletionGuard(task, null, db, guardConfig())).toThrow(/current: 'completed'/);
  });

  it("should allow completing an in_progress task with no other guards", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = createTask({ title: "Test task", status: "in_progress" }, db);
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });

  it("should skip all checks when guard is disabled", () => {
    const config = guardConfig({ enabled: false });
    const task = createTask({ title: "Test task" }, db); // pending
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });

  it("should allow pending task completion when disabled even with strict settings", () => {
    const config = guardConfig({
      enabled: false,
      min_work_seconds: 9999,
      cooldown_seconds: 9999,
      max_completions_per_window: 0,
    });
    const task = createTask({ title: "Test task" }, db);
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });
});

// ─── MIN WORK DURATION ──────────────────────────────────────────────────────

describe("completion guard - min work duration", () => {
  it("should block task completed too quickly after start", () => {
    const config = guardConfig({ min_work_seconds: 60, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = startTask(
      createTask({ title: "Test task", assigned_to: "agent-1" }, db).id,
      "agent-1",
      db,
    );
    expect(() => checkCompletionGuard(task, "agent-1", db, config)).toThrow(CompletionGuardError);
    expect(() => checkCompletionGuard(task, "agent-1", db, config)).toThrow(/Too fast/);
  });

  it("should allow completion when enough time has passed", () => {
    const config = guardConfig({ min_work_seconds: 1, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = createStartedTask("Test task", "agent-1", 5);
    expect(() => checkCompletionGuard(task, "agent-1", db, config)).not.toThrow();
  });

  it("should skip min work check if no locked_at", () => {
    const config = guardConfig({ min_work_seconds: 60, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = createTask({ title: "Test task", status: "in_progress" }, db);
    // No locked_at — check is skipped
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });

  it("should block at exactly min_work_seconds boundary", () => {
    // locked_at is 0 seconds ago — should block with min_work_seconds=30
    const config = guardConfig({ min_work_seconds: 30, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = createStartedTask("Boundary task", "agent-1", 0);
    expect(() => checkCompletionGuard(task, "agent-1", db, config)).toThrow(/Too fast/);
  });

  it("should pass when elapsed exactly meets min_work_seconds", () => {
    const config = guardConfig({ min_work_seconds: 2, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = createStartedTask("Boundary pass", "agent-1", 3); // 3s > 2s
    expect(() => checkCompletionGuard(task, "agent-1", db, config)).not.toThrow();
  });

  it("should include retryAfterSeconds in error", () => {
    const config = guardConfig({ min_work_seconds: 60, cooldown_seconds: 0, max_completions_per_window: 0 });
    const task = startTask(
      createTask({ title: "Test", assigned_to: "a1" }, db).id,
      "a1",
      db,
    );
    try {
      checkCompletionGuard(task, "a1", db, config);
      expect(true).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(CompletionGuardError);
      const err = e as CompletionGuardError;
      expect(err.retryAfterSeconds).toBeGreaterThan(0);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });
});

// ─── RATE LIMIT ─────────────────────────────────────────────────────────────

describe("completion guard - rate limit", () => {
  it("should block when agent exceeds completion rate", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 2, window_minutes: 10 });
    const agentId = "agent-rate";

    for (let i = 0; i < 2; i++) {
      const t = createTask({ title: `Task ${i}`, status: "in_progress", assigned_to: agentId }, db);
      completeTaskAt(t.id, 0);
    }

    const nextTask = createTask({ title: "Task 3", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(CompletionGuardError);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Rate limit/);
  });

  it("should block at exactly the rate limit boundary", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 10 });
    const agentId = "agent-exact";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    // 1 completion already, max is 1 — next should be blocked
    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Rate limit/);
  });

  it("should allow when under rate limit", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 5, window_minutes: 10 });
    const agentId = "agent-ok";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should not count completions from other agents", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 10 });

    const t = createTask({ title: "Task A", status: "in_progress", assigned_to: "agent-a" }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task B", status: "in_progress", assigned_to: "agent-b" }, db);
    expect(() => checkCompletionGuard(nextTask, "agent-b", db, config)).not.toThrow();
  });

  it("should not count completions outside the window", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 5 });
    const agentId = "agent-window";

    const t = createTask({ title: "Old task", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 10 * 60); // 10 minutes ago, outside 5-minute window

    const nextTask = createTask({ title: "New task", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should match via agent_id field too", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 10 });
    const agentId = "agent-via-field";

    // Complete a task where agentId is in agent_id field (not assigned_to)
    const t = createTask({ title: "Task 1", status: "in_progress", agent_id: agentId }, db);
    completeTaskAt(t.id, 0);

    // New task also via agent_id
    const nextTask = createTask({ title: "Task 2", status: "in_progress", agent_id: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Rate limit/);
  });

  it("should count completions across assigned_to and agent_id fields", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 10 });
    const agentId = "agent-cross";

    // Complete via assigned_to
    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    // Try to complete another — this time matched via agent_id
    const nextTask = createTask({ title: "Task 2", status: "in_progress", agent_id: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Rate limit/);
  });

  it("should skip rate limit when max_completions_per_window is 0", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 0, window_minutes: 10 });
    const agentId = "agent-norl";

    for (let i = 0; i < 10; i++) {
      const t = createTask({ title: `Task ${i}`, status: "in_progress", assigned_to: agentId }, db);
      completeTaskAt(t.id, 0);
    }

    const nextTask = createTask({ title: "Task 11", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should handle rate limit with no completions in window", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 1, window_minutes: 10 });
    const agentId = "agent-fresh";

    const nextTask = createTask({ title: "First ever task", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should include completion count in error message", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 3, window_minutes: 10 });
    const agentId = "agent-msg";

    for (let i = 0; i < 3; i++) {
      const t = createTask({ title: `Task ${i}`, status: "in_progress", assigned_to: agentId }, db);
      completeTaskAt(t.id, 0);
    }

    const nextTask = createTask({ title: "Task 4", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/3 tasks completed/);
  });
});

// ─── COOLDOWN ───────────────────────────────────────────────────────────────

describe("completion guard - cooldown", () => {
  it("should block when completing too soon after previous completion", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });
    const agentId = "agent-cd";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(CompletionGuardError);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Cooldown/);
  });

  it("should allow when cooldown has elapsed", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 5, max_completions_per_window: 0 });
    const agentId = "agent-cd2";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 10); // 10s ago, cooldown is 5s

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should include retryAfterSeconds in cooldown error", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });
    const agentId = "agent-cd-retry";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 10); // 10s ago, cooldown is 120s

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    try {
      checkCompletionGuard(nextTask, agentId, db, config);
      expect(true).toBe(false);
    } catch (e) {
      const err = e as CompletionGuardError;
      expect(err.retryAfterSeconds).toBeGreaterThan(100);
      expect(err.retryAfterSeconds).toBeLessThanOrEqual(110);
    }
  });

  it("should skip cooldown when cooldown_seconds is 0", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 0 });
    const agentId = "agent-nocd";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).not.toThrow();
  });

  it("should not count other agents' completions for cooldown", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });

    const t = createTask({ title: "Task A", status: "in_progress", assigned_to: "agent-x" }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task B", status: "in_progress", assigned_to: "agent-y" }, db);
    expect(() => checkCompletionGuard(nextTask, "agent-y", db, config)).not.toThrow();
  });

  it("should allow first-ever completion (no prior completions)", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });
    const agentId = "agent-first";

    const task = createTask({ title: "First task", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(task, agentId, db, config)).not.toThrow();
  });
});

// ─── AGENT IDENTITY RESOLUTION ──────────────────────────────────────────────

describe("completion guard - agent identity", () => {
  it("should handle null agent gracefully (skip agent-scoped checks)", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 60, max_completions_per_window: 1 });
    const task = createTask({ title: "Orphan task", status: "in_progress" }, db);
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });

  it("should use assigned_to from task when agentId param is null", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });
    const agentId = "agent-fallback";

    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, null, db, config)).toThrow(/Cooldown/);
  });

  it("should use agent_id from task when agentId and assigned_to are null", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });
    const agentId = "agent-fallback2";

    const t = createTask({ title: "Task 1", status: "in_progress", agent_id: agentId }, db);
    completeTaskAt(t.id, 0);

    const nextTask = createTask({ title: "Task 2", status: "in_progress", agent_id: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, null, db, config)).toThrow(/Cooldown/);
  });

  it("should prefer explicit agentId over task fields", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 120, max_completions_per_window: 0 });

    // Agent A completes a task
    const t = createTask({ title: "Task 1", status: "in_progress", assigned_to: "agent-a" }, db);
    completeTaskAt(t.id, 0);

    // Task assigned to agent-a, but checking with explicit agent-b — should pass
    const nextTask = createTask({ title: "Task 2", status: "in_progress", assigned_to: "agent-a" }, db);
    expect(() => checkCompletionGuard(nextTask, "agent-b", db, config)).not.toThrow();
  });
});

// ─── INTEGRATION WITH completeTask / updateTask ─────────────────────────────

describe("completion guard - completeTask integration", () => {
  // Note: these tests use the real config (guard disabled by default)
  // so they test the actual code path without config override

  it("should allow completeTask when guard is disabled (default)", () => {
    const task = createTask({ title: "Test task" }, db);
    const completed = completeTask(task.id, undefined, db);
    expect(completed.status).toBe("completed");
    expect(completed.completed_at).toBeTruthy();
  });

  it("should set completed_at on successful completion", () => {
    const task = createTask({ title: "Test task" }, db);
    const completed = completeTask(task.id, undefined, db);
    expect(completed.completed_at).not.toBeNull();
  });

  it("should clear lock on successful completion", () => {
    const task = createTask({ title: "Test task", assigned_to: "agent-1" }, db);
    startTask(task.id, "agent-1", db);
    const completed = completeTask(task.id, "agent-1", db);
    expect(completed.locked_by).toBeNull();
    expect(completed.locked_at).toBeNull();
  });

  it("should increment version on completion", () => {
    const task = createTask({ title: "Test task" }, db);
    const completed = completeTask(task.id, undefined, db);
    expect(completed.version).toBe(task.version + 1);
  });
});

describe("completion guard - updateTask integration", () => {
  it("should allow updateTask status=completed when guard is disabled (default)", () => {
    const task = createTask({ title: "Test task" }, db);
    const updated = updateTask(task.id, { status: "completed", version: task.version }, db);
    expect(updated.status).toBe("completed");
  });

  it("should not trigger guard for non-completion status updates", () => {
    // This should never trigger the guard — it's not a completion
    const task = createTask({ title: "Test task" }, db);
    const updated = updateTask(task.id, { status: "in_progress", version: task.version }, db);
    expect(updated.status).toBe("in_progress");
  });

  it("should not trigger guard for field updates without status change", () => {
    const task = createTask({ title: "Test task" }, db);
    const updated = updateTask(task.id, { title: "Updated title", version: task.version }, db);
    expect(updated.title).toBe("Updated title");
    expect(updated.status).toBe("pending");
  });
});

// ─── ERROR CLASS ────────────────────────────────────────────────────────────

describe("CompletionGuardError", () => {
  it("should have correct name", () => {
    const err = new CompletionGuardError("test reason");
    expect(err.name).toBe("CompletionGuardError");
  });

  it("should store reason and retryAfterSeconds", () => {
    const err = new CompletionGuardError("test reason", 42);
    expect(err.reason).toBe("test reason");
    expect(err.retryAfterSeconds).toBe(42);
    expect(err.message).toBe("test reason");
  });

  it("should have undefined retryAfterSeconds when not provided", () => {
    const err = new CompletionGuardError("test reason");
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("should be an instance of Error", () => {
    const err = new CompletionGuardError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

// ─── CONFIG ─────────────────────────────────────────────────────────────────

describe("completion guard - config", () => {
  it("getCompletionGuardConfig should return defaults when no config exists", () => {
    const config = getCompletionGuardConfig();
    expect(config.enabled).toBe(false);
    expect(config.min_work_seconds).toBe(30);
    expect(config.max_completions_per_window).toBe(5);
    expect(config.window_minutes).toBe(10);
    expect(config.cooldown_seconds).toBe(60);
  });

  it("getCompletionGuardConfig should return defaults for unknown project path", () => {
    const config = getCompletionGuardConfig("/nonexistent/path");
    expect(config.enabled).toBe(false);
  });
});

// ─── COMBINED SCENARIOS ─────────────────────────────────────────────────────

describe("completion guard - combined scenarios", () => {
  it("should work with all guards combined and pass", () => {
    const config = guardConfig({ min_work_seconds: 1, cooldown_seconds: 1, max_completions_per_window: 10 });
    const agentId = "agent-combo";

    const task = createStartedTask("Task", agentId, 5);

    // Set last completion to 5s ago
    const old = createTask({ title: "Old", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(old.id, 5);

    // All guards pass: in_progress, 5s > 1s work, 5s > 1s cooldown, 1 < 10 rate
    expect(() => checkCompletionGuard(task, agentId, db, config)).not.toThrow();
  });

  it("status check should fire before other checks", () => {
    // Even with other violations, status check should be the error
    const config = guardConfig({ min_work_seconds: 9999, cooldown_seconds: 9999, max_completions_per_window: 0 });
    const task = createTask({ title: "Pending task" }, db);
    expect(() => checkCompletionGuard(task, null, db, config)).toThrow(/must be in 'in_progress' status/);
  });

  it("min work check fires before rate limit and cooldown", () => {
    const config = guardConfig({ min_work_seconds: 60, cooldown_seconds: 120, max_completions_per_window: 1 });
    const agentId = "agent-order";

    // Create completions to trigger rate limit
    const t = createTask({ title: "Old", status: "in_progress", assigned_to: agentId }, db);
    completeTaskAt(t.id, 0);

    // Task just started — min work should fire first
    const task = startTask(
      createTask({ title: "New", assigned_to: agentId }, db).id,
      agentId,
      db,
    );
    expect(() => checkCompletionGuard(task, agentId, db, config)).toThrow(/Too fast/);
  });

  it("should handle many rapid completions correctly", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 10, window_minutes: 10 });
    const agentId = "agent-rapid";

    // Create 10 completed tasks
    for (let i = 0; i < 10; i++) {
      const t = createTask({ title: `Task ${i}`, status: "in_progress", assigned_to: agentId }, db);
      completeTaskAt(t.id, 0);
    }

    // 11th should be blocked
    const nextTask = createTask({ title: "Task 11", status: "in_progress", assigned_to: agentId }, db);
    expect(() => checkCompletionGuard(nextTask, agentId, db, config)).toThrow(/Rate limit.*10 tasks/);
  });

  it("should scope rate limit to individual agents", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 2, window_minutes: 10 });

    // Agent A completes 2 tasks
    for (let i = 0; i < 2; i++) {
      const t = createTask({ title: `A-${i}`, status: "in_progress", assigned_to: "agent-a" }, db);
      completeTaskAt(t.id, 0);
    }

    // Agent B completes 1 task
    const tb = createTask({ title: "B-1", status: "in_progress", assigned_to: "agent-b" }, db);
    completeTaskAt(tb.id, 0);

    // Agent A blocked, Agent B still has room
    const nextA = createTask({ title: "A-3", status: "in_progress", assigned_to: "agent-a" }, db);
    expect(() => checkCompletionGuard(nextA, "agent-a", db, config)).toThrow(/Rate limit/);

    const nextB = createTask({ title: "B-2", status: "in_progress", assigned_to: "agent-b" }, db);
    expect(() => checkCompletionGuard(nextB, "agent-b", db, config)).not.toThrow();
  });

  it("should work with project-scoped tasks", () => {
    const config = guardConfig({ min_work_seconds: 0, cooldown_seconds: 0, max_completions_per_window: 0 });
    const project = createProject({ name: "Test Project", path: "/tmp/test-project" }, db);
    const task = createTask({ title: "Project task", status: "in_progress", project_id: project.id }, db);
    expect(() => checkCompletionGuard(task, null, db, config)).not.toThrow();
  });
});
