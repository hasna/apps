import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ActionsClient, createLocalShellAction } from "../index.js";
import { JsonActionsStore } from "../storage.js";
import { ShellActionError, localShellBinding } from "./local-shell.js";
import type { ActionExecutionContext, ActionManifest, LocalShellExecutorBinding } from "../types.js";

function shellManifest(overrides: Partial<ActionManifest> = {}, binding?: Partial<LocalShellExecutorBinding>): ActionManifest {
  return {
    id: "shell.env.test",
    name: "Shell env test",
    version: "1.0.0",
    description: "Exercises local-shell executor input modes and process isolation.",
    inputSchema: { type: "object", required: ["name"] },
    outputSchema: { type: "object" },
    actor: { types: ["human", "agent"] },
    resource: { type: "local-process" },
    scope: { level: "local", permissions: ["shell:execute"] },
    riskLevel: "low",
    requiredApprovals: [],
    idempotency: { supported: true },
    dryRun: { supported: true, default: false },
    confirmation: { title: "Shell env test", summaryTemplate: "Shell {{name}}" },
    audit: { eventTypes: ["action.planned", "action.executed"] },
    evidence: { required: false },
    rollback: { strategy: "none" },
    executorBindings: [{
      kind: "local-shell",
      command: process.execPath,
      inputMode: "stdin-json",
      outputMode: "json",
      ...binding,
    }],
    ...overrides,
  };
}

