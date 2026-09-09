import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codewithFixtureLauncher } from "../test/agent-launcher.js";
import { hasTmuxExecutable } from "../test/tmux-availability.js";

const SESSION = `dispatch_cli_${process.pid}`;
const cli = join(import.meta.dir, "index.ts");
const agent = join(import.meta.dir, "..", "test", "fake-agent.ts");
const dataDir = mkdtempSync(join(tmpdir(), "dispatch_cli_data_"));
const tmuxDir = mkdtempSync(join(tmpdir(), "dispatch_cli_tmux_"));
const socketPath = join(tmuxDir, `tmux-${process.getuid?.() ?? 0}`, "default");
// Every CLI subprocess (including LocalRunner) uses this suite's server, never
// an inherited TMUX/default user socket or user tmux/shell configuration.
const fixtureEnv: NodeJS.ProcessEnv = {
  ...process.env, HOME: tmuxDir, XDG_CONFIG_HOME: tmuxDir, SHELL: "/bin/sh",
  TMUX: undefined, TMUX_TMPDIR: tmuxDir,
  DISPATCH_DATA_DIR: dataDir, DISPATCH_MAX_DELAY_MS: "500",
};
// startAgent is the checked real-session probe; killing a disposable probe's
// last session immediately before it would introduce the same teardown race.
const tmuxAvailable = hasTmuxExecutable(fixtureEnv);
let agentStarted = false;

const d = tmuxAvailable ? describe : describe.skip;

function runCli(args: string[]) {
  return spawnSync("bun", ["run", cli, ...args], {
    encoding: "utf8",
    input: "",
    // Cap the auto-delay so the real submit path stays exercised but fast.
    env: fixtureEnv,
  });
}

