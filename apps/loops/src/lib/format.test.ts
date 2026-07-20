import { describe, expect, test } from "bun:test";
import {
  publicExecutorResult,
  publicLoop,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
  textOutputBlocks,
} from "./format.js";

const j = (...parts: string[]): string => parts.join("");
const ANT_KEY = j("sk-", "ant-api03-abcDEF123456789_-suffix");
const GH_PAT = j("ghp", "_AbCdEf0123456789AbCdEf0123456789");

describe("textOutputBlocks", () => {
  test("renders stdout and stderr blocks for human --show-output mode", () => {
    expect(textOutputBlocks({ stdout: "hello\n", stderr: "warn\n" }, { indent: "  " })).toEqual([
      "  stdout:",
      "    hello",
      "  stderr:",
      "    warn",
    ]);
  });

  test("omits empty output streams", () => {
    expect(textOutputBlocks({ stdout: "", stderr: undefined }, { indent: "  " })).toEqual([]);
  });

  test("scrubs historical output before rendering show-output blocks", () => {
    const rendered = textOutputBlocks(
      {
        stdout: `raw historical stdout ${ANT_KEY}`,
        stderr: `raw historical stderr ${GH_PAT}`,
      },
      { indent: "  " },
    ).join("\n");
    expect(rendered).toContain("[SCRUBBED]");
    expect(rendered).not.toContain("sk-ant-");
    expect(rendered).not.toContain("ghp_");
  });

  test("redacts loop agent prompts without leaking a prefix", () => {
    const prompt = "SECRET_PROMPT_VALUE do not expose this text";
    const value = publicLoop({
      id: "loop",
      name: "agent",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "agent", provider: "claude", prompt },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(JSON.stringify(value)).not.toContain("SECRET_PROMPT_VALUE");
    expect(JSON.stringify(value)).toContain("[redacted");
  });

  test("keeps prompt source metadata while redacting prompt bodies", () => {
    const value = publicLoop({
      id: "loop",
      name: "agent",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: {
        type: "agent",
        provider: "codewith",
        prompt: "SECRET_PROMPT_FILE_CONTENT should not leak",
        promptSource: { type: "file", path: "/home/hasna/.hasna/loops/prompts/example.md" },
      },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const json = JSON.stringify(value);
    expect(json).not.toContain("SECRET_PROMPT_FILE_CONTENT");
    expect(json).toContain("/home/hasna/.hasna/loops/prompts/example.md");
  });

  test("redacts workflow step prompts without leaking a prefix", () => {
    const value = publicWorkflow({
      id: "workflow",
      name: "workflow",
      version: 1,
      status: "active",
      steps: [
        {
          id: "agent",
          target: { type: "agent", provider: "codewith", prompt: "SECRET_WORKFLOW_PROMPT should not leak" },
        },
      ],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(JSON.stringify(value)).not.toContain("SECRET_WORKFLOW_PROMPT");
    expect(JSON.stringify(value)).toContain("[redacted");
  });

  test("redacts workflow run, step, and event sensitive fields by default", () => {
    const workflowRun = publicWorkflowRun({
      id: "run",
      workflowId: "workflow",
      workflowName: "workflow",
      status: "failed",
      error: "SECRET_WORKFLOW_ERROR should not leak",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const stepRun = publicWorkflowStepRun({
      id: "step-run",
      workflowRunId: "run",
      stepId: "step",
      sequence: 1,
      status: "failed",
      stdout: "SECRET_WORKFLOW_STDOUT should not leak",
      stderr: "SECRET_WORKFLOW_STDERR should not leak",
      error: "SECRET_WORKFLOW_STEP_ERROR should not leak",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    const event = publicWorkflowEvent({
      id: "event",
      workflowRunId: "run",
      sequence: 1,
      eventType: "failed",
      payload: {
        error: "SECRET_WORKFLOW_EVENT_ERROR should not leak",
        reason: "SECRET_WORKFLOW_EVENT_REASON should not leak",
        nested: { prompt: "SECRET_WORKFLOW_EVENT_PROMPT should not leak" },
        safe: "visible",
        historicalOutput: `visible ${ANT_KEY}`,
        nestedHistory: { result: GH_PAT },
      },
      createdAt: "2026-01-01T00:00:00Z",
    });
    const json = JSON.stringify({ workflowRun, stepRun, event });
    expect(json).not.toContain("SECRET_WORKFLOW_ERROR");
    expect(json).not.toContain("SECRET_WORKFLOW_STDOUT");
    expect(json).not.toContain("SECRET_WORKFLOW_STDERR");
    expect(json).not.toContain("SECRET_WORKFLOW_STEP_ERROR");
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_ERROR");
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_REASON");
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_PROMPT");
    expect(json).not.toContain("sk-ant-");
    expect(json).not.toContain("ghp_");
    expect(json).toContain("visible");
    expect(json).toContain("[SCRUBBED]");
    expect(json).toContain("[redacted");
  });

  test("workflow step stdout and stderr require explicit show-output opt-in", () => {
    const value = publicWorkflowStepRun(
      {
        id: "step-run",
        workflowRunId: "run",
        stepId: "step",
        sequence: 1,
        status: "succeeded",
        stdout: "VISIBLE_WORKFLOW_STDOUT",
        stderr: "VISIBLE_WORKFLOW_STDERR",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      true,
    );
    expect(JSON.stringify(value)).toContain("VISIBLE_WORKFLOW_STDOUT");
    expect(JSON.stringify(value)).toContain("VISIBLE_WORKFLOW_STDERR");
  });

  test("all public show-output views scrub stored historical secrets", () => {
    const loopRun = publicRun(
      {
        id: "run",
        loopId: "loop",
        loopName: "loop",
        scheduledFor: "2026-01-01T00:00:00Z",
        attempt: 1,
        status: "failed",
        stdout: `stdout ${ANT_KEY}`,
        stderr: `stderr ${GH_PAT}`,
        error: `error ${ANT_KEY}`,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      true,
    );
    const stepRun = publicWorkflowStepRun(
      {
        id: "step-run",
        workflowRunId: "run",
        stepId: "step",
        sequence: 1,
        status: "failed",
        stdout: `stdout ${ANT_KEY}`,
        stderr: `stderr ${GH_PAT}`,
        error: `error ${ANT_KEY}`,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      true,
    );
    const executor = publicExecutorResult(
      {
        status: "failed",
        stdout: `stdout ${ANT_KEY}`,
        stderr: `stderr ${GH_PAT}`,
        error: `error ${ANT_KEY}`,
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:00:01Z",
        durationMs: 1_000,
      },
      true,
    );
    const json = JSON.stringify({ loopRun, stepRun, executor });
    expect(json).toContain("[SCRUBBED]");
    expect(json).not.toContain("sk-ant-");
    expect(json).not.toContain("ghp_");
  });

  test("redacts executor result output and error by default", () => {
    const value = publicExecutorResult({
      status: "failed",
      stdout: "SECRET_EXECUTOR_STDOUT should not leak",
      stderr: "SECRET_EXECUTOR_STDERR should not leak",
      error: "SECRET_EXECUTOR_ERROR should not leak",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:01Z",
      durationMs: 1_000,
    });
    const json = JSON.stringify(value);
    expect(json).not.toContain("SECRET_EXECUTOR_STDOUT");
    expect(json).not.toContain("SECRET_EXECUTOR_STDERR");
    expect(json).not.toContain("SECRET_EXECUTOR_ERROR");
    expect(json).toContain("[redacted");
  });
});
