import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { AgentTarget } from "../types.js";
import { BoundedOutputBuffer, PROVIDER_ADAPTERS, providerAdapter, spawnCapture } from "./agent-adapter.js";
import { executeLoop } from "./executor.js";
import { Store } from "./store.js";

async function fakeCodewith(
  binDir: string,
  invocationsFile: string,
  opts: { profiles?: string; execStdout?: string; execExitCode?: number } = {},
): Promise<string> {
  const fake = join(binDir, "codewith");
  // `codewith exec --json` streams JSONL events to stdout and exits 0 on success.
  const execStdout = opts.execStdout ?? '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}';
  const execStdoutDelimiter = "__OPENLOOPS_FAKE_CODEWITH_EXEC_STDOUT__";
  await Bun.write(
    fake,
    [
      "#!/usr/bin/env bash",
      "printf '%s\\0' \"$@\" >> \"$OPENLOOPS_FAKE_CODEWITH_INVOCATIONS\"",
      "printf '\\n' >> \"$OPENLOOPS_FAKE_CODEWITH_INVOCATIONS\"",
      "if [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then",
      `  printf ${JSON.stringify(opts.profiles ?? "NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n")}`,
      "  exit 0",
      "fi",
      "if [[ \" $* \" == *\" exec \"* ]]; then",
      // Optional stall (no output) so the generic idle watchdog can reap it.
      "  if [[ -n \"${OPENLOOPS_FAKE_CODEWITH_SLEEP:-}\" ]]; then sleep \"$OPENLOOPS_FAKE_CODEWITH_SLEEP\"; fi",
      `  cat <<'${execStdoutDelimiter}'`,
      execStdout.endsWith("\n") ? execStdout.slice(0, -1) : execStdout,
      execStdoutDelimiter,
      // Echo the stdin-delivered prompt so tests can assert prompt-on-stdin.
      "  printf 'stdin:'",
      "  cat",
      `  exit ${opts.execExitCode ?? 0}`,
      "fi",
      "printf 'unexpected codewith invocation: %s\\n' \"$*\" >&2",
      "exit 64",
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
  return fake;
}

function codewithInvocations(file: string): string[][] {
  return readFileSync(file, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((line) => line.split("\0").filter(Boolean));
}

describe("agent adapters", () => {
  test("runs opencode through a machine-readable fake binary contract", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-agent-"));
    const fake = join(binDir, "opencode");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "opencode",
          prompt: "say ok",
          cwd: ".",
          model: "openrouter/google/gemini-2.5-flash",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("run");
      expect(result.stdout).toContain("--format");
      expect(result.stdout).toContain("json");
      expect(result.stdout).toContain("--pure");
      expect(result.stdout).toContain("--model");
      expect(result.stdout).toContain("openrouter/google/gemini-2.5-flash");
      expect(result.stdout).toContain("stdin:say ok");
      expect(result.stdout.trim().split(/\r?\n/)).not.toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("runs codex through exec json adapter", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codex-"));
    const fake = join(binDir, "codex");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codex-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codex",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args).toContain("exec");
      expect(args).toContain("--json");
      expect(args).toContain("--ephemeral");
      expect(args).toContain("--ignore-rules");
      expect(args).toContain("--skip-git-repo-check");
      expect(args).toContain("--ask-for-approval");
      expect(args[args.indexOf("--ask-for-approval") + 1]).toBe("never");
      expect(args).toContain("stdin:say ok");
      expect(args).not.toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("runs codewith through the non-interactive exec adapter", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile },
      });
      expect(result.status).toBe("succeeded");
      const invocations = codewithInvocations(invocationsFile);
      const execArgs = invocations.find((args) => args.includes("exec"));
      expect(execArgs).toBeDefined();
      const approvalIdx = execArgs!.indexOf("--ask-for-approval");
      expect(approvalIdx).toBeGreaterThanOrEqual(0);
      expect(execArgs![approvalIdx + 1]).toBe("never");
      expect(execArgs![approvalIdx + 2]).toBe("exec");
      expect(execArgs).toContain("--json");
      expect(execArgs).toContain("--ephemeral");
      expect(execArgs).toContain("--skip-git-repo-check");
      expect(execArgs).toContain("--cd");
      // default sandbox is workspace-write, which must opt back into network egress
      expect(execArgs?.[execArgs.indexOf("--sandbox") + 1]).toBe("workspace-write");
      expect(execArgs).toContain("sandbox_workspace_write.network_access=true");
      // no legacy durable agent lifecycle commands
      expect(execArgs).not.toContain("agent");
      expect(execArgs).not.toContain("start");
      expect(invocations.some((args) => args.includes("read"))).toBe(false);
      expect(invocations.some((args) => args.includes("logs"))).toBe(false);
      // prompt travels on stdin, never argv
      expect(execArgs).not.toContain("say ok");
      expect(result.stdout).toContain("item.completed");
      expect(result.stdout).toContain("stdin:say ok");
    } finally {
      store.close();
    }
  });

  test("reconciles failed codewith exec status when jsonl later emits task_complete", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-reconcile-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile, {
      execExitCode: 7,
      execStdout: [
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "statusSnapshot",
            status: "failed",
            agent_id: "cli-test-agent",
            thread_id: "019f1ffb-91b0-7292-b117-605c54be6a69",
          },
        }),
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "task_complete",
            turn_id: "019f1ffb-93c1-7ba0-97d2-368596c0db11",
            completed_at: 1782948553,
          },
        }),
      ].join("\n"),
    });

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-reconciled-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile },
      });
      expect(result.status).toBe("succeeded");
      expect(result.exitCode).toBe(7);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain("task_complete");
    } finally {
      store.close();
    }
  });

  test("keeps failed codewith exec status when jsonl lacks terminal success", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-failed-snapshot-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile, {
      execExitCode: 7,
      execStdout: JSON.stringify({
        type: "event_msg",
        payload: {
          type: "statusSnapshot",
          status: "failed",
          agent_id: "cli-test-agent",
        },
      }),
    });

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-failed-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile },
      });
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(7);
      expect(result.error).toContain("process exited with code 7");
    } finally {
      store.close();
    }
  });

  test("runs codewith with a provider-native auth profile before exec", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-auth-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-profile-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          authProfile: "account001",
          prompt: "say ok",
          cwd: ".",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile },
      });
      expect(result.status).toBe("succeeded");
      const invocations = codewithInvocations(invocationsFile);
      const execArgs = invocations.find((args) => args.includes("exec"));
      expect(invocations.some((args) => args[0] === "profile" && args[1] === "list")).toBe(true);
      expect(execArgs?.slice(0, 2)).toEqual(["--auth-profile", "account001"]);
      const approvalIdx = execArgs!.indexOf("--ask-for-approval");
      expect(approvalIdx).toBeGreaterThanOrEqual(0);
      expect(execArgs![approvalIdx + 1]).toBe("never");
      expect(execArgs![approvalIdx + 2]).toBe("exec");
    } finally {
      store.close();
    }
  });

  test("runs codewith with an explicit sandbox", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-sandbox-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-sandbox-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          sandbox: "danger-full-access",
          addDirs: ["/tmp/hasna-todos", "/tmp/hasna-loops"],
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile },
      });
      expect(result.status).toBe("succeeded");
      const args = codewithInvocations(invocationsFile).find((entry) => entry.includes("exec"))!;
      expect(args[args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
      // danger-full-access already has network; no workspace-write override needed
      expect(args).not.toContain("sandbox_workspace_write.network_access=true");
      expect(args).toContain("--add-dir");
      expect(args[args.indexOf("--add-dir") + 1]).toBe("/tmp/hasna-todos");
      expect(args).toContain("/tmp/hasna-loops");
    } finally {
      store.close();
    }
  });

  test("maps claude permission mode and variant to native flags", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-claude-mode-"));
    const fake = join(binDir, "claude");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "claude-mode-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "say ok",
          permissionMode: "plan",
          variant: "high",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args).toContain("--permission-mode");
      expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
      expect(args).toContain("--effort");
      expect(args[args.indexOf("--effort") + 1]).toBe("high");
      expect(args).toContain("stdin:say ok");
    } finally {
      store.close();
    }
  });

  test("maps cursor bypass mode and sandbox to native flags", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-cursor-mode-"));
    const fake = join(binDir, "agent");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);
    const fakeCursor = join(binDir, "cursor");
    await Bun.write(fakeCursor, "#!/usr/bin/env bash\necho 'cursor wrapper should not be used when standalone agent exists' >&2\nexit 64\n");
    chmodSync(fakeCursor, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "cursor-mode-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "say ok",
          permissionMode: "bypass",
          sandbox: "disabled",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args).toContain("-p");
      expect(args).toContain("--force");
      expect(args).toContain("--sandbox");
      expect(args[args.indexOf("--sandbox") + 1]).toBe("disabled");
      expect(args).toContain("stdin:say ok");
    } finally {
      store.close();
    }
  });

  test("enables cursor sandbox by default in safe isolation", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-cursor-safe-"));
    const fake = join(binDir, "agent");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);
    const fakeCursor = join(binDir, "cursor");
    await Bun.write(fakeCursor, "#!/usr/bin/env bash\necho 'cursor wrapper should not be used when standalone agent exists' >&2\nexit 64\n");
    chmodSync(fakeCursor, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "cursor-safe-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args).toContain("--sandbox");
      expect(args[args.indexOf("--sandbox") + 1]).toBe("enabled");
    } finally {
      store.close();
    }
  });

  test("rejects cursor addDirs instead of silently ignoring them", async () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createLoop({
          name: "cursor-add-dir-agent",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "cursor",
            prompt: "say ok",
            addDirs: ["/tmp/hasna-todos"],
            configIsolation: "safe",
          },
        }),
      ).toThrow("addDirs is currently supported only for provider codewith or codex");
    } finally {
      store.close();
    }
  });

  test("rejects provider-invalid SDK-created agent target options", async () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createLoop({
          name: "bad-agent-options",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "say ok",
            sandbox: "danger-full-access",
            configIsolation: "safe",
          },
        }),
      ).toThrow("sandbox is currently supported only for provider codewith, codex, or cursor");
    } finally {
      store.close();
    }
  });

  test("rejects SDK-created provider options that adapters do not support", async () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createLoop({
          name: "bad-cursor-variant-agent",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "cursor",
            prompt: "say ok",
            variant: "max",
            configIsolation: "safe",
          },
        }),
      ).toThrow("variant is not supported for provider cursor");

      expect(() =>
        store.createLoop({
          name: "bad-codex-agent",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "codex",
            prompt: "say ok",
            agent: "reviewer",
            configIsolation: "safe",
          },
        }),
      ).toThrow("agent is not supported for provider codex");
    } finally {
      store.close();
    }
  });

  test("rejects invalid SDK-created config isolation", async () => {
    const store = new Store(":memory:");
    try {
      expect(() =>
        store.createLoop({
          name: "bad-config-isolation-agent",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "say ok",
            configIsolation: "sfae" as "safe",
          },
        }),
      ).toThrow("configIsolation");
    } finally {
      store.close();
    }
  });

  test("reaps codewith exec runs that stall without output past the idle timeout", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-codewith-idle-"));
    const invocationsFile = join(binDir, "invocations");
    await fakeCodewith(binDir, invocationsFile);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "codewith-idle-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: "say ok",
          cwd: ".",
          idleTimeoutMs: 150,
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: {
          ...process.env,
          PATH: `${binDir}:${process.env.PATH}`,
          OPENLOOPS_FAKE_CODEWITH_INVOCATIONS: invocationsFile,
          // exec sleeps with no output; the generic watchdog must reap it.
          OPENLOOPS_FAKE_CODEWITH_SLEEP: "5",
        },
      });
      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("idle timed out after 150ms without stdout/stderr");
      expect(codewithInvocations(invocationsFile).some((args) => args.includes("exec"))).toBe(true);
    } finally {
      store.close();
    }
  });

  test("maps aicopilot bypass mode and variant to native flags", async () => {
    const binDir = mkdtempSync(join(tmpdir(), "loops-aicopilot-mode-"));
    const fake = join(binDir, "aicopilot");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "aicopilot-mode-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "aicopilot",
          prompt: "say ok",
          cwd: ".",
          permissionMode: "bypass",
          variant: "max",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      expect(result.status).toBe("succeeded");
      const args = result.stdout.trim().split(/\r?\n/);
      expect(args.slice(0, 3)).toEqual(["run", "--format", "json"]);
      expect(args).toContain("--dangerously-skip-permissions");
      expect(args).toContain("--variant");
      expect(args[args.indexOf("--variant") + 1]).toBe("max");
      expect(args).toContain("stdin:say ok");
    } finally {
      store.close();
    }
  });
});

