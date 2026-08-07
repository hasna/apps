import { describe, expect, test } from "bun:test";
import {
  publicExecutorResult,
  publicLoop,
  redact,
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
    // Run output stays hidden until the caller opts in: a size control.
    expect(json).not.toContain("SECRET_WORKFLOW_STDOUT");
    expect(json).not.toContain("SECRET_WORKFLOW_STDERR");
    // Workflow EVENT payloads are arbitrary user-supplied structures, so the
    // key-based payload redaction over error/reason/prompt is unchanged.
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_ERROR");
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_REASON");
    expect(json).not.toContain("SECRET_WORKFLOW_EVENT_PROMPT");
    // CHANGED by todos 744651ec: a run/step `error` is an operational
    // diagnostic and is now surfaced instead of blanket-redacted. It is still
    // shape-scrubbed — see the credential-shape cases in "run error stays
    // diagnostic" below, which gate the other side of this trade.
    expect(json).toContain("SECRET_WORKFLOW_ERROR");
    expect(json).toContain("SECRET_WORKFLOW_STEP_ERROR");
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

  test("hides executor result output by default and keeps the error readable", () => {
    const value = publicExecutorResult({
      status: "failed",
      stdout: "SECRET_EXECUTOR_STDOUT should not leak",
      stderr: "SECRET_EXECUTOR_STDERR should not leak",
      error: "command failed with exit 1",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:01Z",
      durationMs: 1_000,
    });
    const json = JSON.stringify(value);
    expect(json).not.toContain("SECRET_EXECUTOR_STDOUT");
    expect(json).not.toContain("SECRET_EXECUTOR_STDERR");
    expect(json).toContain("[redacted");
    // CHANGED by todos 744651ec — the error is the diagnostic, not a secret.
    expect(json).toContain("command failed with exit 1");
  });
});

// Incident 607176 follow-up. `loops show` on a control-plane machine reads a
// loop that the server already redacted, then redacts it again, so a 137-char
// prompt printed as "[redacted 20 chars]" — the length of the placeholder, not
// of the prompt. That destroyed the one signal an operator had for checking
// whether the stored prompt was intact. Redaction is now idempotent, so the
// displayed length is always the real prompt's length.
describe("redact", () => {
  test("is idempotent over its own placeholder", () => {
    const prompt = "x".repeat(137);
    const once = redact(prompt);
    expect(once).toBe("[redacted 137 chars]");
    expect(redact(once)).toBe("[redacted 137 chars]");
    expect(redact(redact(once))).toBe("[redacted 137 chars]");
  });

  test("passes a bare placeholder through unchanged", () => {
    expect(redact("[redacted]")).toBe("[redacted]");
  });

  test("still redacts text that merely contains a placeholder", () => {
    const value = "prefix [redacted 12 chars] suffix";
    expect(redact(value)).toBe(`[redacted ${value.length} chars]`);
  });

  test("publicLoop on an already-public agent loop keeps the original length", () => {
    const prompt = "y".repeat(137);
    const loop = { id: "l1", target: { type: "agent", provider: "claude", prompt } } as never;
    const once = publicLoop(loop) as { target: { prompt: string } };
    expect(once.target.prompt).toBe("[redacted 137 chars]");
    const twice = publicLoop(once as never) as { target: { prompt: string } };
    expect(twice.target.prompt).toBe("[redacted 137 chars]");
  });
});

