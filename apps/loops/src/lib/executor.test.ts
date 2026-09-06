import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { AgentTarget } from "../types.js";
import { Store } from "./store.js";
import { executableExists, normalizeExecutionPath } from "./env.js";
import { defaultAgentIdleTimeoutMs, executeLoop, executeTarget, isStaleWorktreeRegistration, preflightTarget, type SpawnedProcessInfo } from "./executor.js";
import { openGate, waitUntil } from "../test-helpers.js";

/**
 * Whether a standalone `agent` binary resolves through the executor's
 * normalized PATH (opts env + home dirs + homebrew). The two cursor-preflight
 * failure tests pin that cursor REQUIRES the standalone `agent` binary — a
 * premise only establishable on machines without one; the executor's
 * normalizeExecutionPath appends ~/.local/bin and /opt/homebrew/bin to every
 * execution PATH, so a machine that has `agent` there cannot construct the
 * negative case (preflight legitimately passes).
 */
function standaloneAgentResolvable(): boolean {
  const env = { ...process.env, PATH: normalizeExecutionPath(process.env) };
  return executableExists("agent", env);
}

function gateWaitScript(gate: string): string {
  return `while [ ! -f ${JSON.stringify(gate)} ]; do sleep 0.02; done\n`;
}

function guardedLoginExitCommand(missingPath: string): string {
  const quoted = JSON.stringify(missingPath);
  return [
    `if [ ! -s ${quoted} ]; then`,
    `  printf 'no artifact at %s\\n' ${quoted}`,
    "  exit 0",
    "fi",
    "bun - <<'BUN'",
    "console.log('unexpected artifact path');",
    "BUN",
  ].join("\n");
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

function writeFakeCodewithJsonFailureThenProfileList(fake: string, output: string): void {
  const delimiter = "__OPENLOOPS_FAKE_CODEWITH_PROFILE_LIST__";
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      'if [[ "${1:-}" == "profile" && "${2:-}" == "list" && "${3:-}" == "--json" ]]; then',
      "echo \"error: unexpected argument '--json' found\" >&2",
      "exit 64",
      "fi",
      'if [[ "${1:-}" == "profile" && "${2:-}" == "list" ]]; then',
      `cat <<'${delimiter}'`,
      output.endsWith("\n") ? output.slice(0, -1) : output,
      delimiter,
      "exit 0",
      "fi",
      "exit 0",
      "",
    ].join("\n"),
  );
  chmodSync(fake, 0o755);
}

