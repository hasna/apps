import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
      ["cursor", "cursor-agent"],
      ["aicopilot", "aicopilot"],
    ] as const;
    for (const [provider, binary] of providers) {
      const fake = join(binDir, binary);
      await Bun.write(
        fake,
        provider === "cursor"
          ? "#!/usr/bin/env bash\nset -euo pipefail\nif [[ \"${1:-}\" != \"agent\" ]]; then echo 'missing cursor agent subcommand' >&2; exit 64; fi\nsleep 0.3\nprintf 'stdin:'\ncat\n"
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
