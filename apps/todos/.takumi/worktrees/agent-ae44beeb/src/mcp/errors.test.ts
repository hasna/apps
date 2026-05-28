import { describe, expect, test } from "bun:test";
import {
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  AgentNotFoundError,
  TaskListNotFoundError,
  DependencyCycleError,
  CompletionGuardError,
} from "../types/index.js";

// Re-implement formatError here to test it in isolation (same logic as src/mcp/index.ts)
function formatError(error: unknown): string {
  if (error instanceof VersionConflictError) {
    return JSON.stringify({ code: VersionConflictError.code, message: error.message, suggestion: VersionConflictError.suggestion });
  }
  if (error instanceof TaskNotFoundError) {
    return JSON.stringify({ code: TaskNotFoundError.code, message: error.message, suggestion: TaskNotFoundError.suggestion });
  }
  if (error instanceof ProjectNotFoundError) {
    return JSON.stringify({ code: ProjectNotFoundError.code, message: error.message, suggestion: ProjectNotFoundError.suggestion });
  }
  if (error instanceof PlanNotFoundError) {
    return JSON.stringify({ code: PlanNotFoundError.code, message: error.message, suggestion: PlanNotFoundError.suggestion });
  }
  if (error instanceof TaskListNotFoundError) {
    return JSON.stringify({ code: TaskListNotFoundError.code, message: error.message, suggestion: TaskListNotFoundError.suggestion });
  }
  if (error instanceof LockError) {
    return JSON.stringify({ code: LockError.code, message: error.message, suggestion: LockError.suggestion });
  }
  if (error instanceof AgentNotFoundError) {
    return JSON.stringify({ code: AgentNotFoundError.code, message: error.message, suggestion: AgentNotFoundError.suggestion });
  }
  if (error instanceof DependencyCycleError) {
    return JSON.stringify({ code: DependencyCycleError.code, message: error.message, suggestion: DependencyCycleError.suggestion });
  }
  if (error instanceof CompletionGuardError) {
    const retry = error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {};
    return JSON.stringify({ code: CompletionGuardError.code, message: error.reason, suggestion: CompletionGuardError.suggestion, ...retry });
  }
  if (error instanceof Error) {
    return JSON.stringify({ code: "UNKNOWN_ERROR", message: error.message });
  }
  return JSON.stringify({ code: "UNKNOWN_ERROR", message: String(error) });
}

describe("Error classes have correct static properties", () => {
  test("VersionConflictError has correct code and suggestion", () => {
    expect(VersionConflictError.code).toBe("VERSION_CONFLICT");
    expect(VersionConflictError.suggestion).toContain("get_task");
  });

  test("TaskNotFoundError has correct code and suggestion", () => {
    expect(TaskNotFoundError.code).toBe("TASK_NOT_FOUND");
    expect(TaskNotFoundError.suggestion).toContain("list_tasks");
  });

  test("ProjectNotFoundError has correct code and suggestion", () => {
    expect(ProjectNotFoundError.code).toBe("PROJECT_NOT_FOUND");
    expect(ProjectNotFoundError.suggestion).toContain("list_projects");
  });

  test("PlanNotFoundError has correct code and suggestion", () => {
    expect(PlanNotFoundError.code).toBe("PLAN_NOT_FOUND");
    expect(PlanNotFoundError.suggestion).toContain("list_plans");
  });

  test("LockError has correct code and suggestion", () => {
    expect(LockError.code).toBe("LOCK_ERROR");
    expect(LockError.suggestion).toContain("30 min");
  });

  test("AgentNotFoundError has correct code and suggestion", () => {
    expect(AgentNotFoundError.code).toBe("AGENT_NOT_FOUND");
    expect(AgentNotFoundError.suggestion).toContain("register_agent");
  });

  test("TaskListNotFoundError has correct code and suggestion", () => {
    expect(TaskListNotFoundError.code).toBe("TASK_LIST_NOT_FOUND");
    expect(TaskListNotFoundError.suggestion).toContain("list_task_lists");
  });

  test("DependencyCycleError has correct code and suggestion", () => {
    expect(DependencyCycleError.code).toBe("DEPENDENCY_CYCLE");
    expect(DependencyCycleError.suggestion).toContain("get_task");
  });

  test("CompletionGuardError has correct code and suggestion", () => {
    expect(CompletionGuardError.code).toBe("COMPLETION_BLOCKED");
    expect(CompletionGuardError.suggestion).toContain("cooldown");
  });
});

describe("formatError returns structured JSON", () => {
  test("VersionConflictError produces valid JSON with code, message, suggestion", () => {
    const err = new VersionConflictError("task-1", 1, 2);
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.message).toContain("task-1");
    expect(result.suggestion).toBeDefined();
  });

  test("TaskNotFoundError produces valid JSON with code, message, suggestion", () => {
    const err = new TaskNotFoundError("task-99");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("TASK_NOT_FOUND");
    expect(result.message).toContain("task-99");
    expect(result.suggestion).toBeDefined();
  });

  test("ProjectNotFoundError produces valid JSON", () => {
    const err = new ProjectNotFoundError("proj-1");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("PROJECT_NOT_FOUND");
    expect(result.message).toContain("proj-1");
    expect(result.suggestion).toBeDefined();
  });

  test("PlanNotFoundError produces valid JSON", () => {
    const err = new PlanNotFoundError("plan-1");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("PLAN_NOT_FOUND");
    expect(result.message).toContain("plan-1");
    expect(result.suggestion).toBeDefined();
  });

  test("LockError produces valid JSON", () => {
    const err = new LockError("task-1", "agent-1");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("LOCK_ERROR");
    expect(result.message).toContain("locked");
    expect(result.suggestion).toBeDefined();
  });

  test("AgentNotFoundError produces valid JSON", () => {
    const err = new AgentNotFoundError("agent-99");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("AGENT_NOT_FOUND");
    expect(result.message).toContain("agent-99");
    expect(result.suggestion).toBeDefined();
  });

  test("TaskListNotFoundError produces valid JSON", () => {
    const err = new TaskListNotFoundError("list-1");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("TASK_LIST_NOT_FOUND");
    expect(result.message).toContain("list-1");
    expect(result.suggestion).toBeDefined();
  });

  test("DependencyCycleError produces valid JSON", () => {
    const err = new DependencyCycleError("task-1", "task-2");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("DEPENDENCY_CYCLE");
    expect(result.message).toContain("task-1");
    expect(result.suggestion).toBeDefined();
  });

  test("CompletionGuardError produces valid JSON with retryAfterSeconds", () => {
    const err = new CompletionGuardError("Too fast", 60);
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("COMPLETION_BLOCKED");
    expect(result.message).toBe("Too fast");
    expect(result.suggestion).toBeDefined();
    expect(result.retryAfterSeconds).toBe(60);
  });

  test("CompletionGuardError without retryAfterSeconds omits the field", () => {
    const err = new CompletionGuardError("Blocked");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("COMPLETION_BLOCKED");
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  test("unknown Error gets UNKNOWN_ERROR code", () => {
    const err = new Error("something broke");
    const result = JSON.parse(formatError(err));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("something broke");
    expect(result.suggestion).toBeUndefined();
  });

  test("non-Error value gets UNKNOWN_ERROR code", () => {
    const result = JSON.parse(formatError("string error"));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("string error");
  });

  test("null value gets UNKNOWN_ERROR code", () => {
    const result = JSON.parse(formatError(null));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("null");
  });
});
