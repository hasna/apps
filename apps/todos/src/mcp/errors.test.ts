import { describe, expect, test } from "bun:test";
import {
  VersionConflictError,
  TaskNotFoundError,
  TaskReferenceAmbiguousError,
  ProjectNotFoundError,
  PlanNotFoundError,
  LockError,
  AgentNotFoundError,
  TaskListNotFoundError,
  DependencyCycleError,
  CompletionGuardError,
  InputValidationError,
} from "../types/index.js";
import { EncryptedPayloadError, EncryptionKeyUnavailableError } from "../lib/local-encryption.js";
// The REAL formatter, not a local copy: a re-implementation silently drifts
// from the shipped one whenever a branch is added (the 0.16.0 typed
// REMOTE_API_* refusal was exactly such a branch, and a copied formatter
// cannot catch its regression).
import { formatError } from "./index.js";
import { REMOTE_API_CONFIG_MISSING, RemoteApiConfigMissingError } from "./remote-authority.js";

describe("Error classes have correct static properties", () => {
  test("VersionConflictError has correct code and suggestion", () => {
    expect(VersionConflictError.code).toBe("VERSION_CONFLICT");
    expect(VersionConflictError.suggestion).toContain("get_task");
  });

  test("TaskNotFoundError has correct code and suggestion", () => {
    expect(TaskNotFoundError.code).toBe("TASK_NOT_FOUND");
    expect(TaskNotFoundError.suggestion).toContain("list_tasks");
  });

  test("TaskReferenceAmbiguousError exposes candidate projects and task UUIDs", () => {
    const err = new TaskReferenceAmbiguousError("DUP-00001", [
      { task_id: "task-b", project_id: "project-b" },
      { task_id: "task-a", project_id: "project-a" },
    ]);
    const result = JSON.parse(formatError(err));
    expect(result).toMatchObject({
      code: "TASK_REFERENCE_AMBIGUOUS",
      candidate_project_ids: ["project-a", "project-b"],
      candidate_task_ids: ["task-a", "task-b"],
      suggestion: "Use a full task UUID.",
    });
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
    // The shipped formatter sanitizes an unclassified error rather than
    // echoing its message (which can carry schema details).
    expect(result.message).toBe("An unexpected error occurred. Check server logs for details.");
    expect(result.suggestion).toBeUndefined();
  });

  test("non-Error value gets UNKNOWN_ERROR code", () => {
    const result = JSON.parse(formatError("string error"));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("An unexpected error occurred.");
  });

  test("null value gets UNKNOWN_ERROR code", () => {
    const result = JSON.parse(formatError(null));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("An unexpected error occurred.");
  });

  test("RemoteApiConfigMissingError gets the typed REMOTE_API_CONFIG_MISSING payload, not UNKNOWN_ERROR", () => {
    const result = JSON.parse(formatError(new RemoteApiConfigMissingError("Plan")));
    expect(result.code).toBe(REMOTE_API_CONFIG_MISSING);
    expect(result.code).not.toBe("UNKNOWN_ERROR");
    expect(result.message).toContain("Plan tools require the authenticated Todos API");
    expect(result.suggestion).toContain("HASNA_TODOS_API_URL");
  });
});

/**
 * The storage and shared-API guards throw PLAIN `Error`s whose message begins
 * with the CLI's stable code. Before this mapping those reached MCP clients as
 * `UNKNOWN_ERROR` (measured: 89 of the 125 zero-required-argument tools on the
 * default posture), so a configuration requirement read as a server bug. These
 * tests pin the typed shape at the formatter — the single chokepoint every
 * tool's handler error passes through.
 */
