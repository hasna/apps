import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { Store } from "./store.js";
import { executeLoop, preflightTarget } from "./executor.js";

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
    const fake = join(binDir, "claude");
    await Bun.write(fake, "#!/usr/bin/env bash\nsleep 0.3\nprintf 'stdin:'\ncat\n");
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
      for (let i = 0; i < 50 && !pid; i++) await Bun.sleep(10);
      expect(pid).toBeDefined();
      const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      expect(cmdline).not.toContain(secret);
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
    const fake = join(binDir, "claude");
    await Bun.write(fake, "#!/usr/bin/env bash\nsleep 0.3\ncat >/dev/null\n");
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
      for (let i = 0; i < 50 && !pid; i++) await Bun.sleep(10);
      expect(pid).toBeDefined();
      const environ = readFileSync(`/proc/${pid}/environ`, "utf8").replace(/\0/g, "\n");
      expect(environ).not.toContain(secret);
      expect(environ).not.toContain("AWS_SECRET_ACCESS_KEY=");
      expect(environ).not.toContain("NPM_TOKEN=");
      expect(environ).not.toContain("CODEWITH_HOME=");
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

  test("sends agent prompts on stdin instead of process argv for every provider adapter", async () => {
    if (!existsSync("/proc/self/cmdline")) return;
    const secret = "SECRET_ARGV_PROMPT_VALUE";
    const home = mkdtempSync(join(tmpdir(), "loops-home-argv-"));
    const binDir = join(home, ".local", "bin");
    mkdirSync(binDir, { recursive: true });
    const providers = [
      ["claude", "claude"],
      ["codewith", "codewith"],
      ["codex", "codex"],
      ["opencode", "opencode"],
      ["cursor", "agent"],
      ["aicopilot", "aicopilot"],
    ] as const;
    for (const [provider, binary] of providers) {
      const fake = join(binDir, binary);
      await Bun.write(
        fake,
        provider === "cursor"
          ? "#!/usr/bin/env bash\nset -euo pipefail\nif [[ \"${1:-}\" != \"-p\" ]]; then echo 'missing cursor print flag' >&2; exit 64; fi\nsleep 0.3\nprintf 'stdin:'\ncat\n"
          : "#!/usr/bin/env bash\nsleep 0.3\nprintf 'stdin:'\ncat\n",
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
        for (let i = 0; i < 50 && !pid; i++) await Bun.sleep(10);
        expect(pid).toBeDefined();
        const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
        expect(cmdline).not.toContain(secret);
        const result = await pending;
        expect(result.status).toBe("succeeded");
        expect(result.stdout).toContain(`stdin:${secret}`);
      } finally {
        store.close();
      }
    }
  });
});
