import { describe, it, expect } from "bun:test";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  PLAN_STATUSES,
  DISPATCH_STATUSES,
  VersionConflictError,
  TaskNotFoundError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  AgentNotFoundError,
  TaskListNotFoundError,
  DependencyCycleError,
  CompletionGuardError,
  DispatchNotFoundError,
} from "./index.js";

describe("TASK_STATUSES", () => {
  it("should contain the expected statuses", () => {
    expect(TASK_STATUSES).toEqual(["pending", "in_progress", "completed", "failed", "cancelled"]);
  });
});

describe("TASK_PRIORITIES", () => {
  it("should contain the expected priorities", () => {
    expect(TASK_PRIORITIES).toEqual(["low", "medium", "high", "critical"]);
  });
});

describe("PLAN_STATUSES", () => {
  it("should contain the expected statuses", () => {
    expect(PLAN_STATUSES).toEqual(["active", "completed", "archived"]);
  });
});

describe("DISPATCH_STATUSES", () => {
  it("should contain the expected statuses", () => {
    expect(DISPATCH_STATUSES).toEqual(["pending", "sent", "failed", "cancelled"]);
  });
});

describe("VersionConflictError", () => {
  it("should be an instance of Error", () => {
    const err = new VersionConflictError("task-1", 1, 2);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("VersionConflictError");
  });

  it("should have the correct message", () => {
    const err = new VersionConflictError("task-1", 1, 2);
    expect(err.message).toContain("task-1");
    expect(err.message).toContain("expected 1");
    expect(err.message).toContain("got 2");
  });

  it("should have static code and suggestion", () => {
    expect(VersionConflictError.code).toBe("VERSION_CONFLICT");
    expect(VersionConflictError.suggestion).toBeTruthy();
  });

  it("should store task metadata", () => {
    const err = new VersionConflictError("abc-123", 3, 5);
    expect(err.taskId).toBe("abc-123");
    expect(err.expectedVersion).toBe(3);
    expect(err.actualVersion).toBe(5);
  });
});

describe("TaskNotFoundError", () => {
  it("should be an instance of Error", () => {
    const err = new TaskNotFoundError("task-1");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("TaskNotFoundError");
  });

  it("should have the task ID in the message", () => {
    const err = new TaskNotFoundError("my-task");
    expect(err.message).toContain("my-task");
  });

  it("should have static code and suggestion", () => {
    expect(TaskNotFoundError.code).toBe("TASK_NOT_FOUND");
    expect(TaskNotFoundError.suggestion).toBeTruthy();
  });
});

describe("ProjectNotFoundError", () => {
  it("should include the project ID", () => {
    const err = new ProjectNotFoundError("proj-1");
    expect(err.projectId).toBe("proj-1");
  });

  it("should have static code and suggestion", () => {
    expect(ProjectNotFoundError.code).toBe("PROJECT_NOT_FOUND");
    expect(ProjectNotFoundError.suggestion).toBeTruthy();
  });
});

describe("LockError", () => {
  it("should include task and lock holder", () => {
    const err = new LockError("task-1", "agent-7");
    expect(err.taskId).toBe("task-1");
    expect(err.lockedBy).toBe("agent-7");
    expect(err.message).toContain("agent-7");
  });

  it("should have static code and suggestion", () => {
    expect(LockError.code).toBe("LOCK_ERROR");
    expect(LockError.suggestion).toBeTruthy();
  });
});

describe("DependencyCycleError", () => {
  it("should include task and dependency IDs", () => {
    const err = new DependencyCycleError("task-A", "task-B");
    expect(err.taskId).toBe("task-A");
    expect(err.dependsOn).toBe("task-B");
  });

  it("should have static code and suggestion", () => {
    expect(DependencyCycleError.code).toBe("DEPENDENCY_CYCLE");
    expect(DependencyCycleError.suggestion).toBeTruthy();
  });
});

describe("CompletionGuardError", () => {
  it("should store reason and optional retryAfterSeconds", () => {
    const err = new CompletionGuardError("Too fast", 30);
    expect(err.reason).toBe("Too fast");
    expect(err.retryAfterSeconds).toBe(30);
  });

  it("should allow undefined retryAfterSeconds", () => {
    const err = new CompletionGuardError("Blocked");
    expect(err.retryAfterSeconds).toBeUndefined();
  });

  it("should have static code and suggestion", () => {
    expect(CompletionGuardError.code).toBe("COMPLETION_BLOCKED");
    expect(CompletionGuardError.suggestion).toBeTruthy();
  });
});

describe("AgentNotFoundError", () => {
  it("should include the agent ID", () => {
    const err = new AgentNotFoundError("agent-x");
    expect(err.agentId).toBe("agent-x");
  });
});

describe("TaskListNotFoundError", () => {
  it("should include the task list ID", () => {
    const err = new TaskListNotFoundError("list-1");
    expect(err.taskListId).toBe("list-1");
  });
});

describe("PlanNotFoundError", () => {
  it("should include the plan ID", () => {
    const err = new PlanNotFoundError("plan-1");
    expect(err.planId).toBe("plan-1");
  });
});

describe("DispatchNotFoundError", () => {
  it("should include the dispatch ID", () => {
    const err = new DispatchNotFoundError("dispatch-1");
    expect(err.dispatchId).toBe("dispatch-1");
  });
});