describe("provider adapter contracts", () => {
  const baseTarget = (overrides: Partial<AgentTarget> & Pick<AgentTarget, "provider">): AgentTarget =>
    ({ type: "agent", prompt: "say ok", ...overrides }) as AgentTarget;

  test("declares provider capabilities including prompt channel", () => {
    expect(providerAdapter("codewith").capabilities).toEqual({
      sandbox: ["read-only", "workspace-write", "danger-full-access"],
      durable: false,
      remote: true,
      promptChannel: "stdin",
    });
    expect(providerAdapter("claude").capabilities.promptChannel).toBe("stdin");
    expect(providerAdapter("claude").capabilities.durable).toBe(false);
    expect(providerAdapter("cursor").capabilities.sandbox).toEqual(["enabled", "disabled"]);
    for (const adapter of Object.values(PROVIDER_ADAPTERS)) {
      expect(adapter.capabilities.promptChannel).toBe("stdin");
      expect(adapter.capabilities.remote).toBe(true);
    }
  });

  test("keeps prompts off argv for stdin-channel providers", () => {
    const invocation = providerAdapter("claude").buildInvocation(baseTarget({ provider: "claude", prompt: "secret-prompt" }));
    expect(invocation.command).toBe("claude");
    expect(invocation.stdin).toBe("secret-prompt");
    expect(invocation.args).not.toContain("secret-prompt");
  });

  test("keeps the codewith exec prompt on stdin, off argv", () => {
    // `codewith exec` reads instructions from stdin when no positional prompt is
    // given, so the (possibly large) prompt never lands on argv.
    const invocation = providerAdapter("codewith").buildInvocation(baseTarget({ provider: "codewith", prompt: "exec-prompt" }));
    expect(invocation.command).toBe("codewith");
    expect(invocation.stdin).toBe("exec-prompt");
    expect(invocation.args).toContain("exec");
    expect(invocation.args).not.toContain("exec-prompt");
  });

  test("throws aligned creation/execution validation errors", () => {
    expect(() => providerAdapter("claude").validate(baseTarget({ provider: "claude", sandbox: "read-only" }))).toThrow(
      "claude.sandbox is currently supported only for provider codewith, codex, or cursor",
    );
    expect(() => providerAdapter("cursor").validate(baseTarget({ provider: "cursor", variant: "max" }))).toThrow(
      "cursor.variant is not supported for provider cursor",
    );
    expect(() => providerAdapter("codex").validate(baseTarget({ provider: "codex", agent: "reviewer" }))).toThrow(
      "codex.agent is not supported for provider codex",
    );
    expect(() => providerAdapter("codewith").validate(baseTarget({ provider: "codewith", extraArgs: ["exec"] }))).toThrow(
      "codewith.extraArgs cannot include exec; codewith exec launch flags are managed by the adapter",
    );
    expect(() => providerAdapter("opencode").validate(baseTarget({ provider: "opencode" }))).toThrow(
      "opencode.model is required for provider opencode",
    );
    expect(() => providerAdapter("aicopilot").validate(baseTarget({ provider: "aicopilot", permissionMode: "plan" }))).toThrow(
      "aicopilot.permissionMode plan is currently supported only for provider claude or cursor",
    );
    expect(() => providerAdapter("claude").validate(baseTarget({ provider: "claude", authProfile: "work" }), "step.target")).toThrow(
      "step.target.authProfile is currently supported only for provider codewith",
    );
  });

  test("spawnCapture enforces explicit timeouts without blocking", async () => {
    const started = Date.now();
    const result = await spawnCapture("bash", ["-c", "sleep 5"], { timeoutMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.error).toContain("timed out after 100ms");
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  test("spawnCapture reports missing executables as errors", async () => {
    const result = await spawnCapture("openloops-definitely-missing-binary", [], { timeoutMs: 1_000 });
    expect(result.status).toBe(null);
    expect(result.error).toBeDefined();
  });

  test("spawnCapture decodes multi-byte output split across pipe chunks without corruption", async () => {
    // >64KiB of 3-byte CJK guarantees a UTF-8 sequence straddles a pipe-chunk boundary.
    const expected = "好".repeat(40_000);
    const result = await spawnCapture(process.execPath, ["-e", 'process.stdout.write("好".repeat(40000))'], {
      timeoutMs: 30_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("�");
    expect(result.stdout).toBe(expected);
  });

  test("spawnCapture truncates multi-byte output by bytes at a UTF-8 boundary", async () => {
    const maxOutputBytes = 64 * 1024;
    const result = await spawnCapture(process.execPath, ["-e", 'process.stdout.write("好".repeat(100000))'], {
      timeoutMs: 30_000,
      maxOutputBytes,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("�");
    const marker = /^\[truncated (\d+) bytes\]\n/.exec(result.stdout);
    expect(marker).not.toBeNull();
    const retained = result.stdout.slice(marker![0].length);
    expect(Buffer.byteLength(retained, "utf8")).toBeLessThanOrEqual(maxOutputBytes);
    expect(retained).toMatch(/^好+$/);
    // The marker reports the cumulative dropped byte count, not the last call's.
    expect(Number(marker![1])).toBe(300_000 - Buffer.byteLength(retained, "utf8"));
  });

  test("BoundedOutputBuffer scrubs credentials before a cut can bisect them", () => {
    const key = `sk-ant-${"a1b2C3d4".repeat(10)}`; // 87 chars
    const buffer = new BoundedOutputBuffer(64);
    // Overflow lands the byte cut inside `key` (127 - 64 = byte 63): cutting
    // first would retain a prefix-less key fragment no scrub pattern matches.
    buffer.append(key + "y".repeat(40));
    const value = buffer.value();
    expect(value).not.toContain(key.slice(63));
    expect(value).toContain("[SCRUBBED]");
  });
});
