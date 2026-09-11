import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codewithFixtureLauncher } from "../test/agent-launcher.js";
import { hasTmuxExecutable } from "../test/tmux-availability.js";

const SESSION = `dispatch_daemon_it_${process.pid}`;
const cli = join(import.meta.dir, "..", "cli", "index.ts");
const agent = join(import.meta.dir, "..", "test", "fake-agent.ts");
let dataDir = "";
let tmuxDir = "";
let socketPath = "";
// The CLI and the daemon inherit this same private server, not the caller's
// TMUX/default socket, tmux configuration, or shell profile.
const env: NodeJS.ProcessEnv = {
  ...process.env,
  TMUX: undefined,
  DISPATCH_MAX_DELAY_MS: "300",
  DISPATCH_DAEMON_INTERVAL_MS: "400",
};
// startAgent is the checked session probe. A disposable last-session probe
// would introduce the very teardown boundary that reset must avoid.
const tmuxAvailable = hasTmuxExecutable(env);
const d = tmuxAvailable ? describe : describe.skip;
let agentStarted = false;
let agentStartAttempted = false;

function runCli(args: string[]) {
  return spawnSync("bun", ["run", cli, ...args], { encoding: "utf8", input: "", env });
}

function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

async function startAgent(): Promise<void> {
  // Keep the session/server alive while replacing only the fake agent.
  const command = agentStarted
    ? ["respawn-pane", "-k", "-t", SESSION]
    : ["-f", "/dev/null", "new-session", "-d", "-s", SESSION, "-x", "200", "-y", "50"];
  agentStartAttempted = true;
  const res = spawnSync(
    "tmux",
    [...command, codewithFixtureLauncher(dataDir), "run", agent],
    { encoding: "utf8", env },
  );
  if (res.status !== 0) throw new Error(`failed to start fake agent: ${res.stderr}`);
  agentStarted = true;
  await Bun.sleep(900);
}

