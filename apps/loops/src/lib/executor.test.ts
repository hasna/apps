import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { defaultAgentIdleTimeoutMs, executeLoop, preflightTarget, type SpawnedProcessInfo } from "./executor.js";
import { openGate, waitUntil } from "../test-helpers.js";

function gateWaitScript(gate: string): string {
  return `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.02; done\n`;
}

function writeFakeCodewithProfileList(fake: string, output: string, exitCode = 0): void {
  const delimiter = "__OPENLOOPS_FAKE_CODEWITH_PROFILE_LIST__";
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      'if [[ "${1:-}" == "profile" && "${2:-}" == "list" ]]; then',
      `cat <<'${delimiter}'`,
      output.endsWith("\n") ? output.slice(0, -1) : output,
      delimiter,
      `exit ${exitCode}`,
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
}

function remoteCodewithPreflightOptions(home: string, scriptFile?: string) {
  const runner = scriptFile
    ? `cat > ${JSON.stringify(scriptFile)}; HOME=${JSON.stringify(home)} PATH=/usr/bin:/bin bash ${JSON.stringify(scriptFile)}`
    : `HOME=${JSON.stringify(home)} PATH=/usr/bin:/bin bash -s`;
  return {
    machine: { id: "remote-test", local: false, route: "ssh" as const },
    machineResolver: (machine: NonNullable<ReturnType<Store["createLoop"]>["machine"]>) => ({
      ...machine,
      local: false,
      route: "ssh" as const,
    }),
    env: { HOME: home, PATH: "/usr/bin:/bin" },
    machineCommandResolver: () => ({
      command: "bash",
      args: ["-c", runner],
      source: "ssh" as const,
    }),
  };
}

