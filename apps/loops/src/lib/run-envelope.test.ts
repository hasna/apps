import { describe, expect, test } from "bun:test";
import type { WorkflowStepRun } from "../types.js";
import {
  BLOCKED_STEP_ERROR_PREFIX,
  ENVELOPE_EXCERPT_CHARS,
  boundedExcerpt,
  isBlockedStepRun,
  summarizeExecutorResult,
  summarizeWorkflowStepRun,
} from "./run-envelope.js";

function stepRun(patch: Partial<WorkflowStepRun>): WorkflowStepRun {
  return {
    id: "step-run",
    workflowRunId: "run",
    stepId: "step",
    sequence: 0,
    status: "succeeded",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("run envelope", () => {
  test("boundedExcerpt keeps short output unchanged and skips empty output", () => {
    expect(boundedExcerpt(undefined)).toBeUndefined();
    expect(boundedExcerpt("")).toBeUndefined();
    expect(boundedExcerpt("short output")).toBe("short output");
    expect(boundedExcerpt("a".repeat(ENVELOPE_EXCERPT_CHARS * 2))).toHaveLength(ENVELOPE_EXCERPT_CHARS * 2);
  });

  test("boundedExcerpt keeps first and last excerpt and reports the omitted size", () => {
    const text = `HEAD${"m".repeat(100_000)}TAIL`;
    const excerpt = boundedExcerpt(text)!;
    expect(excerpt).toStartWith("HEAD");
    expect(excerpt).toEndWith("TAIL");
    expect(excerpt).toContain(`[... ${text.length - ENVELOPE_EXCERPT_CHARS * 2} chars omitted ...]`);
    expect(excerpt.length).toBeLessThan(ENVELOPE_EXCERPT_CHARS * 2 + 100);
  });

  test("boundedExcerpt stays fast on 256KB strings", () => {
    const text = "x".repeat(256 * 1024);
    const start = performance.now();
    for (let i = 0; i < 100; i++) boundedExcerpt(text);
    expect(performance.now() - start).toBeLessThan(1_000);
  });

  test("summarizeWorkflowStepRun keeps byte counts and drops full output", () => {
    const summary = summarizeWorkflowStepRun(
      stepRun({ stdout: "y".repeat(50_000), stderr: "err", exitCode: 0, durationMs: 12 }),
    );
    expect(summary.stdoutBytes).toBe(50_000);
    expect(summary.stderrBytes).toBe(3);
    expect(summary.stdoutExcerpt).toContain("chars omitted");
    expect(summary.stdoutExcerpt!.length).toBeLessThan(ENVELOPE_EXCERPT_CHARS * 2 + 100);
    expect(summary.blocked).toBe(false);
  });

  test("summarizeExecutorResult mirrors status, exit code, and bounded output", () => {
    const summary = summarizeExecutorResult({
      status: "failed",
      exitCode: 12,
      durationMs: 5,
      stdout: "policy details",
      stderr: "",
      error: "gate refused",
    });
    expect(summary.status).toBe("failed");
    expect(summary.exitCode).toBe(12);
    expect(summary.stdoutExcerpt).toBe("policy details");
    expect(summary.stderrBytes).toBe(0);
    expect(summary.error).toBe("gate refused");
  });

  test("boundedExcerpt scrubs secrets before truncating so a cut cannot bisect them", () => {
    const key = `sk-ant-${"a1b2C3d4".repeat(12)}`; // 103 chars
    // Position the key so the head slice(0, limit) would end mid-key: the
    // retained head would keep a raw key prefix fragment.
    const headStraddle = `${"x".repeat(ENVELOPE_EXCERPT_CHARS - 20)} ${key} ${"y".repeat(ENVELOPE_EXCERPT_CHARS * 2)}`;
    const headExcerpt = boundedExcerpt(headStraddle)!;
    expect(headExcerpt).not.toContain("sk-ant-");
    expect(headExcerpt).toContain("[SCRUBBED]");
    // Same for the tail slice(-limit) starting mid-key: the surviving suffix
    // fragment would lack the sk-ant- prefix and match no scrub pattern.
    const tailStraddle = `${"x".repeat(ENVELOPE_EXCERPT_CHARS * 3)} ${key} ${"y".repeat(ENVELOPE_EXCERPT_CHARS - 20)}`;
    const tailExcerpt = boundedExcerpt(tailStraddle)!;
    expect(tailExcerpt).not.toContain(key.slice(83));
    expect(tailExcerpt).toContain("[SCRUBBED]");
  });

  test("isBlockedStepRun requires skipped status with the blocked prefix", () => {
    expect(isBlockedStepRun(stepRun({ status: "skipped", error: `${BLOCKED_STEP_ERROR_PREFIX} gate exit 12` }))).toBe(true);
    expect(isBlockedStepRun(stepRun({ status: "skipped", error: "dependency did not succeed: gate" }))).toBe(false);
    expect(isBlockedStepRun(stepRun({ status: "failed", error: `${BLOCKED_STEP_ERROR_PREFIX} gate exit 12` }))).toBe(false);
    expect(isBlockedStepRun(undefined)).toBe(false);
  });
});