d("dispatch daemon (real tmux + fake agent)", () => {
  beforeAll(() => {
    // Bun does not run afterAll for a wholly skipped/filtered suite. Allocate
    // only once a test is selected so unavailable tmux leaves no directories.
    dataDir = mkdtempSync(join(tmpdir(), "dispatch_daemon_it_"));
    tmuxDir = realpathSync(mkdtempSync(join(tmpdir(), "dispatch_daemon_tmux_")));
    socketPath = join(tmuxDir, `tmux-${process.getuid?.() ?? 0}`, "default");
    Object.assign(env, {
      HOME: tmuxDir, XDG_CONFIG_HOME: tmuxDir, SHELL: "/bin/sh",
      TMUX_TMPDIR: tmuxDir, DISPATCH_DATA_DIR: dataDir,
    });
  });
  beforeEach(async () => {
    await startAgent();
  });
  afterEach(() => {
    runCli(["daemon", "stop"]);
  });

  test("reset clears the prior agent and still delivers without losing its last session", async () => {
    const tmux = (args: string[]) => spawnSync("tmux", args, { encoding: "utf8", env });
    const identity = () => {
      const result = tmux(["display-message", "-p", "-t", SESSION,
        "#{pid}:#{session_id}:#{pane_id}:#{pane_pid}"]);
      expect(result.status).toBe(0);
      const parts = result.stdout.trim().split(":");
      expect(parts).toHaveLength(4);
      expect(parts.every(Boolean)).toBe(true);
      return parts;
    };
    const sessions = tmux(["list-sessions", "-F", "#{session_name}"]);
    expect(sessions.status).toBe(0);
    expect(sessions.stdout.trim()).toBe(SESSION);
    const socket = tmux(["display-message", "-p", "#{socket_path}"]);
    expect(socket.status).toBe(0);
    expect(socket.stdout.trim()).toBe(socketPath);
    const before = identity();
    expect(tmux(["send-keys", "-t", SESSION, "previous_daemon_fixture_prompt", "Enter"]).status).toBe(0);
    const capture = () => tmux(["capture-pane", "-p", "-t", SESSION]).stdout;
    const deadline = performance.now() + 4000;
    while (!capture().includes("Working") && performance.now() < deadline) await Bun.sleep(10);
    expect(capture()).toContain("Working");

    await startAgent();

    const after = identity();
    expect(capture()).toContain("awaiting prompt — idle");
    expect(capture()).not.toContain("previous_daemon_fixture_prompt");
    const sent = runCli(["send", "--to", SESSION, "--prompt", "fresh daemon fixture delivery", "--json"]);
    expect(sent.status, sent.stderr || sent.stdout).toBe(0);
    expect(JSON.parse(sent.stdout)).toMatchObject({ status: "succeeded", confirm: { delivered: true } });
    // Server identity matters: session/pane IDs alone can repeat after restart.
    expect(after.slice(0, 3)).toEqual(before.slice(0, 3));
    expect(after[3]).not.toBe(before[3]);
  }, 20000);

  test("start -> status reports running; stop reports stopped", () => {
    const start = runCli(["daemon", "start"]);
    expect(start.status).toBe(0);
    expect(start.stdout).toMatch(/started|already running/);

    const status = JSON.parse(runCli(["daemon", "status", "--json"]).stdout);
    expect(status.running).toBe(true);
    expect(typeof status.pid).toBe("number");

    const stop = runCli(["daemon", "stop"]);
    expect(stop.stdout).toMatch(/stopped/);
    expect(JSON.parse(runCli(["daemon", "status", "--json"]).stdout).running).toBe(false);
  });

  test("ensure is idempotent and restart brings the daemon back healthy", () => {
    const ensure = runCli(["daemon", "ensure", "--json"]);
    expect(ensure.status).toBe(0);
    let status = JSON.parse(runCli(["daemon", "status", "--json"]).stdout);
    expect(status.running).toBe(true);
    expect(status.health).toBe("alive");

    const ensureAgain = JSON.parse(runCli(["daemon", "ensure", "--json"]).stdout);
    expect(ensureAgain.alreadyRunning).toBe(true);

    const restart = runCli(["daemon", "restart", "--json"]);
    expect(restart.status).toBe(0);
    status = JSON.parse(runCli(["daemon", "status", "--json"]).stdout);
    expect(status.running).toBe(true);
    expect(status.health).toBe("alive");
    expect(status.lastTickAt || status.lastTickStartedAt).toBeDefined();
  }, 30000);

  test("a relative scheduled dispatch fires and is delivered to the pane", async () => {
    runCli(["daemon", "start"]);
    const sched = JSON.parse(
      runCli(["schedule", "--to", SESSION, "--prompt", "scheduled hello to the agent", "--in", "1500ms", "--json"])
        .stdout,
    );
    expect(sched.status).toBe("admitted");
    expect(sched.at).toBeDefined();

    // Wait past the fire time + a tick + full delivery (generous for load).
    await Bun.sleep(12000);

    const schedules = JSON.parse(runCli(["schedules", "--json"]).stdout);
    expect(schedules.find((s: any) => s.id === sched.id).status).toBe("succeeded");

    const dispatches = JSON.parse(runCli(["list", "--json"]).stdout);
    const fired = dispatches.find((r: any) => r.prompt.includes("scheduled hello"));
    expect(fired).toBeDefined();
    expect(fired.status).toBe("succeeded");
    expect(fired.confirm.delivered).toBe(true);
  }, 30000);

  test("an interval loop fires and remains scheduled for its next run", async () => {
    runCli(["daemon", "start"]);
    const loop = JSON.parse(
      runCli(["loop", "--to", SESSION, "--prompt", "loop hello to the agent", "--every", "2s", "--name", "it-loop", "--json"])
        .stdout,
    );
    expect(loop).toMatchObject({ status: "admitted", kind: "loop", name: "it-loop", every: "2s" });

    await Bun.sleep(9000);

    const loops = JSON.parse(runCli(["loops", "--json"]).stdout);
    const after = loops.find((s: any) => s.id === loop.id);
    expect(after).toBeDefined();
    expect(after.status).toBe("admitted");
    expect(after.lastAttemptId).toBeDefined();

    const dispatches = JSON.parse(runCli(["list", "--json"]).stdout);
    expect(dispatches.some((r: any) => r.prompt.includes("loop hello"))).toBe(true);
    expect(runCli(["clear", loop.id]).status).toBe(0);
  }, 30000);

  test("scheduled dispatch survives a daemon restart (persisted queue)", async () => {
    // Schedule ~3.5s out, then stop the daemon before it can fire.
    runCli(["daemon", "start"]);
    const sched = JSON.parse(
      runCli(["schedule", "--to", SESSION, "--prompt", "survives restart marker", "--at", isoIn(3500), "--json"])
        .stdout,
    );
    await Bun.sleep(600);
    runCli(["daemon", "stop"]);
    await Bun.sleep(400);

    // The schedule is still pending (not yet fired) and persisted on disk.
    let after = JSON.parse(runCli(["schedules", "--json"]).stdout).find((s: any) => s.id === sched.id);
    expect(after.status).toBe("admitted");

    // Restart a fresh daemon process; it must pick up the persisted schedule
    // (which fires ~3.5s after creation) and deliver it.
    runCli(["daemon", "start"]);
    await Bun.sleep(14000);

    after = JSON.parse(runCli(["schedules", "--json"]).stdout).find((s: any) => s.id === sched.id);
    expect(after.status).toBe("succeeded");
    const fired = JSON.parse(runCli(["list", "--json"]).stdout).find((r: any) =>
      r.prompt.includes("survives restart marker"),
    );
    expect(fired).toBeDefined();
    expect(fired.status).toBe("succeeded");
  }, 35000);
});

// Clean up even when the first start reports failure after creating a server.
afterAll(async () => {
  if (!agentStartAttempted) {
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
    if (tmuxDir) rmSync(tmuxDir, { recursive: true, force: true });
    return;
  }
  const daemonStop = runCli(["daemon", "stop"]);
  let daemonStopped = false;
  try {
    const status = runCli(["daemon", "status", "--json"]);
    daemonStopped = daemonStop.status === 0 && status.status === 0 && JSON.parse(status.stdout).running === false;
  } finally {
    if (tmuxAvailable) {
      // Query the exact socket even if new-session reported failure. Do not
      // remove a live/uncertain server's directory or lose its cleanup locator.
      const options = { encoding: "utf8" as const, env, timeout: 1000 };
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
  }
  if (!daemonStopped) throw new Error("cannot verify fixture daemon exit; retaining its data directory");
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(tmuxDir, { recursive: true, force: true });
});