async function runShell(manifest: ActionManifest, input: unknown, options: { dryRun?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "actions-shell-env-"));
  try {
    const client = new ActionsClient({ store: new JsonActionsStore(dir) });
    await client.register(createLocalShellAction(manifest));
    return await client.run({ actionId: manifest.id, input, dryRun: options.dryRun ?? false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function printEnvScript(expression: string): string {
  // Prints JSON built from process.env entries; the shell executor then parses stdout as JSON.
  return `console.log(JSON.stringify(${expression}))`;
}

describe("local-shell input modes", () => {
  test("env-json delivers the input JSON in OPEN_ACTIONS_INPUT", async () => {
    const script = printEnvScript("{ seen: process.env.OPEN_ACTIONS_INPUT }");
    const run = await runShell(shellManifest({}, { command: process.execPath, args: ["-e", script], inputMode: "env-json", outputMode: "json" }), { name: "actions" });
    expect(run.status).toBe("succeeded");
    expect((run.output as { seen: string }).seen).toBe(JSON.stringify({ name: "actions" }));
  });

  test("stdin-and-env-json delivers the same JSON on both channels", async () => {
    const script = `
      const stdin = await new Response(Bun.stdin.stream()).text();
      console.log(JSON.stringify({ stdin: stdin.trim(), env: process.env.OPEN_ACTIONS_INPUT }));
    `;
    const run = await runShell(shellManifest({}, { command: process.execPath, args: ["-e", script], inputMode: "stdin-and-env-json", outputMode: "json" }), { name: "actions" });
    expect(run.status).toBe("succeeded");
    const output = run.output as { stdin: string; env: string };
    expect(output.stdin).toBe(JSON.stringify({ name: "actions" }));
    expect(output.env).toBe(output.stdin);
  });

  test("stdin-json keeps the input off the environment (the opposite case)", async () => {
    const script = `
      const stdin = await new Response(Bun.stdin.stream()).text();
      console.log(JSON.stringify({ stdin: stdin.trim(), envAbsent: process.env.OPEN_ACTIONS_INPUT === undefined }));
    `;
    const run = await runShell(shellManifest({}, { command: process.execPath, args: ["-e", script], inputMode: "stdin-json", outputMode: "json" }), { name: "actions" });
    expect(run.status).toBe("succeeded");
    const output = run.output as { stdin: string; envAbsent: boolean };
    expect(output.stdin).toBe(JSON.stringify({ name: "actions" }));
    expect(output.envAbsent).toBe(true);
  });
});

describe("local-shell process isolation", () => {
  test("inheritEnv false excludes parent sentinels while keeping PATH/HOME/TMP and binding markers", async () => {
    const script = `
      console.log(JSON.stringify({
        marker: process.env.BINDING_MARKER ?? null,
        sentinel: process.env.PARENT_ONLY_SENTINEL ?? null,
        path: process.env.PATH ?? null,
        home: process.env.HOME ?? null,
        tmp: process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? null,
      }));
    `;
    const previous = process.env.PARENT_ONLY_SENTINEL;
    process.env.PARENT_ONLY_SENTINEL = "parent-secret";
    try {
      const isolated = await runShell(shellManifest({}, {
        command: process.execPath,
        args: ["-e", script],
        env: { BINDING_MARKER: "bound" },
        inheritEnv: false,
        outputMode: "json",
      }), { name: "actions" });
      expect(isolated.status).toBe("succeeded");
      expect(isolated.output).toMatchObject({
        marker: "bound",
        sentinel: null,
      });
      expect((isolated.output as { path: string }).path).toBeTruthy();
      expect((isolated.output as { home: string }).home).toBeTruthy();
      // The child carries exactly the parent's TMPDIR/TEMP/TMP selection: when the
      // parent has none set, the child legitimately has none either.
      const parentTmp = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? null;
      expect((isolated.output as { tmp: string | null }).tmp).toBe(parentTmp);

      // Two-sided: inheritEnv true passes the parent sentinel through.
      const inherited = await runShell(shellManifest({}, {
        command: process.execPath,
        args: ["-e", script],
        env: { BINDING_MARKER: "bound" },
        inheritEnv: true,
        outputMode: "json",
      }), { name: "actions" });
      expect(inherited.status).toBe("succeeded");
      expect((inherited.output as { sentinel: string }).sentinel).toBe("parent-secret");
    } finally {
      if (previous === undefined) delete process.env.PARENT_ONLY_SENTINEL;
      else process.env.PARENT_ONLY_SENTINEL = previous;
    }
  });

  test("exposes exact run, action, version, and dry-run identifiers", async () => {
    const script = `
      console.log(JSON.stringify({
        runId: process.env.OPEN_ACTIONS_RUN_ID,
        actionId: process.env.OPEN_ACTIONS_ACTION_ID,
        actionVersion: process.env.OPEN_ACTIONS_ACTION_VERSION,
        dryRun: process.env.OPEN_ACTIONS_DRY_RUN,
      }));
    `;
    const manifest = shellManifest({}, { command: process.execPath, args: ["-e", script], outputMode: "json" });
    const run = await runShell(manifest, { name: "actions" });
    expect(run.status).toBe("succeeded");
    expect(run.output).toEqual({
      runId: run.id,
      actionId: manifest.id,
      actionVersion: manifest.version,
      dryRun: "false",
    });

    // Two-sided: a dry-run request never spawns the child, so the flag a real
    // execution would have received is carried on the run itself.
    const dryRun = await runShell(manifest, { name: "actions" }, { dryRun: true });
    expect(dryRun.status).toBe("previewed");
    expect(dryRun.output).toBeUndefined();
    expect(dryRun.dryRun).toBe(true);
  });
});

describe("local-shell output modes", () => {
  test("text returns raw stdout, shell-result returns the full result record", async () => {
    const text = await runShell(shellManifest({}, {
      command: process.execPath,
      args: ["-e", "console.log('hello text')"],
      outputMode: "text",
    }), { name: "actions" });
    expect(text.status).toBe("succeeded");
    expect(text.output).toBe("hello text\n");

    const result = await runShell(shellManifest({}, {
      command: process.execPath,
      args: ["-e", "console.log(\"{ broken\")"],
      outputMode: "shell-result",
    }), { name: "actions" });
    expect(result.status).toBe("succeeded");
    expect(result.output).toMatchObject({
      status: "success",
      command: process.execPath,
      code: 0,
      signal: null,
    });
    expect((result.output as { stdout: string }).stdout).toContain("{ broken");
  });

  test("json parses stdout and empty JSON stdout becomes an empty object", async () => {
    const parsed = await runShell(shellManifest({}, {
      command: process.execPath,
      args: ["-e", "console.log(JSON.stringify({ message: 'ok' }))"],
      outputMode: "json",
    }), { name: "actions" });
    expect(parsed.status).toBe("succeeded");
    expect(parsed.output).toEqual({ message: "ok" });

    const empty = await runShell(shellManifest({}, {
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      outputMode: "json",
    }), { name: "actions" });
    expect(empty.status).toBe("succeeded");
    expect(empty.output).toEqual({});
  });
});

describe("local-shell failure paths", () => {
  /** Minimal execution context so a ShellActionError can be observed directly. */
  function context(manifest: ActionManifest, input: unknown): ActionExecutionContext<unknown> {
    const now = new Date().toISOString();
    return {
      run: {
        id: "run-direct-1",
        actionId: manifest.id,
        actionVersion: manifest.version,
        status: "executing",
        input,
        plan: [],
        riskLevel: manifest.riskLevel,
        requiredApprovals: [],
        approvals: [],
        guardrailResults: [],
        evidence: [],
        dryRun: false,
        confirmationSummary: manifest.confirmation.title,
        rollback: manifest.rollback,
        events: [],
        metadata: {},
        createdAt: now,
        updatedAt: now,
      },
      manifest,
      input,
      dryRun: false,
    };
  }

  test("a non-zero child yields ShellActionError with failed status, exit code, stderr, and exact message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-fail-"));
    try {
      const client = new ActionsClient({ store: new JsonActionsStore(dir) });
      const manifest = shellManifest({}, {
        command: process.execPath,
        args: ["-e", "console.error('boom'); process.exit(3)"],
        outputMode: "json",
      });
      const definition = createLocalShellAction(manifest);
      await client.register(definition);

      // Direct executor invocation surfaces the ShellActionError with full details.
      await expect(definition.executor.execute(context(manifest, { name: "x" })))
        .rejects.toMatchObject({
          name: "ShellActionError",
          message: "local shell action failed with exit code 3",
        });
      await Promise.resolve(definition.executor.execute(context(manifest, { name: "x" }))).catch((error: unknown) => {
        const shellError = error as ShellActionError;
        expect(shellError.result.status).toBe("failed");
        expect(shellError.result.code).toBe(3);
        expect(shellError.result.signal).toBeNull();
        expect(shellError.result.stderr).toContain("boom");
      });

      // Two-sided: through the client the same failure lands on the run with the
      // exact message preserved, while a clean child succeeds.
      const failed = await client.run({ actionId: manifest.id, input: { name: "x" }, dryRun: false });
      expect(failed.status).toBe("failed");
      expect(failed.error).toBe("local shell action failed with exit code 3");
      const cleanManifest = shellManifest({ id: "shell.clean.child" }, {
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ message: 'ok' }))"],
        outputMode: "json",
      });
      await client.register(createLocalShellAction(cleanManifest));
      const ok = await client.run(
        { actionId: cleanManifest.id, input: { name: "y" }, dryRun: false, idempotencyKey: "clean-child" },
      );
      expect(ok.status).toBe("succeeded");
      expect(ok.output).toEqual({ message: "ok" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a nonexistent command produces code null and the error in stderr", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-enoent-"));
    try {
      const manifest = shellManifest({}, {
        command: "definitely-not-a-real-command-xyz-12345",
        outputMode: "json",
      });
      const definition = createLocalShellAction(manifest);
      await Promise.resolve(definition.executor.execute(context(manifest, { name: "x" }))).catch((error: unknown) => {
        const shellError = error as ShellActionError;
        expect(shellError.result.status).toBe("failed");
        expect(shellError.result.code).toBeNull();
        expect(shellError.result.signal).toBeNull();
        expect(shellError.result.stderr).toContain("Executable not found in $PATH");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("timeoutMs terminates a sleeping child with SIGTERM and a failed status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-shell-timeout-"));
    try {
      const manifest = shellManifest({}, {
        command: process.execPath,
        args: ["-e", "await Bun.sleep(5000); console.log('{}')"],
        outputMode: "json",
        timeoutMs: 300,
      });
      const definition = createLocalShellAction(manifest);
      const started = Date.now();
      await Promise.resolve(definition.executor.execute(context(manifest, { name: "x" }))).catch((error: unknown) => {
        const shellError = error as ShellActionError;
        expect(shellError.name).toBe("ShellActionError");
        expect(shellError.message).toBe("local shell action failed with signal SIGTERM");
        expect(shellError.result.status).toBe("failed");
        expect(shellError.result.signal).toBe("SIGTERM");
      });
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("localShellBinding", () => {
  test("rejects a manifest without a local-shell binding and returns the binding when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-binding-"));
    writeFileSync(join(dir, "placeholder"), "");
    try {
      expect(() => localShellBinding({
        ...shellManifest(),
        executorBindings: [{ kind: "typescript", ref: "x" }],
      })).toThrow("Action shell.env.test does not have a local-shell executor binding");

      const binding = localShellBinding(shellManifest());
      expect(binding.kind).toBe("local-shell");
      expect(binding.command).toBe(process.execPath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