describe("executeLoop", () => {
  const remoteHooks = {
    machineResolver: (machine: NonNullable<ReturnType<Store["createLoop"]>["machine"]>) => ({
      ...machine,
      local: false,
      route: "ssh" as const,
    }),
    machineCommandResolver: () => ({
      command: "bash",
      args: ["-c", "bash -s"],
      source: "ssh",
    }),
  };

  test("runs deterministic command targets", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "echo",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: "printf hello", shell: true, timeoutMs: 5_000 },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run);
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("hello");
    } finally {
      store.close();
    }
  });

  test("times out silent commands with idleTimeoutMs", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "idle-timeout",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "command",
          command: "sleep 5",
          shell: true,
          timeoutMs: 10_000,
          idleTimeoutMs: 50,
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run);
      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("idle timed out");
    } finally {
      store.close();
    }
  });

  test("allows explicit unlimited command timeout", async () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "unlimited-command",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: "sleep 0.1; printf done", shell: true, timeoutMs: null },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run);
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("done");
    } finally {
      store.close();
    }
  });

  test("agent targets default to unlimited hard timeout", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-timeout-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/usr/bin/env bash\nsleep 0.1\nprintf agent-done\ncat >/dev/null\n");
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "agent-default-unlimited",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "agent", provider: "claude", prompt: "work" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("agent-done");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exposes agent allowlist contract to provider environment", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-allowlist-env-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(
      claude,
      [
        "#!/usr/bin/env bash",
        "printf 'commands=%s\\n' \"$LOOPS_AGENT_ALLOWED_COMMANDS\"",
        "printf 'tools=%s\\n' \"$LOOPS_AGENT_ALLOWED_TOOLS\"",
        "printf 'reason=%s\\n' \"$LOOPS_AGENT_ALLOWLIST_SAFETY_REASON\"",
        "printf 'contract=%s\\n' \"$LOOPS_AGENT_SESSION_CONTRACT\"",
        "cat >/dev/null",
        "",
      ].join("\n"),
    );
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "agent-allowlist-env",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "work",
          cwd: root,
          routing: { taskId: "task-123" },
          allowlist: {
            tools: ["functions.exec_command"],
            commands: ["git", "bun"],
            enforcement: "metadata_only",
            safetyReason: "scoped repo maintenance",
          },
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("commands=git,bun");
      expect(result.stdout).toContain("tools=functions.exec_command");
      expect(result.stdout).toContain("reason=scoped repo maintenance");
      const contractLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("contract="));
      expect(contractLine).toBeTruthy();
      const contract = JSON.parse(contractLine!.slice("contract=".length));
      expect(contract).toMatchObject({
        provider: "claude",
        cwd: root,
        taskId: "task-123",
        allowedCommands: ["git", "bun"],
        allowedTools: ["functions.exec_command"],
        enforcement: "metadata_only",
        safetyReason: "scoped repo maintenance",
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("applies a default idle watchdog to agent targets without explicit timeouts", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-watchdog-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/usr/bin/env bash\nsleep 5\n");
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "agent-default-watchdog",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "agent", provider: "claude", prompt: "work" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, LOOPS_AGENT_IDLE_TIMEOUT_MS: "75" },
      });
      expect(result.status).toBe("timed_out");
      expect(result.error).toContain("idle timed out after 75ms");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("explicit unlimited agent timeout disables the default idle watchdog", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-null-timeout-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, "#!/usr/bin/env bash\nsleep 0.3\nprintf late-output\ncat >/dev/null\n");
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "agent-null-timeout",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "agent", provider: "claude", prompt: "work", timeoutMs: null },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, LOOPS_AGENT_IDLE_TIMEOUT_MS: "50" },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("late-output");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("default idle watchdog can be disabled and scales for buffered-output providers", () => {
    const claudeTarget = { type: "agent", provider: "claude", prompt: "work" } as const;
    const codexTarget = { type: "agent", provider: "codex", prompt: "work" } as const;
    // Buffered-output providers (claude prints nothing until completion) get a larger budget.
    expect(defaultAgentIdleTimeoutMs(claudeTarget, { env: {} as NodeJS.ProcessEnv })).toBe(4 * 60 * 60_000);
    expect(defaultAgentIdleTimeoutMs(codexTarget, { env: {} as NodeJS.ProcessEnv })).toBe(30 * 60_000);
    // Explicit env override still wins.
    expect(defaultAgentIdleTimeoutMs(claudeTarget, { env: { LOOPS_AGENT_IDLE_TIMEOUT_MS: "75" } as NodeJS.ProcessEnv })).toBe(75);
    // 0/none/off disable the default watchdog entirely.
    for (const raw of ["0", "none", "off", "NONE"]) {
      expect(defaultAgentIdleTimeoutMs(claudeTarget, { env: { LOOPS_AGENT_IDLE_TIMEOUT_MS: raw } as NodeJS.ProcessEnv })).toBeUndefined();
      expect(defaultAgentIdleTimeoutMs(codexTarget, { env: { LOOPS_AGENT_IDLE_TIMEOUT_MS: raw } as NodeJS.ProcessEnv })).toBeUndefined();
    }
    // Explicit per-target timeouts opt out of the default watchdog.
    expect(defaultAgentIdleTimeoutMs({ ...claudeTarget, timeoutMs: null }, { env: {} as NodeJS.ProcessEnv })).toBeUndefined();
    expect(defaultAgentIdleTimeoutMs({ ...claudeTarget, idleTimeoutMs: 1_000 }, { env: {} as NodeJS.ProcessEnv })).toBeUndefined();
  });

  test("reports pid, pgid, and processStartedAt for spawned children", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-pgid-report-"));
    const gate = join(root, "gate");
    try {
      const loop = store.createLoop({
        name: "pgid-report",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: gateWaitScript(gate).trim(), shell: true, timeoutMs: 5_000 },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      let info: SpawnedProcessInfo | undefined;
      let statPgid: number | undefined;
      const result = await executeLoop(loop, claim!.run, {
        onSpawnProcess: (spawned) => {
          info = spawned;
          if (existsSync(`/proc/${spawned.pid}/stat`)) {
            const stat = readFileSync(`/proc/${spawned.pid}/stat`, "utf8");
            const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
            statPgid = Number(rest[2]);
          }
          openGate(gate);
        },
      });
      expect(result.status).toBe("succeeded");
      expect(info).toBeDefined();
      expect(info!.pgid).toBe(info!.pid);
      expect(Number.isNaN(new Date(info!.processStartedAt).getTime())).toBe(false);
      if (statPgid !== undefined) expect(statPgid).toBe(info!.pid);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  describe("worktree enforcement", () => {
    function initRepo(root: string): string {
      const repo = join(root, "repo");
      mkdirSync(repo, { recursive: true });
      execFileSync("git", ["init", "-q", repo]);
      execFileSync("git", ["-C", repo, "-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "--allow-empty", "-m", "init"], {
        stdio: "ignore",
      });
      return repo;
    }

    function fakePwdBinary(root: string): string {
      const bin = join(root, "bin");
      mkdirSync(bin, { recursive: true });
      const claude = join(bin, "claude");
      writeFileSync(claude, "#!/usr/bin/env bash\npwd\ncat >/dev/null\n");
      chmodSync(claude, 0o755);
      return bin;
    }

    test("prepares and enters a required git worktree before spawning", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-required-"));
      const repo = initRepo(root);
      const bin = fakePwdBinary(root);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-required",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "required",
              enabled: true,
              originalCwd: repo,
              cwd: wtPath,
              repoRoot: repo,
              root: join(root, "worktrees"),
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stdout.trim()).toBe(realpathSync(wtPath));
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");

        const again = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(again.status).toBe("succeeded");
        expect(again.stdout.trim()).toBe(realpathSync(wtPath));
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("fails closed when required worktree preparation fails", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-fail-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const bin = fakePwdBinary(root);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-fail-closed",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "work",
            configIsolation: "safe",
            cwd: notRepo,
            timeoutMs: 30_000,
            worktree: {
              mode: "required",
              enabled: true,
              originalCwd: notRepo,
              cwd: wtPath,
              repoRoot: notRepo,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe("failed");
        expect(result.error).toContain("worktree preparation failed (mode=required)");
        expect(result.stdout).toBe("");
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("remote execution fails closed when required worktree preparation fails", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-remote-"));
      const home = join(root, "home");
      const binDir = join(home, ".local", "bin");
      mkdirSync(binDir, { recursive: true });
      const fake = join(binDir, "claude");
      writeFileSync(fake, "#!/usr/bin/env bash\nprintf remote-agent-ran\ncat >/dev/null\n");
      chmodSync(fake, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-remote-required",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "required",
              enabled: true,
              originalCwd: root,
              cwd: wtPath,
              // Not a git repository: native preparation must fail closed.
              repoRoot: root,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
          machine: { id: "remote-test", local: false, route: "ssh" },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(result.status).toBe("failed");
        expect(result.stderr).toContain("worktree repoRoot is not a git repository");
        expect(result.stderr).toContain("worktree preparation failed (mode=required)");
        expect(result.stdout).not.toContain("remote-agent-ran");
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("remote execution natively prepares and enters a required worktree", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-remote-prepare-"));
      const repo = initRepo(root);
      const home = join(root, "home");
      const binDir = join(home, ".local", "bin");
      mkdirSync(binDir, { recursive: true });
      const fake = join(binDir, "claude");
      writeFileSync(fake, "#!/usr/bin/env bash\npwd\ncat >/dev/null\n");
      chmodSync(fake, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-remote-prepare",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "required",
              enabled: true,
              originalCwd: repo,
              cwd: wtPath,
              repoRoot: repo,
              root: join(root, "worktrees"),
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
          machine: { id: "remote-test", local: false, route: "ssh" },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stdout.trim()).toBe(wtPath);
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");

        // Second run reuses the existing worktree.
        const again = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(again.status).toBe("succeeded");
        expect(again.stdout.trim()).toBe(wtPath);
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("remote auto worktree fallback runs the rebuilt invocation against the original checkout", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-remote-auto-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const home = join(root, "home");
      const binDir = join(home, ".local", "bin");
      mkdirSync(binDir, { recursive: true });
      const fake = join(binDir, "codex");
      writeFileSync(fake, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\ncat >/dev/null\n');
      chmodSync(fake, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-remote-auto",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "codex",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "auto",
              enabled: true,
              originalCwd: notRepo,
              cwd: wtPath,
              repoRoot: notRepo,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
          machine: { id: "remote-test", local: false, route: "ssh" },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stderr).toContain("worktree preparation failed (mode=auto)");
        expect(result.stdout).toContain(`--cd\n${notRepo}`);
        expect(result.stdout).not.toContain(wtPath);
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("falls back to the original cwd when auto worktree preparation fails", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-auto-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const bin = fakePwdBinary(root);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      const logs: string[] = [];
      try {
        const loop = store.createLoop({
          name: "worktree-auto-fallback",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "claude",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "auto",
              enabled: true,
              originalCwd: notRepo,
              cwd: wtPath,
              repoRoot: notRepo,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
          log: (message) => logs.push(message),
        });
        expect(result.status).toBe("succeeded");
        expect(result.stdout.trim()).toBe(realpathSync(notRepo));
        expect(logs.some((line) => line.includes("worktree preparation failed (mode=auto)"))).toBe(true);
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("auto worktree fallback rebuilds codex argv against the original checkout", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-auto-codex-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const bin = join(root, "bin");
      mkdirSync(bin, { recursive: true });
      const codex = join(bin, "codex");
      writeFileSync(codex, '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@"\ncat >/dev/null\n');
      chmodSync(codex, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-auto-codex",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "codex",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "auto",
              enabled: true,
              originalCwd: notRepo,
              cwd: wtPath,
              repoRoot: notRepo,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toContain(`--cd\n${notRepo}`);
        expect(result.stdout).not.toContain(wtPath);
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("auto worktree fallback rebuilds codewith exec args against the original checkout", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-auto-codewith-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const bin = join(root, "bin");
      mkdirSync(bin, { recursive: true });
      const argsFile = join(root, "codewith-args");
      const codewith = join(bin, "codewith");
      writeFileSync(
        codewith,
        [
          "#!/usr/bin/env bash",
          `printf '%s\\n' "$@" >> ${JSON.stringify(argsFile)}`,
          `printf -- '--\\n' >> ${JSON.stringify(argsFile)}`,
          "cat >/dev/null",
          "echo '{}'",
        ].join("\n"),
      );
      chmodSync(codewith, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: "worktree-auto-codewith",
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider: "codewith",
            prompt: "work",
            configIsolation: "safe",
            cwd: wtPath,
            timeoutMs: 30_000,
            worktree: {
              mode: "auto",
              enabled: true,
              originalCwd: notRepo,
              cwd: wtPath,
              repoRoot: notRepo,
              path: wtPath,
              branch: "openloops/exec-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe("succeeded");
        const recorded = readFileSync(argsFile, "utf8");
        // exec bakes cwd into a single --cd flag; the fallback rebuilds it against
        // the original checkout, never the failed worktree path.
        expect(recorded).toContain(`--cd\n${notRepo}`);
        expect(recorded).toContain("exec\n");
        expect(recorded).not.toContain(wtPath);
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  test("routes machine-assigned command loops through remote transport", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-remote-command-"));
    const marker = join(root, "marker");
    const scriptFile = join(root, "remote-script");
    try {
      const loop = store.createLoop({
        name: "remote-command",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: `printf remote-ok > ${JSON.stringify(marker)}`, shell: true, timeoutMs: 5_000 },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        ...remoteHooks,
        machineCommandResolver: () => ({
          command: "bash",
          args: ["-c", `cat > ${JSON.stringify(scriptFile)}; bash ${JSON.stringify(scriptFile)}`],
          source: "ssh",
        }),
      });
      expect(result.status).toBe("succeeded");
      expect(readFileSync(marker, "utf8")).toBe("remote-ok");
      const script = readFileSync(scriptFile, "utf8");
      expect(script).toContain("sh -c ");
      expect(script).not.toContain("sh -lc ");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("dispatches remote codewith through the exec transport", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-exec-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFileSync(fake, "#!/usr/bin/env bash\nprintf remote-codewith-ran\ncat >/dev/null\n");
    chmodSync(fake, 0o755);
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "remote-codewith-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "agent", provider: "codewith", prompt: "do remote work", configIsolation: "safe", timeoutMs: 30_000 },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        ...remoteHooks,
        env: { HOME: home, PATH: "/usr/bin:/bin" },
      });
      // exec is remote-capable like codex; the old durable-polling block is gone.
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("remote-codewith-ran");
      expect(result.error ?? "").not.toContain("remote Codewith durable background-agent");
    } finally {
      rmSync(root, { recursive: true, force: true });
      store.close();
    }
  });

  test("resolves agent binaries from common user bin directories with a minimal PATH", async () => {
    const oldHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), "loops-home-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "claude");
    await Bun.write(fake, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\nprintf 'stdin:'\ncat\n");
    chmodSync(fake, 0o755);
    process.env.HOME = home;

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "claude-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { PATH: "/usr/bin:/bin", HOME: home },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("stdin:say ok");
      expect(result.stdout.trim().split(/\r?\n/)).not.toContain("say ok");
    } finally {
      store.close();
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
    }
  });

  test("cursor preflight requires standalone agent binary, not only sh", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-cursor-preflight-"));
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "cursor-preflight",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      expect(() =>
        preflightTarget(loop.target as any, {}, { env: { PATH: "/usr/bin:/bin", HOME: home } }),
      ).toThrow("none of required executables found");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("cursor preflight does not accept cursor wrapper without standalone agent", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-cursor-preflight-wrapper-"));
    const binDir = join(home, "bin");
    mkdirSync(binDir, { recursive: true });
    const fakeCursor = join(binDir, "cursor");
    writeFileSync(fakeCursor, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(fakeCursor, 0o755);
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "cursor-preflight-wrapper",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      expect(() =>
        preflightTarget(loop.target as any, {}, { env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home } }),
      ).toThrow("none of required executables found");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("cursor preflight accepts the standalone agent binary", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-cursor-preflight-ok-"));
    const binDir = join(home, "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "agent");
    writeFileSync(fake, "#!/usr/bin/env bash\nexit 0\n");
    chmodSync(fake, 0o755);
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "cursor-preflight-ok",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "cursor",
          prompt: "say ok",
          configIsolation: "safe",
        },
      });
      expect(preflightTarget(loop.target as any, {}, { env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home } }).command).toBe("sh");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("keeps remote agent prompts out of transport process argv", async () => {
    if (!existsSync("/proc/self/cmdline")) return;
    const secret = "SECRET_REMOTE_ARGV_PROMPT_VALUE";
    const home = mkdtempSync(join(tmpdir(), "loops-remote-home-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const gate = join(home, "gate");
    const fake = join(binDir, "claude");
    await Bun.write(fake, `#!/usr/bin/env bash\n${gateWaitScript(gate)}printf 'stdin:'\ncat\n`);
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "remote-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: secret,
          configIsolation: "safe",
        },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      let pid: number | undefined;
      const pending = executeLoop(loop, claim!.run, {
        ...remoteHooks,
        env: { HOME: home, PATH: "/usr/bin:/bin" },
        onSpawn: (spawnedPid) => {
          pid = spawnedPid;
        },
      });
      await waitUntil(() => pid !== undefined, { label: "spawned pid reported" });
      expect(pid).toBeDefined();
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      expect(cmdline).not.toContain(secret);
      openGate(gate);
      const result = await pending;
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain(`stdin:${secret}`);
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("strips inherited auth env from remote transport processes", async () => {
    if (!existsSync("/proc/self/environ")) return;
    const secret = "LEAKED_TRANSPORT_SECRET";
    const home = mkdtempSync(join(tmpdir(), "loops-remote-env-home-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const gate = join(home, "gate");
    const fake = join(binDir, "claude");
    await Bun.write(fake, `#!/usr/bin/env bash\n${gateWaitScript(gate)}cat >/dev/null\n`);
    chmodSync(fake, 0o755);

    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "remote-env-agent",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "safe-prompt",
          configIsolation: "safe",
        },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      let pid: number | undefined;
      const pending = executeLoop(loop, claim!.run, {
        ...remoteHooks,
        env: {
          HOME: home,
          PATH: "/usr/bin:/bin",
          AWS_SECRET_ACCESS_KEY: secret,
          NPM_TOKEN: secret,
          OPENAI_API_KEY: secret,
          ANTHROPIC_API_KEY: secret,
          CODEWITH_HOME: `${home}/codewith-secret`,
        },
        onSpawn: (spawnedPid) => {
          pid = spawnedPid;
        },
      });
      await waitUntil(() => pid !== undefined, { label: "spawned pid reported" });
      expect(pid).toBeDefined();
      const environ = readFileSync(`/proc/${pid}/environ`, "utf8").replace(/\0/g, "\n");
      expect(environ).not.toContain(secret);
      expect(environ).not.toContain("AWS_SECRET_ACCESS_KEY=");
      expect(environ).not.toContain("NPM_TOKEN=");
      expect(environ).not.toContain("CODEWITH_HOME=");
      openGate(gate);
      const result = await pending;
      expect(result.status).toBe("succeeded");
    } finally {
      store.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("remote preflight uses the same redacted stdin transport bootstrap", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-preflight-"));
    const scriptFile = join(root, "preflight-script");
    const envFile = join(root, "preflight-env");
    const secret = "PREFLIGHT_ENV_SECRET";
    const result = preflightTarget(
      { type: "command", command: "printf ok", shell: true },
      {},
      {
        machine: { id: "remote-test", local: false, route: "ssh" },
        machineResolver: (machine) => ({ ...machine, local: false, route: "ssh" }),
        env: {
          HOME: root,
          PATH: "/usr/bin:/bin",
          AWS_SECRET_ACCESS_KEY: secret,
          NPM_TOKEN: secret,
          OPENAI_API_KEY: secret,
        },
        machineCommandResolver: () => {
          const wrapper = [
            `printf '%s:%s:%s' "$AWS_SECRET_ACCESS_KEY" "$NPM_TOKEN" "$OPENAI_API_KEY" > ${JSON.stringify(envFile)}`,
            `cat > ${JSON.stringify(scriptFile)}`,
            `bash ${JSON.stringify(scriptFile)}`,
          ].join("; ");
          return {
            command: "bash",
            args: ["-c", wrapper],
            source: "ssh",
          };
        },
      },
    );
    try {
      expect(result.command).toBe("printf ok");
      const script = readFileSync(scriptFile, "utf8");
      expect(script).toContain("command -v bash");
      expect(script).toContain("command -v 'sh'");
      expect(script).toContain("export PATH=");
      expect(readFileSync(envFile, "utf8")).not.toContain(secret);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight quotes missing profile errors safely", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const marker = join(root, "marker");
    const scriptFile = join(root, "preflight-script");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFileSync(
      fake,
      "#!/usr/bin/env bash\nif [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'; exit 0; fi\nexit 0\n",
    );
    chmodSync(fake, 0o755);
    const maliciousProfile = `missing'; touch ${marker}; echo '`;

    try {
      expect(() =>
        preflightTarget(
          {
            type: "agent",
            provider: "codewith",
            authProfile: maliciousProfile,
            prompt: "run",
            configIsolation: "safe",
          },
          {},
          {
            machine: { id: "remote-test", local: false, route: "ssh" },
            machineResolver: (machine) => ({ ...machine, local: false, route: "ssh" }),
            env: { HOME: home, PATH: "/usr/bin:/bin" },
            machineCommandResolver: () => ({
              command: "bash",
              args: ["-c", `cat > ${JSON.stringify(scriptFile)}; HOME=${JSON.stringify(home)} PATH=/usr/bin:/bin bash ${JSON.stringify(scriptFile)}`],
              source: "ssh",
            }),
          },
        ),
      ).toThrow("codewith auth profile not found");
      expect(existsSync(marker)).toBe(false);
      expect(readFileSync(scriptFile, "utf8")).toContain("codewith auth profile not found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local codewith auth profile preflight accepts the active (*-marked) profile", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-active-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(
      fake,
      [
        "  NAME       ACCOUNT   PROVIDER MODE    PLAN",
        "  account001 a@x       ChatGPT chatgpt Pro",
        "* account002 b@x       ChatGPT chatgpt Pro",
        "  account003 c@x       ChatGPT chatgpt Pro",
      ].join("\n"),
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).not.toThrow();
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account003", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).not.toThrow();
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account999", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).toThrow("codewith auth profile not found");
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account\0abc", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).toThrow('codewith auth profile contains unsupported NUL byte: "account\\u0000abc"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight accepts active and non-active listed profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-listed-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(
      fake,
      [
        "  NAME       ACCOUNT   PROVIDER MODE    PLAN",
        "  account001 a@x       ChatGPT chatgpt Pro",
        "* account002 b@x       ChatGPT chatgpt Pro",
      ].join("\n"),
    );
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).not.toThrow();
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account001", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight fails for truly missing profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-missing-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(fake, "NAME ACCOUNT PROVIDER MODE PLAN\naccount001 - ChatGPT chatgpt Pro");
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "missing", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile not found: missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight treats option-like profiles as exact strings", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-option-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(fake, "NAME ACCOUNT PROVIDER MODE PLAN\naccount001 - ChatGPT chatgpt Pro");
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "--help", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile not found: --help");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight treats newline profiles as one exact string", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-newline-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(fake, "NAME ACCOUNT PROVIDER MODE PLAN\naccount001 - ChatGPT chatgpt Pro");
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "missing\naccount001", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow('codewith auth profile not found: "missing\\naccount001"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight treats awk escape profiles as exact strings", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-escape-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(fake, "NAME ACCOUNT PROVIDER MODE PLAN\nA - ChatGPT chatgpt Pro");
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "\\x41", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile not found: \\x41");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight rejects NUL-containing profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-nul-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(fake, "NAME ACCOUNT PROVIDER MODE PLAN\naccountabc - ChatGPT chatgpt Pro");
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account\0abc", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow('codewith auth profile contains unsupported NUL byte: "account\\u0000abc"');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight fails when profile list exits nonzero even if stdout matches", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-nonzero-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFileSync(
      fake,
      "#!/usr/bin/env bash\nif [[ \"${1:-}\" == \"profile\" && \"${2:-}\" == \"list\" ]]; then printf 'NAME ACCOUNT PROVIDER MODE PLAN\\naccount001 - ChatGPT chatgpt Pro\\n'; exit 17; fi\nexit 0\n",
    );
    chmodSync(fake, 0o755);

    try {
      expect(() =>
        preflightTarget(
          {
            type: "agent",
            provider: "codewith",
            authProfile: "account001",
            prompt: "run",
            configIsolation: "safe",
          },
          {},
          {
            machine: { id: "remote-test", local: false, route: "ssh" },
            machineResolver: (machine) => ({ ...machine, local: false, route: "ssh" }),
            env: { HOME: home, PATH: "/usr/bin:/bin" },
            machineCommandResolver: () => ({
              command: "bash",
              args: ["-c", `HOME=${JSON.stringify(home)} PATH=/usr/bin:/bin bash -s`],
              source: "ssh",
            }),
          },
        ),
      ).toThrow("codewith auth profile preflight failed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("sends agent prompts on stdin instead of process argv for stdin provider adapters", async () => {
    if (!existsSync("/proc/self/cmdline")) return;
    const secret = "SECRET_ARGV_PROMPT_VALUE";
    const home = mkdtempSync(join(tmpdir(), "loops-home-argv-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const providers = [
      ["claude", "claude"],
      ["codex", "codex"],
      ["opencode", "opencode"],
      ["cursor", "agent"],
      ["aicopilot", "aicopilot"],
    ] as const;
    for (const [provider, binary] of providers) {
      const fake = join(binDir, binary);
      const gate = join(home, `${provider}.gate`);
      await Bun.write(
        fake,
        provider === "cursor"
          ? `#!/usr/bin/env bash\nset -euo pipefail\nif [[ "\${1:-}" != "-p" ]]; then echo 'missing cursor print flag' >&2; exit 64; fi\n${gateWaitScript(gate)}printf 'stdin:'\ncat\n`
          : `#!/usr/bin/env bash\n${gateWaitScript(gate)}printf 'stdin:'\ncat\n`,
      );
      chmodSync(fake, 0o755);
    }

    for (const [provider] of providers) {
      const store = new Store(":memory:");
      try {
        const loop = store.createLoop({
          name: `${provider}-argv`,
          schedule: { type: "once", at: new Date().toISOString() },
          target: {
            type: "agent",
            provider,
            prompt: secret,
            model: provider === "opencode" ? "openrouter/google/gemini-2.5-flash" : undefined,
            configIsolation: "safe",
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        let pid: number | undefined;
        const pending = executeLoop(loop, claim!.run, {
          env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home },
          onSpawn: (spawnedPid) => {
            pid = spawnedPid;
          },
        });
        await waitUntil(() => pid !== undefined, { label: `${provider} spawned pid reported` });
        expect(pid).toBeDefined();
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        expect(cmdline).not.toContain(secret);
        openGate(join(home, `${provider}.gate`));
        const result = await pending;
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toContain(`stdin:${secret}`);
      } finally {
        store.close();
      }
    }
  });

  test("requires explicit opencode model before spawning provider", () => {
    expect(() =>
      preflightTarget(
        {
          type: "agent",
          provider: "opencode",
          prompt: "say ok",
          configIsolation: "safe",
        } as any,
        {},
        { env: { PATH: "/usr/bin:/bin" } },
      ),
    ).toThrow("opencode.model is required");
  });
});
