import { describe, expect, test } from "bun:test";
import type { LoopRun } from "../types.js";
import type { RunFailureClassification } from "./health.js";
import { classifyRunFailure } from "./health.js";

function run(patch: Partial<LoopRun>): LoopRun {
  return {
    id: "run",
    loopId: "loop",
    loopName: "health-loop",
    scheduledFor: "2026-01-01T00:00:00.000Z",
    attempt: 1,
    status: "failed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("loop health classification", () => {
  test("classifies common agent-run failures", () => {
    const cases: Array<[RunFailureClassification, Partial<LoopRun>]> = [
      ["rate_limit", { error: "429 too many requests" }],
      ["auth", { stderr: "invalid token" }],
      ["model_not_found", { error: "model gpt-x not found" }],
      ["context_length", { stderr: "maximum context length exceeded" }],
      ["schema_response_format", { error: "response_format json schema validation failed" }],
      ["node_init", { stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module" }],
      ["timeout", { status: "timed_out", error: "timed out after 1000ms" }],
      ["sigsegv", { error: "terminated by SIGSEGV" }],
      ["skipped_previous_active", { status: "skipped", error: "previous run still active" }],
      ["unknown", { error: "provider exited unexpectedly" }],
    ];

    for (const [classification, patch] of cases) {
      const signal = classifyRunFailure(run(patch));
      expect(signal?.classification).toBe(classification);
      expect(signal?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  test("bounds evidence included in health JSON", () => {
    const signal = classifyRunFailure(run({ error: "x".repeat(2_050) }));

    expect(signal?.evidence.error?.length).toBeLessThan(2_050);
    expect(signal?.evidence.error).toContain("[truncated 50 chars]");
  });
});
