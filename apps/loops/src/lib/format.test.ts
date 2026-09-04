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
import { verifyCommandDigest } from "./command-target.js";

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
    expect(rendered).not.toContain("sk" + "-ant-");
    expect(rendered).not.toContain("ghp" + "_");
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
    expect(JSON.stringify(value)).not.toContain("prompt");
    expect(JSON.stringify(value)).toContain("operationTemplateId");
  });

  test("omits prompt source paths and prompt bodies from public loop metadata", () => {
    const value = publicLoop({
      id: "loop",
      name: "agent",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: {
        type: "agent",
        provider: "codewith",
        prompt: "SECRET_PROMPT_FILE_CONTENT should not leak",
        promptSource: { type: "file", path: join("/home/hasna", ".hasna", "loops", "prompts", "example.md") },
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
    expect(json).not.toContain(join("/home/hasna", ".hasna", "loops", "prompts", "example.md"));
    expect(json).toContain("operationTemplateId");
  });

  test("public shell command target shows the real resolved command with a digest, never the literal 'shell'", () => {
    const value = publicLoop({
      id: "shell-loop",
      name: "private-shell-command",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: {
        type: "command",
        command: "bash /private/worktree/deploy.sh --recipient private@example.test --capability NON_SECRET_SENTINEL",
        shell: true,
      },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) as { target: { command: string; commandDigest: string; commandResolvedFrom: string } };
    expect(value.target.command).not.toBe("shell");
    // The REAL resolved target is visible (bounded and secret-scrubbed), not a placeholder literal.
    expect(value.target.command).toStartWith("bash /private/worktree/deploy.sh --recipient private@example.test");
    // Integrity: the digest binds the exact stored command line the executor will run.
    expect(value.target.commandDigest).toMatch(/^cmd:sha256:[a-f0-9]{64}$/);
    expect(verifyCommandDigest(
      "bash /private/worktree/deploy.sh --recipient private@example.test --capability NON_SECRET_SENTINEL",
      value.target.commandDigest,
    )).toBe(true);
    expect(value.target.commandResolvedFrom).toBe("stored-target");
    const json = JSON.stringify(value);
    expect(json).not.toContain("NON_SECRET_SENTINEL");
  });

  test("a one-byte mutation of the stored command fails the public digest", () => {
    const base = {
      id: "shell-loop-mutation",
      name: "mutation",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    } as const;
    const intended = publicLoop({
      ...base,
      target: { type: "command", command: "bash deploy.sh", shell: true },
    }) as { target: { commandDigest: string } };
    const mutated = publicLoop({
      ...base,
      target: { type: "command", command: "bash deploy.sH", shell: true },
    }) as { target: { commandDigest: string } };
    expect(intended.target.commandDigest).not.toBe(mutated.target.commandDigest);
    expect(verifyCommandDigest("bash deploy.sH", intended.target.commandDigest)).toBe(false);
  });

  test("a secret-bearing command target never reveals credential values", () => {
    const secretCommand = `bash deploy.sh --token ${ANT_KEY} --gh ${GH_PAT}`;
    const value = publicLoop({
      id: "shell-loop-secret",
      name: "secret-shell-command",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "command", command: secretCommand, shell: true },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) as { target: { command: string; commandDigest: string } };
    const json = JSON.stringify(value);
    expect(json).not.toContain(ANT_KEY);
    expect(json).not.toContain(GH_PAT);
    expect(json).not.toContain("sk" + "-ant-");
    expect(json).not.toContain("ghp" + "_");
    expect(value.target.command).toContain("[SCRUBBED]");
    // The digest still binds the exact raw command, so integrity survives scrubbing.
    expect(verifyCommandDigest(secretCommand, value.target.commandDigest)).toBe(true);
  });

  test("non-shell command targets keep their command name and gain the digest", () => {
    const value = publicLoop({
      id: "exec-loop",
      name: "exec",
      status: "active",
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "command", command: "loops", args: ["routes", "drain", "todos-task", "--json"] },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }) as { target: { command: string; commandDigest: string } };
    expect(value.target.command).toBe("loops");
    expect(verifyCommandDigest(
      "loops 'routes' 'drain' 'todos-task' '--json'",
      value.target.commandDigest,
    )).toBe(true);
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
    expect(JSON.stringify(value)).not.toContain("prompt");
    expect(JSON.stringify(value)).toContain("operationTemplateId");
  });

  test("public workflow projections omit private paths, profiles, recipients, capability URLs, and receipt evidence", () => {
    const publicValue = publicWorkflow({
      id: "workflow-private-fields",
      name: "workflow",
      version: 1,
      status: "active",
      steps: [{
        id: "agent",
        account: { profile: "private-account", tool: "codewith" },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "private prompt",
          cwd: "/private/worktree",
          authProfile: "private-auth-profile",
          routing: { projectPath: "/private/project" },
          env: { CAPABILITY_URL: "https://private.example/capability?token=private" },
        },
      }],
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    }) as { steps: Array<{ target: Record<string, unknown> }> };
    const workflowJson = JSON.stringify(publicValue);
    expect(workflowJson).not.toContain("private prompt");
    expect(workflowJson).not.toContain("/private/");
    expect(workflowJson).not.toContain("private-account");
    expect(workflowJson).not.toContain("private-auth-profile");
    expect(workflowJson).not.toContain("private.example");
    expect(Object.keys(publicValue.steps[0]!.target).sort()).toEqual(["operationTemplateId", "type"]);
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
    expect(json).not.toContain("sk" + "-ant-");
    expect(json).not.toContain("ghp" + "_");
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
    expect(json).not.toContain("sk" + "-ant-");
    expect(json).not.toContain("ghp" + "_");
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

  test("publicLoop replaces a private target with an idempotent opaque descriptor", () => {
    const loop = {
      id: "l1",
      name: "private-loop",
      status: "active",
      schedule: { type: "once", at: "2026-08-09T00:00:00.000Z" },
      target: { type: "agent", provider: "claude", prompt: "y".repeat(137) },
      catchUp: "latest",
      catchUpLimit: 1,
      overlap: "skip",
      maxAttempts: 1,
      retryDelayMs: 60_000,
      leaseMs: 60_000,
      createdAt: "2026-08-09T00:00:00.000Z",
      updatedAt: "2026-08-09T00:00:00.000Z",
    } as const;
    const once = publicLoop(loop) as { target: { operationTemplateId: string } };
    expect(JSON.stringify(once)).not.toContain("prompt");
    expect(once.target.operationTemplateId).toStartWith("op-template:sha256:");
    const twice = publicLoop({ ...loop, target: once.target } as never) as { target: { operationTemplateId: string } };
    expect(twice.target.operationTemplateId).toBe(once.target.operationTemplateId);
  });
});
