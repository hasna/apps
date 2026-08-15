import { describe, test, expect } from "bun:test";
import { formatDispatchMessage, formatSingleTask } from "./dispatch-formatter.ts";
import type { Task } from "../types/index.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    short_id: "APP-00001",
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: "Fix the login bug",
    description: null,
    status: "pending",
    priority: "high",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    due_at: null,
    estimated_minutes: null,
    requires_approval: false,
    approved_by: null,
    approved_at: null,
    recurrence_rule: null,
    recurrence_parent_id: null,
    confidence: null,
    reason: null,
    spawned_from_session: null,
    assigned_by: null,
    assigned_from_project: null,
    started_at: null,
    task_type: null,
    cost_tokens: 0,
    cost_usd: 0,
    delegated_from: null,
    delegation_depth: 0,
    retry_count: 0,
    max_retries: 3,
    retry_after: null,
    sla_minutes: null,
    spawns_template_id: null,
    ...overrides,
  };
}

describe("formatSingleTask", () => {
  test("formats task with short_id and priority badge", () => {
    const task = makeTask();
    const result = formatSingleTask(task);
    expect(result).toContain("[HIGH]");
    expect(result).toContain("APP-00001:");
    expect(result).toContain("Fix the login bug");
  });

  test("includes description when present", () => {
    const task = makeTask({ description: "This happens when you click login." });
    const result = formatSingleTask(task);
    expect(result).toContain("This happens when you click login.");
  });

  test("truncates description at 200 chars", () => {
    const longDesc = "a".repeat(250);
    const task = makeTask({ description: longDesc });
    const result = formatSingleTask(task);
    expect(result).toContain("…");
    const descLine = result.split("\n")[1]!;
    expect(descLine.length).toBeLessThanOrEqual(210); // 200 + "  " prefix + "…"
  });

  test("omits description when includeDescription=false", () => {
    const task = makeTask({ description: "Should not appear" });
    const result = formatSingleTask(task, { includeDescription: false });
    expect(result).not.toContain("Should not appear");
  });

  test("omits priority badge when includePriority=false", () => {
    const task = makeTask();
    const result = formatSingleTask(task, { includePriority: false });
    expect(result).not.toContain("[HIGH]");
  });

  test("shows tags when includeTags=true", () => {
    const task = makeTask({ tags: ["auth", "frontend"] });
    const result = formatSingleTask(task, { includeTags: true });
    expect(result).toContain("tags: auth, frontend");
  });

  test("no tags line when tags empty", () => {
    const task = makeTask({ tags: [] });
    const result = formatSingleTask(task, { includeTags: true });
    expect(result).not.toContain("tags:");
  });

  test("works without short_id", () => {
    const task = makeTask({ short_id: null });
    const result = formatSingleTask(task);
    expect(result).toContain("Fix the login bug");
    expect(result).not.toContain("null");
  });

  test("all priority badges", () => {
    for (const [priority, badge] of [
      ["critical", "[CRITICAL]"],
      ["high", "[HIGH]"],
      ["medium", "[MEDIUM]"],
      ["low", "[LOW]"],
    ] as const) {
      const task = makeTask({ priority });
      expect(formatSingleTask(task)).toContain(badge);
    }
  });
});

describe("formatDispatchMessage", () => {
  test("returns (no tasks) for empty array", () => {
    expect(formatDispatchMessage([])).toBe("(no tasks)");
  });

  test("single task uses compact format (no numbering)", () => {
    const task = makeTask();
    const result = formatDispatchMessage([task]);
    expect(result).not.toContain("1.");
    expect(result).toContain("Fix the login bug");
  });

  test("multiple tasks are numbered", () => {
    const tasks = [
      makeTask({ id: "a", short_id: "APP-00001", title: "Task one" }),
      makeTask({ id: "b", short_id: "APP-00002", title: "Task two" }),
    ];
    const result = formatDispatchMessage(tasks);
    expect(result).toContain("1.");
    expect(result).toContain("2.");
    expect(result).toContain("Task one");
    expect(result).toContain("Task two");
  });

  test("includes list header when listName provided", () => {
    const tasks = [makeTask()];
    const result = formatDispatchMessage(tasks, { listName: "Sprint 1" });
    expect(result).toContain("── Sprint 1 ──");
  });

  test("multi-task header includes task count", () => {
    const tasks = [
      makeTask({ id: "a", title: "Task one" }),
      makeTask({ id: "b", title: "Task two" }),
    ];
    const result = formatDispatchMessage(tasks, { listName: "My List" });
    expect(result).toContain("── My List (2 tasks) ──");
  });

  test("description truncation in multi-task layout", () => {
    const tasks = [
      makeTask({ description: "b".repeat(300) }),
      makeTask({ id: "b", title: "Second task" }),
    ];
    const result = formatDispatchMessage(tasks);
    expect(result).toContain("…");
  });
});