function runCliAsync(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", cli, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

describe("dispatch CLI stdin handling", () => {
  test("send --prompt does not drain an open stdin before parsing flags", () => {
    const res = spawnSync("bash", ["-lc", `tail -f /dev/null | bun run ${JSON.stringify(cli)} send --help`], {
      encoding: "utf8",
      timeout: 4000,
      env: fixtureEnv,
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: dispatch send");
  });

  test("schedule --prompt does not drain an open stdin before parsing flags", () => {
    const res = spawnSync("bash", ["-lc", `tail -f /dev/null | bun run ${JSON.stringify(cli)} schedule --help`], {
      encoding: "utf8",
      timeout: 4000,
      env: fixtureEnv,
    });
    expect(res.error).toBeUndefined();
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage: dispatch schedule");
  });
});

describe("dispatch CLI concurrent ledger writes", () => {
  test("parallel sends wait for sqlite writer locks instead of throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dispatch_cli_concurrent_"));
    try {
      const env = { ...fixtureEnv, DISPATCH_DATA_DIR: dir, DISPATCH_MAX_DELAY_MS: "100" };
      const sends = Array.from({ length: 8 }, (_, i) =>
        runCliAsync(["send", "--to", `dispatch_missing_${i}`, "--prompt", `parallel ${i}`, "--json"], env),
      );
      const results = await Promise.all(sends);
      expect(results.every((r) => r.stderr.includes("database is locked"))).toBe(false);
      for (const result of results) {
        expect(result.stderr).not.toContain("database is locked");
        expect(result.status).toBe(1);
        expect(JSON.parse(result.stdout).status).toBe("failed");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});

async function startAgent(): Promise<void> {
  // Keep the pane/session alive while replacing its process. kill-session /
  // new-session can connect the next client to a server exiting after losing
  // its last session. No sleeps or retries can make that lifecycle atomic.
  const command = agentStarted
    ? ["respawn-pane", "-k", "-t", SESSION]
    : ["-f", "/dev/null", "new-session", "-d", "-s", SESSION, "-x", "200", "-y", "50"];
  const res = spawnSync("tmux", [...command, codewithFixtureLauncher(dataDir), "run", agent], {
    encoding: "utf8", env: fixtureEnv,
  });
  if (res.status !== 0) throw new Error(`failed to start fake agent: ${res.stderr}`);
  agentStarted = true;
  await Bun.sleep(900);
}

d("dispatch CLI send (real tmux + fake agent)", () => {
  beforeEach(async () => {
    await startAgent();
  });
  test("reset replaces the agent without tearing down its last session or server", async () => {
    const sessions = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8", env: fixtureEnv,
    });
    expect(sessions.status).toBe(0);
    expect(sessions.stdout.trim()).toBe(SESSION); // Exercise the last-session boundary.
    const socket = spawnSync("tmux", ["display-message", "-p", "#{socket_path}"], {
      encoding: "utf8", env: fixtureEnv,
    });
    expect(socket.status).toBe(0);
    expect(socket.stdout.trim().startsWith(tmuxDir + "/")).toBe(true);
    const identity = () => {
      const result = spawnSync("tmux", ["display-message", "-p", "-t", SESSION,
        "#{pid}:#{session_id}:#{pane_id}:#{pane_pid}"], { encoding: "utf8", env: fixtureEnv });
      expect(result.status).toBe(0);
      return result.stdout.trim().split(":");
    };
    const before = identity();
    expect(before).toHaveLength(4);
    expect(before.every(Boolean)).toBe(true);
    const sent = spawnSync("tmux", ["send-keys", "-t", SESSION, "previous_fixture_prompt", "Enter"], {
      encoding: "utf8", env: fixtureEnv,
    });
    expect(sent.status).toBe(0);
    const capture = () => spawnSync("tmux", ["capture-pane", "-p", "-t", SESSION], {
      encoding: "utf8", env: fixtureEnv,
    }).stdout;
    const deadline = performance.now() + 4000;
    while (!capture().includes("Working") && performance.now() < deadline) await Bun.sleep(10);
    expect(capture()).toContain("Working");

    await startAgent();

    const after = identity();
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).not.toBe(before[3]);
    expect(capture()).toContain("awaiting prompt — idle");
    expect(capture()).not.toContain("Working");
    expect(capture()).not.toContain("previous_fixture_prompt");
  }, 20000);

  test("send delivers, auto-submits, confirms, and persists (queryable via status)", () => {
    const send = runCli([
      "send",
      "--to",
      SESSION,
      "--prompt",
      "Please refactor the tokenizer and add unit tests for edge cases.",
      "--json",
    ]);
    expect(send.status).toBe(0);
    const rec = JSON.parse(send.stdout);
    expect(rec.status).toBe("succeeded");
    expect(rec.confirm.delivered).toBe(true);
    expect(rec.submitDelayMs).toBeGreaterThan(0);

    // The dispatch is queryable from a fresh CLI invocation (persisted).
    const status = runCli(["status", rec.id, "--json"]);
    expect(status.status).toBe(0);
    expect(JSON.parse(status.stdout).id).toBe(rec.id);

    const list = runCli(["list", "--json"]);
    expect(JSON.parse(list.stdout).length).toBeGreaterThanOrEqual(1);
  }, 20000);

  test("send to a nonexistent target fails with exit code 1", () => {
    const send = runCli(["send", "--to", `${SESSION}_nope`, "--prompt", "hi", "--json"]);
    expect(send.status).toBe(1);
    expect(JSON.parse(send.stdout).status).toBe("failed");
  });

  test("send a long multi-paragraph prompt via --file delivers intact and submits", () => {
    const paras = Array.from({ length: 6 }, (_, i) =>
      `Paragraph ${i}: ` + "lorem ipsum dolor sit amet ".repeat(8).trim(),
    ).join("\n\n");
    const f = join(dataDir, "long_prompt.txt");
    writeFileSync(f, paras);
    const send = runCli(["send", "--to", SESSION, "--file", f, "--json"]);
    expect(send.status).toBe(0);
    const rec = JSON.parse(send.stdout);
    expect(rec.status).toBe("succeeded");
    expect(rec.confirm.delivered).toBe(true);
  }, 20000);
});

// Also clean up when only stdin/ledger cases run or tmux is explicitly skipped.
afterAll(async () => {
  if (tmuxAvailable) {
    // Query even after a failed new-session: a server may have been created
    // before its client failed. Never unlink a live server's private directory.
    const options = { encoding: "utf8" as const, env: fixtureEnv, timeout: 1000 };
    const found = spawnSync("tmux", ["-S", socketPath, "display-message", "-p", "#{pid}"], options);
    const pidText = found.stdout?.trim() ?? "";
    const pid = /^\d+$/.test(pidText) ? Number(pidText) : 0;
    const stopped = spawnSync("tmux", ["-S", socketPath, "kill-server"], options);
    if (found.status === 0 && Number.isSafeInteger(pid) && pid > 1) {
      expect(stopped.status).toBe(0);
      const exited = () => {
        try { process.kill(pid, 0); return false; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
          throw error;
        }
      };
      const deadline = performance.now() + 2000;
      while (!exited() && performance.now() < deadline) await Bun.sleep(10);
      expect(exited()).toBe(true);
    } else if (existsSync(socketPath)) {
      throw new Error("cannot verify private tmux server exit; retaining its fixture directory");
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(tmuxDir, { recursive: true, force: true });
});