// Observability regression (todos 744651ec). Run `error` was blanket
// length-preservingly redacted on every hosted API run path — `publicRun(run,
// showOutput, { redactError: true })` at /v1/runs — with NO query parameter that
// turned it off. So "command failed with exit 1" reached operators as "[redacted
// 26 chars]", and ten loops failed for a week with the four root causes sitting
// in exactly the fields this destroyed.
//
// A redactor that fires on "command failed with exit 1" protects nothing: the
// WRITE path already ran shape-based scrubSecrets over stdout/stderr (via
// persistedRunOutput) and error (via finalizeRun), so the stored value is
// already scrubbed and re-destroying it at display time only removes the
// diagnostic. These tests are two-sided on purpose — a credential-shaped error
// must still be scrubbed, a plain operational error must survive intact.
const RUN_BASE = {
  id: "run",
  loopId: "loop",
  loopName: "loop",
  scheduledFor: "2026-01-01T00:00:00Z",
  attempt: 1,
  status: "failed",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as const;

describe("run error stays diagnostic", () => {
  // The three exact strings whose character counts identified them in the
  // incident: 26, 27 and 56 chars. None contains anything secret.
  test.each([
    ["command failed with exit 1", 26],
    ["command failed with exit 75", 27],
    ["ENOENT: no such file or directory, posix_spawn '/bin/sh'", 56],
  ])("surfaces %p verbatim rather than a length placeholder", (error, length) => {
    expect(error.length).toBe(length);
    const value = publicRun({ ...RUN_BASE, error } as never, false) as { error?: string };
    expect(value.error).toBe(error);
    expect(value.error).not.toMatch(/^\[redacted/);
  });

  test("surfaces the error on every publicRun caller shape", () => {
    const error = "timed out after 300000ms";
    for (const value of [
      publicRun({ ...RUN_BASE, error } as never, false),
      publicRun({ ...RUN_BASE, error } as never, false),
      publicRun({ ...RUN_BASE, error } as never, true),
    ] as { error?: string }[]) {
      expect(value.error).toBe(error);
    }
  });

  test("surfaces executor, workflow-run and workflow-step errors too", () => {
    const error = "command failed with exit 1";
    const executor = publicExecutorResult({
      status: "failed",
      error,
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:01Z",
      durationMs: 1_000,
    } as never) as { error?: string };
    const workflowRun = publicWorkflowRun({
      id: "run",
      workflowId: "workflow",
      workflowName: "workflow",
      status: "failed",
      error,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as never) as { error?: string };
    const stepRun = publicWorkflowStepRun({
      id: "step-run",
      workflowRunId: "run",
      stepId: "step",
      sequence: 1,
      status: "failed",
      error,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as never) as { error?: string };
    expect(executor.error).toBe(error);
    expect(workflowRun.error).toBe(error);
    expect(stepRun.error).toBe(error);
  });

  // The other side of the gate. Each shape below is one this fleet has measured
  // a redactor miss on, so each is asserted rather than assumed.
  test.each([
    ["unquoted assignment", `api_key=${j("sk-", "ant-api03-abcDEF123456789_-suffix")}`],
    ["bare-quoted assignment", `token: "${j("ghp", "_AbCdEf0123456789AbCdEf0123456789")}"`],
    ["JSON-quoted assignment", `{"token": "${j("ghp", "_AbCdEf0123456789AbCdEf0123456789")}"}`],
    ["URL query parameter", `POST https://example.test/cb?access_token=${j("ghp", "_AbCdEf0123456789AbCdEf0123456789")} failed`],
    ["URL fragment", `open https://example.test/cb#access_token=${j("ghp", "_AbCdEf0123456789AbCdEf0123456789")} failed`],
    ["authorization header", `curl -H "Authorization: Bearer ${j("eyJ", "hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")}" failed`],
    ["anthropic key in prose", `spawn failed with ${j("sk-", "ant-api03-abcDEF123456789_-suffix")} in env`],
  ])("still scrubs a credential-shaped error: %s", (_shape, error) => {
    const value = publicRun({ ...RUN_BASE, error } as never, false) as { error?: string };
    expect(value.error).toContain("[SCRUBBED]");
    expect(value.error).not.toContain("sk-ant-");
    expect(value.error).not.toContain("ghp_");
    expect(value.error).not.toContain("eyJhbGciOiJIUzI1NiJ9.");
  });

  test("bounds a pathologically long error instead of dropping it", () => {
    const error = `boom ${"z".repeat(20_000)}`;
    const value = publicRun({ ...RUN_BASE, error } as never, false) as { error?: string };
    expect(value.error?.startsWith("boom zzz")).toBe(true);
    expect(value.error).toContain("[truncated");
    expect(value.error!.length).toBeLessThan(error.length);
  });
});

// Same incident-607176 idempotency class as `redact`, on the fields that never
// went through `redact`: publicRun/publicWorkflowStepRun built the stdout and
// stderr placeholder inline, so re-formatting an already-public run reported the
// PLACEHOLDER's length. Measured before the fix: a 2279-char stdout formatted
// twice read "[redacted 21 chars]". Length preservation is the only handle an
// operator has on a hidden output, so a second pass must not destroy it.
describe("hidden output placeholders are idempotent", () => {
  test("publicRun keeps the original stdout and stderr length", () => {
    const stdout = "x".repeat(2279);
    const stderr = "y".repeat(137);
    const once = publicRun({ ...RUN_BASE, stdout, stderr } as never, false) as { stdout?: string; stderr?: string };
    expect(once.stdout).toBe("[redacted 2279 chars]");
    expect(once.stderr).toBe("[redacted 137 chars]");
    const twice = publicRun({ ...RUN_BASE, stdout: once.stdout, stderr: once.stderr } as never, false) as {
      stdout?: string;
      stderr?: string;
    };
    expect(twice.stdout).toBe("[redacted 2279 chars]");
    expect(twice.stderr).toBe("[redacted 137 chars]");
  });

  test("publicWorkflowStepRun keeps the original stdout length", () => {
    const stdout = "x".repeat(2279);
    const step = {
      id: "step-run",
      workflowRunId: "run",
      stepId: "step",
      sequence: 1,
      status: "failed",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const once = publicWorkflowStepRun({ ...step, stdout } as never, false) as { stdout?: string };
    expect(once.stdout).toBe("[redacted 2279 chars]");
    const twice = publicWorkflowStepRun({ ...step, stdout: once.stdout } as never, false) as { stdout?: string };
    expect(twice.stdout).toBe("[redacted 2279 chars]");
  });

  test("publicExecutorResult keeps the original stdout length", () => {
    const stdout = "x".repeat(2279);
    const result = {
      status: "failed",
      startedAt: "2026-01-01T00:00:00Z",
      finishedAt: "2026-01-01T00:00:01Z",
      durationMs: 1_000,
    };
    const once = publicExecutorResult({ ...result, stdout } as never, false) as { stdout?: string };
    expect(once.stdout).toBe("[redacted 2279 chars]");
    const twice = publicExecutorResult({ ...result, stdout: once.stdout } as never, false) as { stdout?: string };
    expect(twice.stdout).toBe("[redacted 2279 chars]");
  });
});