function writeFakeCodewithJsonThenProfileList(
  fake: string,
  jsonOutput: string,
  tableOutput: string,
  invocationLog?: string,
): void {
  const jsonDelimiter = "__OPENLOOPS_FAKE_CODEWITH_JSON_PROFILE_LIST__";
  const tableDelimiter = "__OPENLOOPS_FAKE_CODEWITH_TABLE_PROFILE_LIST__";
  writeFileSync(
    fake,
    [
      "#!/usr/bin/env bash",
      invocationLog ? `printf '%s\\n' "$*" >> ${JSON.stringify(invocationLog)}` : "",
      'if [[ "${1:-}" == "profile" && "${2:-}" == "list" && "${3:-}" == "--json" ]]; then',
      `cat <<'${jsonDelimiter}'`,
      jsonOutput.endsWith("\n") ? jsonOutput.slice(0, -1) : jsonOutput,
      jsonDelimiter,
      "exit 0",
      "fi",
      'if [[ "${1:-}" == "profile" && "${2:-}" == "list" ]]; then',
      `cat <<'${tableDelimiter}'`,
      tableOutput.endsWith("\n") ? tableOutput.slice(0, -1) : tableOutput,
      tableDelimiter,
      "exit 0",
      "fi",
      "exit 0",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
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

  test("keeps raw exit 75 failures generic until the loop finalization boundary", async () => {
    const store = new Store(":memory:");
    try {
      const skippedLoop = store.createLoop({
        name: "configured-skip",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: "exit 75", shell: true },
        overlap: "skip",
      });
      const skippedClaim = store.claimRun(skippedLoop, new Date().toISOString(), "test");
      expect(skippedClaim).toBeDefined();
      expect(await executeLoop(skippedLoop, skippedClaim!.run)).toMatchObject({
        status: "failed",
        exitCode: 75,
      });

      const allowedLoop = store.createLoop({
        name: "unconfigured-skip",
        schedule: { type: "once", at: new Date().toISOString() },
        target: { type: "command", command: "exit 75", shell: true },
        overlap: "allow",
      });
      const allowedClaim = store.claimRun(allowedLoop, new Date().toISOString(), "test");
      expect(allowedClaim).toBeDefined();
      expect(await executeLoop(allowedLoop, allowedClaim!.run)).toMatchObject({
        status: "failed",
        exitCode: 75,
      });

      expect(await executeTarget({ type: "command", command: "exit 75", shell: true })).toMatchObject({
        status: "failed",
        exitCode: 75,
      });
    } finally {
      store.close();
    }
  });

  // Regression: row e84f3956-1083-4b4a-bb73-59f901b054b7 (2026-07-30, measured
  // runner-origin). The runner's own process.env (systemd/launchd launcher)
  // lacks CLAUDE_CONFIG_DIR, and neither an explicit spec.account nor the
  // retired ~/.hasna/cloud loader supplies it, so a spawned headless claude
  // resolved to the DEFAULT account profile — a silent identity switch that
  // only surfaces once that account is spent (measured: 429 on the default
  // while the configured profile sat idle; exit 0, zero cost, ~3s —
  // indistinguishable from a config bug). The runner must propagate the tool's
  // config-selecting var from the accounts CLI's ACTIVE profile when the value
  // is otherwise absent.
  describe("active claude profile config-dir propagation into spawned targets", () => {
    function writeFakeAccounts(binDir: string, configDir: string, exitCode = 0): string {
      const accounts = join(binDir, "accounts");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        accounts,
        [
          "#!/usr/bin/env bash",
          'if [[ "$1" != "env" || "$2" != "--tool" || "$3" != "claude" ]]; then',
          '  echo "unexpected accounts args: $*" >&2',
          "  exit 2",
          "fi",
          `printf 'export CLAUDE_CONFIG_DIR="%s"\\n' "${configDir}"`,
          `exit ${exitCode}`,
          "",
        ].join("\n"),
      );
      chmodSync(accounts, 0o755);
      return accounts;
    }

    function writeFakeClaude(binDir: string): string {
      const claude = join(binDir, "claude");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        claude,
        ["#!/usr/bin/env bash", 'printf "%s" "${CLAUDE_CONFIG_DIR:-UNSET}"', ""].join("\n"),
      );
      chmodSync(claude, 0o755);
      return claude;
    }

    function hermeticEnv(root: string, binDir: string): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HOME: root,
        PATH: `${binDir}:/usr/bin:/bin`,
      };
      delete env.CLAUDE_CONFIG_DIR;
      return env;
    }

    test("agent target carries CLAUDE_CONFIG_DIR the runner process never had", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-"));
      const binDir = join(root, "bin");
      const profileDir = join(root, "claude-profile");
      mkdirSync(profileDir, { recursive: true });
      writeFakeAccounts(binDir, profileDir);
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          { type: "agent", provider: "claude", prompt: "hi", configIsolation: "safe" },
          {},
          { env: hermeticEnv(root, binDir) },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe(profileDir);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("command target whose command starts with claude carries CLAUDE_CONFIG_DIR", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-cmd-"));
      const binDir = join(root, "bin");
      const profileDir = join(root, "claude-profile");
      mkdirSync(profileDir, { recursive: true });
      writeFakeAccounts(binDir, profileDir);
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          { type: "command", command: "claude -p hi", shell: true, timeoutMs: 5_000 },
          {},
          { env: hermeticEnv(root, binDir) },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe(profileDir);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("does not clobber a config dir the runner already has", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-keep-"));
      const binDir = join(root, "bin");
      const profileDir = join(root, "claude-profile");
      const explicitDir = join(root, "explicit-profile");
      mkdirSync(profileDir, { recursive: true });
      mkdirSync(explicitDir, { recursive: true });
      writeFakeAccounts(binDir, profileDir);
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          { type: "agent", provider: "claude", prompt: "hi", configIsolation: "safe" },
          {},
          { env: { ...hermeticEnv(root, binDir), CLAUDE_CONFIG_DIR: explicitDir } },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe(explicitDir);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("does not clobber an explicit target account env", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-account-"));
      const binDir = join(root, "bin");
      const profileDir = join(root, "claude-profile");
      const workDir = join(root, "work-profile");
      mkdirSync(profileDir, { recursive: true });
      mkdirSync(workDir, { recursive: true });
      const accounts = join(binDir, "accounts");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        accounts,
        [
          "#!/usr/bin/env bash",
          'if [[ "$1" == "env" && "$2" == "work" ]]; then',
          `  printf 'export CLAUDE_CONFIG_DIR="%s"\\n' "${workDir}"`,
          "  exit 0",
          "fi",
          'if [[ "$1" == "env" && "$2" == "--tool" && "$3" == "claude" ]]; then',
          `  printf 'export CLAUDE_CONFIG_DIR="%s"\\n' "${profileDir}"`,
          "  exit 0",
          "fi",
          '  echo "unexpected accounts args: $*" >&2',
          "  exit 2",
          "",
        ].join("\n"),
      );
      chmodSync(accounts, 0o755);
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          {
            type: "agent",
            provider: "claude",
            prompt: "hi",
            configIsolation: "safe",
            account: { profile: "work", tool: "claude" },
          },
          {},
          { env: hermeticEnv(root, binDir) },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe(workDir);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("degrades gracefully when the accounts CLI is unavailable", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-noacc-"));
      const binDir = join(root, "bin");
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          { type: "command", command: "claude -p hi", shell: true, timeoutMs: 5_000 },
          {},
          { env: hermeticEnv(root, binDir) },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe("UNSET");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("degrades gracefully when accounts env fails", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-active-claude-fail-"));
      const binDir = join(root, "bin");
      writeFakeAccounts(binDir, join(root, "unused-profile"), 3);
      writeFakeClaude(binDir);
      try {
        const result = await executeTarget(
          { type: "command", command: "claude -p hi", shell: true, timeoutMs: 5_000 },
          {},
          { env: hermeticEnv(root, binDir) },
        );
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toBe("UNSET");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  });

  test("normalizes SHLVL for bash login command targets with guarded exits", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-login-shell-env-"));
    try {
      const loop = store.createLoop({
        name: "guarded-login-shell",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "command",
          command: "bash",
          args: ["-lc", guardedLoginExitCommand(join(root, "missing.json"))],
          timeoutMs: 5_000,
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { HOME: root, PATH: "/usr/bin:/bin" },
      });
      expect(result.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("no artifact at");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
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

  // Regression test for todos 9eca45d6: `loops create agent` had no way to
  // declare environment variables for the run, so a loop-spawned agent could
  // not carry e.g. CONVERSATIONS_AGENT_ID. This asserts the variable actually
  // reaches the spawned process's environment — not merely that the target
  // shape accepts an `env` field.
  test("carries agent target env vars into the run environment", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-env-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(
      claude,
      [
        "#!/usr/bin/env bash",
        'printf \'seen=%s\\n\' "$LOOPS_TEST_AGENT_ENV_VAR"',
        "cat >/dev/null",
        "",
      ].join("\n"),
    );
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "agent-env-var",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "agent",
          provider: "claude",
          prompt: "work",
          env: { LOOPS_TEST_AGENT_ENV_VAR: "custom-value" },
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("seen=custom-value");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("exports the auditable advisory session contract without claiming enforcement", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-agent-session-contract-"));
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(
      claude,
      [
        "#!/usr/bin/env bash",
        "printf 'contract=%s\\n' \"$LOOPS_AGENT_SESSION_CONTRACT\"",
        "printf 'enforcement=%s\\n' \"$LOOPS_AGENT_ALLOWLIST_ENFORCEMENT\"",
        "printf 'reason=%s\\n' \"$LOOPS_AGENT_ALLOWLIST_SAFETY_REASON\"",
        "cat >/dev/null",
        "",
      ].join("\n"),
    );
    chmodSync(claude, 0o755);
    try {
      const loop = store.createLoop({
        name: "auditable-agent-contract",
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
            safetyReason: "isolated repository maintenance",
          },
        },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("enforcement=metadata_only");
      expect(result.stdout).toContain("reason=isolated repository maintenance");
      const contractLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("contract="));
      expect(contractLine).toBeTruthy();
      const contract = JSON.parse(contractLine!.slice("contract=".length));
      expect(contract).toMatchObject({
        version: 1,
        provider: "claude",
        cwd: root,
        sandbox: "provider-default",
        manualBreakGlass: false,
        restrictions: {
          tools: ["functions.exec_command"],
          commands: ["git", "bun"],
          enforcement: "metadata_only",
          providerEnforced: false,
        },
        safetyReason: "isolated repository maintenance",
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

    test("prepares, enters, and recovers a clean required git worktree before spawning", async () => {
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

        execFileSync("git", ["-C", wtPath, "checkout", "--detach"], { stdio: "ignore" });
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("");

        const recovered = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(recovered.status).toBe("succeeded");
        expect(recovered.stdout.trim()).toBe(realpathSync(wtPath));
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");

        writeFileSync(join(wtPath, "detached-marker.txt"), "preserve detached head\n");
        execFileSync("git", ["-C", wtPath, "-c", "user.email=test@example.com", "-c", "user.name=test", "add", "detached-marker.txt"], {
          stdio: "ignore",
        });
        execFileSync("git", ["-C", wtPath, "-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "detached marker"], {
          stdio: "ignore",
        });
        const detachedHead = execFileSync("git", ["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        execFileSync("git", ["-C", wtPath, "checkout", "--detach"], { stdio: "ignore" });
        execFileSync("git", ["-C", repo, "branch", "-D", "openloops/exec-test"], { stdio: "ignore" });

        const recreated = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(recreated.status).toBe("succeeded");
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");
        expect(execFileSync("git", ["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(detachedHead);
        expect(readFileSync(join(wtPath, "detached-marker.txt"), "utf8")).toBe("preserve detached head\n");
      } finally {
        store.close();
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("detects git's stale 'missing but already registered worktree' error", () => {
      expect(
        isStaleWorktreeRegistration(
          "fatal: '/x/run-1' is a missing but already registered worktree;\nuse 'add -f' to override, or 'prune' or 'remove' to clear",
        ),
      ).toBe(true);
      expect(isStaleWorktreeRegistration("fatal: '/x/run-1' already exists")).toBe(false);
      expect(isStaleWorktreeRegistration(undefined)).toBe(false);
      expect(isStaleWorktreeRegistration("")).toBe(false);
    });

    test("self-heals a stale 'missing but already registered' worktree registration", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-stale-"));
      const repo = initRepo(root);
      const bin = fakePwdBinary(root);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      const store = new Store(":memory:");
      try {
        // Fabricate the exact 48693723 fault: register a worktree (creating the
        // branch), then delete its directory, leaving the `.git/worktrees/<name>`
        // entry git refuses to overwrite ("missing but already registered
        // worktree") while the branch stays checked-out to the missing path.
        execFileSync("git", ["-C", repo, "worktree", "add", "-b", "openloops/stale-test", wtPath], { stdio: "ignore" });
        rmSync(wtPath, { recursive: true, force: true });
        expect(existsSync(wtPath)).toBe(false);

        const loop = store.createLoop({
          name: "worktree-stale-selfheal",
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
              branch: "openloops/stale-test",
            },
          },
        });
        const claim = store.claimRun(loop, new Date().toISOString(), "test");
        expect(claim).toBeDefined();
        const result = await executeLoop(loop, claim!.run, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        // Self-heal: prune cleared the stale registration, the single retry
        // recreated the worktree, and the agent ran inside it. Without the fix
        // this fails "worktree preparation failed ... missing but already
        // registered worktree" (mode=required fails closed).
        expect(result.status).toBe("succeeded");
        expect(result.stdout.trim()).toBe(realpathSync(wtPath));
        expect(existsSync(join(wtPath, ".git"))).toBe(true);
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

        // Second run recovers a clean detached worktree before entering it.
        execFileSync("git", ["-C", wtPath, "checkout", "--detach"], { stdio: "ignore" });
        const again = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(again.status).toBe("succeeded");
        expect(again.stdout.trim()).toBe(wtPath);
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");

        writeFileSync(join(wtPath, "detached-marker.txt"), "preserve remote detached head\n");
        execFileSync("git", ["-C", wtPath, "-c", "user.email=test@example.com", "-c", "user.name=test", "add", "detached-marker.txt"], {
          stdio: "ignore",
        });
        execFileSync("git", ["-C", wtPath, "-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-m", "detached marker"], {
          stdio: "ignore",
        });
        const detachedHead = execFileSync("git", ["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
        execFileSync("git", ["-C", wtPath, "checkout", "--detach"], { stdio: "ignore" });
        execFileSync("git", ["-C", repo, "branch", "-D", "openloops/exec-test"], { stdio: "ignore" });

        const recreated = await executeLoop(loop, claim!.run, {
          ...remoteHooks,
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(recreated.status).toBe("succeeded");
        expect(execFileSync("git", ["-C", wtPath, "branch", "--show-current"], { encoding: "utf8" }).trim()).toBe("openloops/exec-test");
        expect(execFileSync("git", ["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(detachedHead);
        expect(readFileSync(join(wtPath, "detached-marker.txt"), "utf8")).toBe("preserve remote detached head\n");
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

    test("local auto worktree fallback reuses one validated extra-args snapshot", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-local-extra-args-snapshot-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const bin = join(root, "bin");
      mkdirSync(bin, { recursive: true });
      const fake = join(bin, "claude");
      writeFileSync(
        fake,
        [
          "#!/usr/bin/env bash",
          "pwd",
          "printf 'env-contract:%s\\n' \"${LOOPS_AGENT_SESSION_CONTRACT:-}\"",
          "printf 'stdin:'",
          "cat",
        ].join("\n"),
      );
      chmodSync(fake, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      let extraArgsReads = 0;
      const target: AgentTarget = {
        type: "agent",
        provider: "claude",
        prompt: "work",
        configIsolation: "safe",
        allowlist: { safetyReason: "verify local fallback contract cwd" },
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
      };
      Object.defineProperty(target, "extraArgs", {
        configurable: true,
        enumerable: true,
        get() {
          extraArgsReads += 1;
          return [];
        },
      });

      try {
        const result = await executeTarget(target, {}, {
          env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stdout.split(/\r?\n/, 1)[0]).toBe(realpathSync(notRepo));
        const envContract = result.stdout.split(/\r?\n/).find((line) => line.startsWith("env-contract:"));
        const stdin = result.stdout.slice(result.stdout.indexOf("stdin:"));
        expect(envContract).toContain(`\"cwd\":\"${notRepo}\"`);
        expect(envContract).not.toContain(wtPath);
        expect(stdin).toContain(`"cwd":${JSON.stringify(notRepo)}`);
        expect(stdin).not.toContain(wtPath);
        expect(extraArgsReads).toBe(1);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    test("remote auto worktree fallback reuses one validated extra-args snapshot", async () => {
      const root = mkdtempSync(join(tmpdir(), "loops-worktree-remote-extra-args-snapshot-"));
      const notRepo = join(root, "not-a-repo");
      mkdirSync(notRepo, { recursive: true });
      const home = join(root, "home");
      const binDir = join(home, ".local", "bin");
      mkdirSync(binDir, { recursive: true });
      const fake = join(binDir, "codex");
      writeFileSync(
        fake,
        [
          "#!/usr/bin/env bash",
          "printf '%s\\n' \"$@\"",
          "printf 'env-contract:%s\\n' \"${LOOPS_AGENT_SESSION_CONTRACT:-}\"",
          "printf 'stdin:'",
          "cat",
        ].join("\n"),
      );
      chmodSync(fake, 0o755);
      const mktempLog = join(root, "mktemp.log");
      const fakeMktemp = join(binDir, "mktemp");
      writeFileSync(
        fakeMktemp,
        [
          "#!/usr/bin/env bash",
          `printf 'mktemp\\n' >> ${JSON.stringify(mktempLog)}`,
          'exec /usr/bin/mktemp "$@"',
        ].join("\n"),
      );
      chmodSync(fakeMktemp, 0o755);
      const wtPath = join(root, "worktrees", "repo", "run-1");
      let extraArgsReads = 0;
      const target: AgentTarget = {
        type: "agent",
        provider: "codex",
        prompt: "work",
        configIsolation: "safe",
        allowlist: { safetyReason: "verify remote fallback contract cwd" },
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
      };
      Object.defineProperty(target, "extraArgs", {
        configurable: true,
        enumerable: true,
        get() {
          extraArgsReads += 1;
          return [];
        },
      });

      try {
        const result = await executeTarget(target, {}, {
          ...remoteHooks,
          machine: { id: "remote-test", local: false, route: "ssh" },
          env: { HOME: home, PATH: "/usr/bin:/bin" },
        });
        expect(result.status).toBe("succeeded");
        expect(result.stderr).toContain("worktree preparation failed (mode=auto)");
        expect(result.stdout).toContain(`--cd\n${notRepo}`);
        const envContract = result.stdout.split(/\r?\n/).find((line) => line.startsWith("env-contract:"));
        const stdin = result.stdout.slice(result.stdout.indexOf("stdin:"));
        expect(envContract).toContain(`\"cwd\":\"${notRepo}\"`);
        expect(envContract).not.toContain(wtPath);
        expect(stdin).toContain(`"cwd":${JSON.stringify(notRepo)}`);
        expect(stdin).not.toContain(wtPath);
        expect(readFileSync(mktempLog, "utf8").trim().split(/\r?\n/)).toEqual(["mktemp"]);
        expect(extraArgsReads).toBe(1);
      } finally {
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

  test("normalizes SHLVL for remote bash login command targets with guarded exits", async () => {
    const store = new Store(":memory:");
    const root = mkdtempSync(join(tmpdir(), "loops-remote-login-shell-env-"));
    try {
      const loop = store.createLoop({
        name: "remote-guarded-login-shell",
        schedule: { type: "once", at: new Date().toISOString() },
        target: {
          type: "command",
          command: "bash",
          args: ["-lc", guardedLoginExitCommand(join(root, "missing.json"))],
          timeoutMs: 5_000,
        },
        machine: { id: "remote-test", local: false, route: "ssh" },
      });
      const claim = store.claimRun(loop, new Date().toISOString(), "test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        ...remoteHooks,
        env: { HOME: root, PATH: "/usr/bin:/bin" },
      });
      expect(result.status).toBe("succeeded");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("no artifact at");
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

  test.skipIf(standaloneAgentResolvable())("cursor preflight requires standalone agent binary, not only sh", () => {
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

  test.skipIf(standaloneAgentResolvable())("cursor preflight does not accept cursor wrapper without standalone agent", () => {
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
    // Emits output on purpose: this test is about env stripping, but an agent
    // that exits 0 having written nothing at all is now a failed run (the
    // incident-607176 no-output guard), so a silent fixture would fail here for
    // a reason unrelated to what it is checking.
    await Bun.write(fake, `#!/usr/bin/env bash\n${gateWaitScript(gate)}cat >/dev/null\nprintf 'remote-env-agent-ran\\n'\n`);
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

  test("remote preflight classifies ssh host key verification failures without bypassing trust", () => {
    let message = "";
    try {
      preflightTarget(
        { type: "command", command: "printf ok", shell: true },
        {},
        {
          machine: { id: "station02", local: false, route: "ssh" },
          machineResolver: (machine) => ({ ...machine, local: false, route: "ssh" }),
          env: { HOME: tmpdir(), PATH: "/usr/bin:/bin" },
          machineCommandResolver: () => ({
            command: "bash",
            args: ["-c", "printf 'Host key verification failed.\\n' >&2; exit 255"],
            source: "ssh",
          }),
        },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("remote preflight failed on station02: SSH host key verification failed.");
    expect(message).toContain("Verify station02's host identity");
    expect(message).toContain("repair SSH known_hosts/trust material outside Loops");
    expect(message).toContain("Loops will not disable host-key checking or modify known_hosts automatically.");
    expect(message).toContain("Transport detail: Host key verification failed.");
    expect(message).not.toContain("StrictHostKeyChecking=no");
    expect(message).not.toContain("UserKnownHostsFile=/dev/null");
    expect(message).not.toContain("ssh-keyscan");
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

  test("local codewith auth profile preflight accepts JSON profile list output", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(
      fake,
      JSON.stringify(
        {
          currentProfile: { name: null, profileKind: "default", available: true },
          data: [
            {
              name: "account001",
              profileKind: "named",
              active: false,
              selected: false,
              subscriptionProvider: "chat-gpt",
              authMode: "chatgpt",
              accountLabel: "redacted",
              usable: true,
              unusableReason: null,
            },
            {
              name: "account002",
              profileKind: "named",
              active: false,
              selected: false,
              subscriptionProvider: "chat-gpt",
              authMode: "chatgpt",
              accountLabel: "redacted",
              usable: true,
              unusableReason: null,
            },
          ],
        },
        null,
        2,
      ),
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local sync codewith auth profile preflight accepts usable compact multi-entry JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-usable-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({
        data: [
          { name: "account001", usable: false },
          { name: "openai-api-default", usable: true },
          { name: "account003", usable: true },
        ],
      }),
      "NAME ACCOUNT PROVIDER MODE PLAN\naccount001 - ChatGPT chatgpt Pro",
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      expect(() =>
        preflightTarget(
          {
            type: "agent",
            provider: "codewith",
            authProfile: "openai-api-default",
            prompt: "run",
            configIsolation: "safe",
          },
          {},
          { env },
        ),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local sync codewith auth profile preflight rejects unusable JSON without table fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-unusable-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({ data: [{ name: "account002", usable: false }] }),
      "NAME ACCOUNT PROVIDER MODE PLAN\naccount002 - ChatGPT chatgpt Pro",
      invocationLog,
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).toThrow("codewith auth profile preflight failed: profile is unusable: account002");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local async codewith auth profile preflight rejects unusable JSON without table fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-unusable-async-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({ profiles: [{ name: "account002", usable: false }] }),
      "NAME ACCOUNT PROVIDER MODE PLAN\naccount002 - ChatGPT chatgpt Pro",
      invocationLog,
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      const result = await executeTarget(
        { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
        {},
        { env },
      );
      expect(result.status).toBe("failed");
      expect(result.error).toContain("codewith auth profile preflight failed: profile is unusable: account002");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local codewith auth profile preflight treats valid JSON inventory as authoritative when profile is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-missing-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({ data: [{ name: "account001", usable: true }] }),
      "NAME ACCOUNT PROVIDER MODE PLAN\nmissing - ChatGPT chatgpt Pro",
      invocationLog,
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "missing", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).toThrow("codewith auth profile not found: missing");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local codewith auth profile preflight preserves legacy profiles JSON without usable", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-legacy-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({ profiles: [{ name: "account001" }, { name: "account002" }] }),
      "NAME ACCOUNT PROVIDER MODE PLAN",
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local codewith auth profile preflight does not accept JSON currentProfile without a saved profile", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-current-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(
      fake,
      JSON.stringify(
        {
          currentProfile: { name: "account002", profileKind: "named", available: false },
          data: [],
        },
        null,
        2,
      ),
    );
    const env = { HOME: home, PATH: `${binDir}:/usr/bin:/bin` };
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          { env },
        ),
      ).toThrow("codewith auth profile not found: account002");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("local codewith auth profile preflight falls back to table output when JSON is unsupported", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-local-codewith-json-fallback-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonFailureThenProfileList(
      fake,
      [
        "  NAME       ACCOUNT   PROVIDER MODE    PLAN",
        "  account001 -         ChatGPT chatgpt Pro",
        "* account002 -         ChatGPT chatgpt Pro",
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

  test("remote codewith auth profile preflight accepts native tool-style JSON profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-json-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithProfileList(
      fake,
      JSON.stringify(
        {
          currentProfile: "account006",
          profiles: [
            { name: null, displayName: "Default", current: false },
            { name: "account001", displayName: "account001", current: false },
            { name: "account002", displayName: "account002", current: false },
          ],
        },
        null,
        2,
      ),
    );
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight rejects unusable compact JSON without table fallback", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-json-unusable-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({
        profiles: [
          { name: "account001", usable: true },
          { name: "account002", usable: false },
          { name: "account003", usable: true },
        ],
      }),
      "NAME ACCOUNT PROVIDER MODE PLAN\naccount002 - ChatGPT chatgpt Pro",
      invocationLog,
    );
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile preflight failed: profile is unusable: account002");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight treats valid JSON inventory as authoritative when profile is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-json-missing-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({ data: [{ name: "account001", usable: true }] }),
      "NAME ACCOUNT PROVIDER MODE PLAN\nmissing - ChatGPT chatgpt Pro",
      invocationLog,
    );
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "missing", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile not found: missing");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight ignores currentProfile outside an empty authoritative inventory", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-json-current-only-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    const invocationLog = join(root, "invocations.log");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonThenProfileList(
      fake,
      JSON.stringify({
        currentProfile: { name: "account002", profileKind: "named", available: false },
        data: [],
      }),
      "NAME ACCOUNT PROVIDER MODE PLAN\naccount002 - ChatGPT chatgpt Pro",
      invocationLog,
    );
    try {
      expect(() =>
        preflightTarget(
          { type: "agent", provider: "codewith", authProfile: "account002", prompt: "run", configIsolation: "safe" },
          {},
          remoteCodewithPreflightOptions(home),
        ),
      ).toThrow("codewith auth profile not found: account002");
      expect(readFileSync(invocationLog, "utf8").trim().split(/\r?\n/)).toEqual(["profile list --json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("remote codewith auth profile preflight falls back to table output when JSON is unsupported", () => {
    const root = mkdtempSync(join(tmpdir(), "loops-remote-codewith-auth-json-fallback-"));
    const home = join(root, "home");
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const fake = join(binDir, "codewith");
    writeFakeCodewithJsonFailureThenProfileList(
      fake,
      [
        "  NAME       ACCOUNT   PROVIDER MODE    PLAN",
        "  account001 -         ChatGPT chatgpt Pro",
        "* account002 -         ChatGPT chatgpt Pro",
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

// Incident 607176 — "fake green": agent loops reported succeeded/exit 0 while
// having done nothing at all. The trigger was a redacted prompt reaching the
// executor (the control plane's runner-claim payload ran target.prompt through
// publicLoop, so the provider was handed the literal string
// "[redacted N chars]"). The provider dutifully exited 0 after answering that
// it could not see a task, and the runner recorded success.
//
// These tests pin the two independent defences:
//   1. PRECONDITION — an agent prompt that is missing, blank, or a redaction
//      placeholder is never executed. Deterministic, zero false positives, and
//      it holds no matter which upstream hop corrupts the prompt.
//   2. POSTCONDITION — an agent process that exits 0 having written nothing at
//      all to stdout or stderr did not really run, and must not be success.
describe("agent run integrity (incident 607176)", () => {
  function fakeClaude(root: string, script: string): string {
    const bin = join(root, "bin");
    mkdirSync(bin, { recursive: true });
    const claude = join(bin, "claude");
    writeFileSync(claude, script);
    chmodSync(claude, 0o755);
    return bin;
  }

  const echoingClaude = ["#!/usr/bin/env bash", "cat > /dev/null", "printf 'agent ran\\n'", ""].join("\n");
  const silentClaude = ["#!/usr/bin/env bash", "cat > /dev/null", "exit 0", ""].join("\n");

  test.each([
    ["a redaction placeholder with a length", "[redacted 152 chars]"],
    ["a bare redaction placeholder", "[redacted]"],
    ["an empty prompt", ""],
    ["a whitespace-only prompt", "   \n\t  "],
  ])("refuses to execute an agent target whose prompt is %s", async (_label, prompt) => {
    const root = mkdtempSync(join(tmpdir(), "loops-agent-prompt-guard-"));
    // The marker proves the guard is a PREcondition: if the provider is ever
    // spawned the file appears, and a "failed" status would be an accident.
    const marker = join(root, "provider-was-spawned");
    const bin = fakeClaude(
      root,
      ["#!/usr/bin/env bash", `touch ${JSON.stringify(marker)}`, "cat > /dev/null", "printf 'ran\\n'", ""].join("\n"),
    );
    try {
      const result = await executeTarget(
        { type: "agent", provider: "claude", prompt, cwd: root } as AgentTarget,
        {},
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } },
      );
      expect(result.status).toBe("failed");
      expect(result.error ?? "").toMatch(/prompt/i);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a real prompt still runs and still succeeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-agent-prompt-ok-"));
    const bin = fakeClaude(root, echoingClaude);
    try {
      const result = await executeTarget(
        {
          type: "agent",
          provider: "claude",
          prompt: "Write /tmp/sentinel.txt containing SENTINEL-OK and stop.",
          cwd: root,
        } as AgentTarget,
        {},
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } },
      );
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("agent ran");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the exact stored prompt reaches the supported provider invocation", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-agent-stored-prompt-"));
    const bin = join(root, "bin");
    const capture = join(root, "provider-stdin.txt");
    const codewith = join(bin, "codewith");
    const sentinel = "NON_SENSITIVE_STORED_PROMPT_SENTINEL_607176";
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      codewith,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "cat > \"${CAPTURE_FILE:?}\"",
        "printf 'PROVIDER_OUTPUT_SENTINEL\\n'",
        "",
      ].join("\n"),
    );
    chmodSync(codewith, 0o755);
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "stored-prompt-provider-proof",
        schedule: { type: "once", at: "2026-08-09T00:00:00.000Z" },
        target: {
          type: "agent",
          provider: "codewith",
          prompt: sentinel,
          cwd: root,
          configIsolation: "safe",
        },
      });
      const claim = store.claimRun(loop, "2026-08-09T00:00:00.000Z", "truthfulness-test");
      expect(claim).toBeDefined();
      const result = await executeLoop(loop, claim!.run, {
        env: {
          ...process.env,
          HOME: root,
          PATH: `${bin}:/usr/bin:/bin`,
          CAPTURE_FILE: capture,
        },
      });
      expect(result.status).toBe("succeeded");
      expect(result.stdout).toContain("PROVIDER_OUTPUT_SENTINEL");
      expect(readFileSync(capture, "utf8")).toBe(sentinel);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a prompt that merely mentions redaction is not mistaken for a placeholder", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-agent-prompt-mentions-"));
    const bin = fakeClaude(root, echoingClaude);
    try {
      const result = await executeTarget(
        {
          type: "agent",
          provider: "claude",
          prompt: "Explain why [redacted 12 chars] shows up in loop output, then stop.",
          cwd: root,
        } as AgentTarget,
        {},
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } },
      );
      expect(result.status).toBe("succeeded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an agent that exits 0 with no output at all is not a success", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-agent-silent-"));
    const bin = fakeClaude(root, silentClaude);
    try {
      const result = await executeTarget(
        { type: "agent", provider: "claude", prompt: "do the thing", cwd: root } as AgentTarget,
        {},
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } },
      );
      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(0);
      expect(result.error ?? "").toMatch(/no output/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a silent command target is still a success (the guard is agent-only)", async () => {
    const result = await executeTarget({ type: "command", command: "true" }, {}, {});
    expect(result.status).toBe("succeeded");
  });
});
