import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { executeLoop } from "./executor.js";
import { Store } from "./store.js";

async function fakeCodewith(binDir: string, invocationsFile: string, opts: { profiles?: string } = {}): Promise<string> {
  const fake = join(binDir, "codewith");
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
      "if [[ \" $* \" == *\" agent start \"* ]]; then",
      "  printf '{\"agent\":{\"agentId\":\"agent-1\",\"status\":\"queued\",\"desiredState\":\"running\"},\"created\":true}\\n'",
      "  exit 0",
      "fi",
      "if [[ \" $* \" == *\" agent read \"* ]]; then",
      "  printf '{\"agent\":{\"agentId\":\"agent-1\",\"status\":\"completed\",\"desiredState\":\"running\",\"threadId\":\"thread-1\",\"rolloutPath\":\"/tmp/rollout.jsonl\",\"pid\":123},\"statusSnapshot\":{\"seq\":2,\"status\":\"completed\",\"summary\":\"Done\",\"pendingInteractionCount\":0,\"lastEventSeq\":2}}\\n'",
      "  exit 0",
      "fi",
      "if [[ \" $* \" == *\" agent logs \"* ]]; then",
      "  printf '{\"data\":[{\"agentId\":\"agent-1\",\"seq\":1,\"eventType\":\"agent.started\",\"payload\":{\"prompt\":\"say ok\"},\"createdAt\":1},{\"agentId\":\"agent-1\",\"seq\":2,\"eventType\":\"agent.completed\",\"payload\":{\"result\":\"ok\"},\"createdAt\":2}]}\\n'",
      "  exit 0",
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

  test("runs codewith through durable background-agent adapter", async () => {
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
      const startArgs = invocations.find((args) => args.includes("start"));
      expect(startArgs).toBeDefined();
      expect(startArgs?.slice(0, 2)).toEqual(["--ask-for-approval", "never"]);
      expect(startArgs).toContain("agent");
      expect(startArgs).toContain("start");
      expect(startArgs).toContain("--idempotency-key");
      expect(startArgs).toContain("--cwd");
      expect(startArgs).not.toContain("exec");
      expect(startArgs).not.toContain("--ephemeral");
      expect(invocations.some((args) => args.includes("read"))).toBe(true);
      expect(invocations.some((args) => args.includes("logs"))).toBe(true);
      expect(result.stdout).toContain("\"agentId\": \"agent-1\"");
      expect(result.stdout).toContain("agent.completed");
      expect(result.stdout).not.toContain("say ok");
    } finally {
      store.close();
    }
  });

  test("runs codewith with provider-native auth profile before durable start/read/logs", async () => {
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
      const startArgs = invocations.find((args) => args.includes("start"));
      expect(invocations.some((args) => args[0] === "profile" && args[1] === "list")).toBe(true);
      expect(startArgs?.slice(0, 4)).toEqual(["--auth-profile", "account001", "--ask-for-approval", "never"]);
      expect(startArgs).not.toContain("exec");
      expect(startArgs).not.toContain("--ephemeral");
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
      const args = codewithInvocations(invocationsFile).find((entry) => entry.includes("start"))!;
      expect(args[args.indexOf("--sandbox") + 1]).toBe("danger-full-access");
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
