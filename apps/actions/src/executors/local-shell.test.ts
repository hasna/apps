import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ActionsClient, createLocalShellAction } from "../index.js";
import { JsonActionsStore } from "../storage.js";
import { ShellActionError, localShellBinding } from "./local-shell.js";
import type { ActionManifest } from "../types.js";

function shellManifest(): ActionManifest {
  return {
    id: "shell.uppercase",
    name: "Uppercase with shell",
    version: "1.0.0",
    description: "Read JSON input and return uppercase output.",
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object", required: ["message"] },
    actor: { types: ["human", "agent"] },
    resource: { type: "local-process" },
    scope: { level: "local", permissions: ["shell:execute"] },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true },
    dryRun: { supported: true, default: false },
    confirmation: { title: "Uppercase input", summaryTemplate: "Uppercase {{name}}" },
    audit: { eventTypes: ["action.planned", "action.executed"], includeOutput: true },
    evidence: { required: false, fields: ["stdout", "stderr"] },
    rollback: { strategy: "none" },
    executorBindings: [{
      kind: "local-shell",
      command: "bun",
      args: [
        "-e",
        "const input = JSON.parse(await new Response(Bun.stdin.stream()).text()); console.log(JSON.stringify({ message: input.name.toUpperCase() }));",
      ],
      inputMode: "stdin-json",
      outputMode: "json",
    }],
  };
}

describe("local shell executor", () => {
  test("previews without executing and executes JSON stdin/stdout", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = shellManifest();
      await client.register(createLocalShellAction(manifest));

      const preview = await client.run({
        actionId: manifest.id,
        input: { name: "actions" },
        dryRun: true,
      });
      expect(preview.status).toBe("previewed");
      expect(preview.output).toBeUndefined();

      const executed = await client.run({
        actionId: manifest.id,
        input: { name: "actions" },
        dryRun: false,
      });
      expect(executed.status).toBe("succeeded");
      expect(executed.output).toEqual({ message: "ACTIONS" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// agent-authored test-gap additions (SOL consult unavailable: codewith exec with
// gpt-5.6-sol max reasoning timed out at the 570s window on two distinct accounts
// before producing a final answer; this spec was written from direct source analysis).
describe("local shell executor failure and isolation contracts", () => {
  function bindingManifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
    return {
      ...shellManifest(),
      ...overrides,
    };
  }

  test("kills a command that exceeds its timeout with SIGTERM and reports failure", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-timeout-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "sleep",
          args: ["30"],
          timeoutMs: 250,
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("signal SIGTERM");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reports a missing command as a failed run with the spawn error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-missing-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "definitely-not-a-real-command-xyz",
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("exit code");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("surfaces non-zero exit codes in the ShellActionError message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-exit-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "sh",
          args: ["-c", "exit 3"],
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("exit code 3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("text output mode returns raw stdout as the run output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-text-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "printf",
          args: ["plain text\nsecond line"],
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(run.output).toBe("plain text\nsecond line");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("shell-result output mode returns the full result record", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-result-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "printf",
          args: ["hello"],
          outputMode: "shell-result",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      const result = run.output as { status: string; code: number; stdout: string; args: string[] };
      expect(result.status).toBe("success");
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.args).toEqual(["hello"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("env-json input mode passes the input through OPEN_ACTIONS_INPUT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-envjson-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "bun",
          args: ["-e", "console.log(JSON.stringify({ seen: process.env.OPEN_ACTIONS_INPUT }))"],
          inputMode: "env-json",
          outputMode: "json",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(run.output).toEqual({ seen: JSON.stringify({ name: "actions" }) });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("none input mode never sets OPEN_ACTIONS_INPUT", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-noinput-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "bun",
          args: ["-e", "console.log(JSON.stringify({ hasInput: 'OPEN_ACTIONS_INPUT' in process.env }))"],
          inputMode: "none",
          outputMode: "json",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect(run.output).toEqual({ hasInput: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the child environment is isolated unless inheritEnv is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-env-"));
    const marker = "ACTIONS_TEST_MARKER";
    const previous = process.env[marker];
    process.env[marker] = "ambient-value";
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const probe = ["-e", "console.log(JSON.stringify({ ambient: process.env.ACTIONS_TEST_MARKER ?? null, runId: process.env.OPEN_ACTIONS_RUN_ID ?? null }))"];

      const isolated = bindingManifest({
        id: "shell.env.isolated",
        executorBindings: [{ kind: "local-shell", command: "bun", args: probe, inheritEnv: false, outputMode: "json" }],
      });
      await client.register(createLocalShellAction(isolated));
      const isolatedRun = await client.run({ actionId: isolated.id, input: { name: "actions" }, dryRun: false });
      expect((isolatedRun.output as { ambient: string | null }).ambient).toBeNull();
      expect((isolatedRun.output as { runId: string | null }).runId).toBeTruthy();

      const inherited = bindingManifest({
        id: "shell.env.inherited",
        executorBindings: [{ kind: "local-shell", command: "bun", args: probe, inheritEnv: true, outputMode: "json" }],
      });
      await client.register(createLocalShellAction(inherited));
      const inheritedRun = await client.run({ actionId: inherited.id, input: { name: "actions" }, dryRun: false });
      expect((inheritedRun.output as { ambient: string | null }).ambient).toBe("ambient-value");
    } finally {
      if (previous === undefined) delete process.env[marker];
      else process.env[marker] = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("non-JSON stdout under json output mode fails the run with the parse error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-badjson-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "printf",
          args: ["not json at all"],
          outputMode: "json",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("JSON");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("localShellBinding rejects manifests without a local-shell binding", () => {
    const manifest = bindingManifest({ executorBindings: [{ kind: "typescript", ref: "nope" }] });
    expect(() => localShellBinding(manifest)).toThrow("does not have a local-shell executor binding");
  });

  test("high-risk shell actions carry an approval warning in the preview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-warn-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({ riskLevel: "high" });
      await client.register(createLocalShellAction(manifest));

      const preview = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: true });
      expect(preview.status).toBe("previewed");
      expect(preview.preview?.warnings).toContain("High-risk shell actions should be approved by policy before execution.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the shell action honors a custom cwd", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-cwd-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "pwd",
          cwd: dir,
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("succeeded");
      expect((run.output as string).trim()).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ShellActionError carries the full execution result", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-error-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = bindingManifest({
        executorBindings: [{
          kind: "local-shell",
          command: "sh",
          args: ["-c", "echo out; echo err >&2; exit 7"],
          outputMode: "text",
        }],
      });
      await client.register(createLocalShellAction(manifest));

      const run = await client.run({ actionId: manifest.id, input: { name: "actions" }, dryRun: false });
      expect(run.status).toBe("failed");
      expect(run.error).toContain("exit code 7");
      const error = new ShellActionError({
        status: "failed",
        command: "sh",
        args: ["-c", "echo out; echo err >&2; exit 7"],
        code: 7,
        signal: null,
        stdout: "out\n",
        stderr: "err\n",
      });
      expect(error.name).toBe("ShellActionError");
      expect(error.message).toContain("exit code 7");
      expect(error.result.code).toBe(7);
      expect(error.result.stderr).toBe("err\n");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