describe("plain-Error guard refusals get a typed, actionable payload", () => {
  test("API_DATABASE_FALLBACK_FORBIDDEN keeps its code and names the local opt-in", () => {
    const result = JSON.parse(formatError(new Error(
      "API_DATABASE_FALLBACK_FORBIDDEN: this operation must use the shared Todos API; implicit SQLite access is unavailable",
    )));
    expect(result.code).toBe("API_DATABASE_FALLBACK_FORBIDDEN");
    expect(result.code).not.toBe("UNKNOWN_ERROR");
    expect(result.message).toContain("implicit SQLite access is unavailable");
    expect(result.suggestion).toContain("HASNA_TODOS_LOCAL=1");
  });

  test("a REMOTE_API_* resolver refusal keeps its code and names the remedy for THAT code", () => {
    // The code prefix alone does not imply one remedy: a rejected credential is
    // not a missing URL. Each code must answer with its own fix, or a client
    // follows the wrong advice and keeps failing.
    const expected: Record<string, string> = {
      REMOTE_API_CONFIG_MISSING: "HASNA_TODOS_API_URL",
      REMOTE_API_KEY_MISSING: "HASNA_TODOS_API_KEY",
      REMOTE_API_URL_INVALID: "HASNA_TODOS_API_URL",
      REMOTE_API_UNAUTHORIZED: "REJECTED",
      REMOTE_API_FORBIDDEN: "not permitted",
      REMOTE_API_UNREACHABLE: "could not be reached",
      REMOTE_API_TIMEOUT: "did not answer in time",
      REMOTE_API_UNAVAILABLE: "server error",
      REMOTE_API_REDIRECT_REJECTED: "redirected",
      REMOTE_API_INCOMPATIBLE: "compatible shape",
    };
    for (const [code, needle] of Object.entries(expected)) {
      const result = JSON.parse(formatError(new Error(`${code}: the authority could not serve this route`)));
      expect(result.code).toBe(code);
      expect(result.code).not.toBe("UNKNOWN_ERROR");
      expect(result.message).toBe("the authority could not serve this route");
      expect(result.suggestion).toContain(needle);
    }
  });

  test("a rejected credential is not answered with the configure-the-API advice", () => {
    const result = JSON.parse(formatError(new Error("REMOTE_API_UNAUTHORIZED: authority rejected the key")));
    expect(result.code).toBe("REMOTE_API_UNAUTHORIZED");
    expect(result.suggestion).not.toContain("set HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY");
    expect(result.suggestion).toContain("Re-save");
  });

  test("RemoteApiConfigMissingError carries the remedy for its own code, not always CONFIG_MISSING", () => {
    const unauthorized = new RemoteApiConfigMissingError("Plan", "REMOTE_API_UNAUTHORIZED", "rejected");
    expect(unauthorized.suggestion).toContain("Re-save");
    const result = JSON.parse(formatError(unauthorized));
    expect(result.code).toBe("REMOTE_API_UNAUTHORIZED");
    expect(result.suggestion).toContain("Re-save");
    expect(result.suggestion).not.toContain("set HASNA_TODOS_API_URL and HASNA_TODOS_API_KEY");
  });

  test("a code that is only mentioned mid-message still sanitizes", () => {
    // The mapping is anchored to the message PREFIX, so an unclassified error
    // that merely quotes a guard code keeps the sanitized payload.
    const result = JSON.parse(formatError(new Error("wrapped: REMOTE_API_CONFIG_MISSING: detail")));
    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.suggestion).toBeUndefined();
  });

  test("caller-input and local-state refusals are typed, not UNKNOWN_ERROR", () => {
    const input = JSON.parse(formatError(new InputValidationError("path or backup is required", "Pass path or backup.")));
    expect(input.code).toBe("INVALID_INPUT");
    expect(input.message).toBe("path or backup is required");
    expect(input.suggestion).toBe("Pass path or backup.");

    const key = JSON.parse(formatError(new EncryptionKeyUnavailableError("TODOS_ENCRYPTION_KEY", "default")));
    expect(key.code).toBe("ENCRYPTION_KEY_UNAVAILABLE");
    expect(key.message).toContain("TODOS_ENCRYPTION_KEY");
    expect(key.suggestion).toContain("TODOS_ENCRYPTION_KEY");

    const payload = JSON.parse(formatError(new EncryptedPayloadError("value is not a hasna/todos encrypted envelope")));
    expect(payload.code).toBe("ENCRYPTED_PAYLOAD_INVALID");
    expect(payload.message).toBe("value is not a hasna/todos encrypted envelope");
    expect(payload.suggestion).toContain("encrypt_local_value");
  });
});
