import { describe, expect, test } from "bun:test";
import type { ExecutorResult, Loop } from "../types.js";
import { classifyLoopExecutionResult } from "./loop-result.js";

function loop(patch: Partial<Loop> = {}): Loop {
  return {
    id: "loop",
    name: "loop",
    status: "active",
    schedule: { type: "interval", everyMs: 60_000 },
    target: { type: "command", command: "true" },
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 1_000,
    leaseMs: 60_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function result(patch: Partial<ExecutorResult> = {}): ExecutorResult {
  return {
    status: "failed",
    exitCode: 75,
    stdout: "",
    stderr: "configured decline",
    error: "process exited with code 75",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1_000,
    ...patch,
  };
}

describe("loop execution result classification", () => {
  test("maps configured non-workflow exit 75 to the neutral terminal status", () => {
    expect(classifyLoopExecutionResult(loop(), result())).toEqual({
      ...result(),
      status: "skipped",
    });
  });

  test("does not change unrelated executor outcomes", () => {
    expect(classifyLoopExecutionResult(loop({ overlap: "allow" }), result()).status).toBe("failed");
    expect(classifyLoopExecutionResult(loop(), result({ exitCode: 76 })).status).toBe("failed");
    expect(classifyLoopExecutionResult(loop(), result({ status: "timed_out" })).status).toBe("timed_out");
    expect(classifyLoopExecutionResult(loop(), result({ status: "succeeded", exitCode: 75 })).status).toBe("succeeded");
    expect(classifyLoopExecutionResult(
      loop({ target: { type: "workflow", workflowId: "workflow" } }),
      result(),
    ).status).toBe("failed");
  });
});
