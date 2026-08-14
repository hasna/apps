import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDb, getDb } from "../src/db.js";
import {
  ROSTER_CONFIG_SCHEMA_ID,
  buildRosterLaunchCommand,
  buildTmuxRespawnArgs,
  evaluateRosterGate,
  runRosterReconcile,
  type CommandResult,
  type RosterCommandRunner,
  type RosterConfig,
} from "../src/agent/roster.js";

const dirs: string[] = [];

afterEach(() => {
  closeDb();
  delete process.env["HASNA_MACHINES_DB_PATH"];
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "machines-roster-"));
  dirs.push(dir);
  process.env["HASNA_MACHINES_DB_PATH"] = join(dir, "machines.db");
  return dir;
}

function config(dir: string, count = 1): RosterConfig {
  return {
    $schema: ROSTER_CONFIG_SCHEMA_ID,
    machineId: "station01",
    applyMode: "manual",
    tickSeconds: 60,
    settleSeconds: 90,
    batchSize: 3,
    maxActiveAgents: 12,
    leaseSeconds: 300,
    backoff: { maxAttempts: 3, windowMinutes: 60 },
    gate: {
      minMemAvailableGb: 30,
      maxSwapUsedGb: 12,
      maxPsiFullAvg60: 5,
      maxSwapGrowthGbPerBatch: 2,
    },
    conversations: { channel: "station-ops", bin: "conversations" },
    todos: { project: dir, bin: "todos" },
    functionalChecks: ["todos", "conversations"],
    entries: Array.from({ length: count }, (_, index) => ({
      id: `seat-${index + 1}`,
      target: `agents:0.${index + 1}`,
      profile: `profile-${index + 1}`,
      memoryHigh: "4G",
      memoryMax: "6G",
      memorySwapMax: "0G",
    })),
    recordsPath: join(dir, "roster.jsonl"),
    heartbeatPath: join(dir, "roster-heartbeat.json"),
  };
}

interface FakeRunner {
  run: RosterCommandRunner;
  calls: Array<{ command: string; args: string[] }>;
  panes: Map<string, { dead: boolean; command: string }>;
}

function fakeRunner(roster: RosterConfig, launchStatus = 0): FakeRunner {
  const calls: FakeRunner["calls"] = [];
  const panes = new Map(roster.entries.map((entry) => [entry.target, { dead: true, command: "bash" }]));
  const ok = (stdout = ""): CommandResult => ({ status: 0, stdout, stderr: "" });
  const run: RosterCommandRunner = (command, args) => {
    calls.push({ command, args: [...args] });
    if (command === "tmux" && args[0] === "list-panes") {
      const lines = [...panes].map(([target, pane]) => {
        const [session, rest] = target.split(":");
        const [window, index] = rest!.split(".");
        return [session, window, index, pane.dead ? "1" : "0", pane.command, "123", "accounts launch profile"].join("\t");
      });
      return ok(`${lines.join("\n")}\n`);
    }
    if (command === "tmux" && args[0] === "set-option") return ok();
    if (command === "tmux" && args[0] === "respawn-pane") {
      if (launchStatus !== 0) return { status: launchStatus, stdout: "", stderr: "broken argv" };
      const target = args[args.indexOf("-t") + 1]!;
      panes.set(target, { dead: false, command: "accounts" });
      return ok();
    }
    if (command === "pgrep") return { status: 1, stdout: "", stderr: "" };
    if (command === "todos" && args.includes("search")) return ok("[]");
    if (command === "todos" && args.includes("add")) return ok('{"id":"task-1"}');
    if ((command === "todos" || command === "conversations") && args[0] === "storage") return ok("{}");
    if (command === "conversations" && args[0] === "post") return ok("{}");
    return { status: 127, stdout: "", stderr: `unexpected ${command} ${args.join(" ")}` };
  };
  return { run, calls, panes };
}

const healthyResources = () => ({ memAvailableGb: 40, swapUsedGb: 1, psiFullAvg60: 0.5 });

describe("station roster command construction", () => {
  test("launches only accounts seats inside the capped user slice", () => {
    const roster = config("/tmp", 1);
    const entry = roster.entries[0]!;
    expect(buildRosterLaunchCommand(entry)).toEqual([
      "systemd-run", "--user", "--scope", "--slice=hasna-agents.slice",
      "-p", "MemoryHigh=4G", "-p", "MemoryMax=6G", "-p", "MemorySwapMax=0G",
      "accounts", "launch", "profile-1",
    ]);
    const tmux = buildTmuxRespawnArgs(entry);
    expect(tmux.slice(0, 4)).toEqual(["respawn-pane", "-k", "-t", "agents:0.1"]);
    expect(tmux.join(" ")).not.toContain("send-keys");
    expect(tmux.at(-1)).toContain("accounts launch profile-1");
  });

  test("all four live gates are threshold-driven", () => {
    const thresholds = config("/tmp").gate;
    expect(evaluateRosterGate({ memAvailableGb: 29, swapUsedGb: 1, psiFullAvg60: 1 }, thresholds, 1).reasons[0]).toContain("mem_available");
    expect(evaluateRosterGate({ memAvailableGb: 40, swapUsedGb: 13, psiFullAvg60: 1 }, thresholds, 1).reasons[0]).toContain("swap_used");
    expect(evaluateRosterGate({ memAvailableGb: 40, swapUsedGb: 1, psiFullAvg60: 6 }, thresholds, 1).reasons[0]).toContain("psi_full");
    expect(evaluateRosterGate({ memAvailableGb: 40, swapUsedGb: 4, psiFullAvg60: 1 }, thresholds, 1).reasons[0]).toContain("swap_growth");
  });
});

describe("station roster reconcile", () => {
  test("relaunches six dead seats in settled batches of three and heartbeats only after the full pass", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 6);
    const fake = fakeRunner(roster);
    let clock = Date.parse("2026-07-29T12:00:00.000Z");
    const sleeps: number[] = [];
    const result = await runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
      now: () => new Date(clock),
      sleep: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; },
      drillLevel: "tmux-kill",
    });

    expect(result.status).toBe("succeeded");
    expect(result.launched).toEqual(roster.entries.map((entry) => entry.id));
    expect(sleeps).toEqual([90_000, 90_000]);
    expect(fake.calls.filter((call) => call.command === "tmux" && call.args[0] === "respawn-pane")).toHaveLength(6);
    expect(fake.calls.filter((call) => call.command === "tmux" && call.args[0] === "set-option")).toHaveLength(6);
    expect(fake.calls.filter((call) => call.command === "conversations" && call.args[0] === "post")).toHaveLength(1);
    expect(result.functionalChecks).toEqual({ todos: "ok", conversations: "ok" });
    expect(result.record?.drillLevel).toBe("tmux-kill");
    expect(result.record?.mttrMs).toBe(180_000);
    expect(existsSync(roster.heartbeatPath!)).toBe(true);
    expect(JSON.parse(readFileSync(roster.recordsPath!, "utf8").trim()).schema).toBe("hasna.roster_record.v1");
    expect((getDb().query("SELECT COUNT(*) AS count FROM roster_runs").get() as { count: number }).count).toBe(1);
  });

  test("POSITIVE CONTROL: a live-value gate refusal posts loudly and performs no respawn", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    roster.gate.minMemAvailableGb = 41;
    const fake = fakeRunner(roster);
    const result = await runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
      sleep: async () => {},
    });

    expect(result.status).toBe("blocked");
    expect(result.gate?.reasons.join(" ")).toContain("mem_available");
    expect(fake.calls.some((call) => call.command === "tmux" && call.args[0] === "respawn-pane")).toBe(false);
    expect(fake.calls.filter((call) => call.command === "conversations" && call.args[0] === "post")).toHaveLength(1);
    expect(existsSync(roster.heartbeatPath!)).toBe(false);
  });

  test("POSITIVE CONTROL: exactly three failed attempts latch crashlooping, post urgent, file one task, and stop", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    roster.settleSeconds = 0;
    const fake = fakeRunner(roster, 127);
    const run = () => runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
      sleep: async () => {},
    });

    await run();
    await run();
    const third = await run();
    const fourth = await run();

    expect(fake.calls.filter((call) => call.command === "tmux" && call.args[0] === "respawn-pane")).toHaveLength(3);
    expect(third.crashlooping).toEqual(["seat-1"]);
    expect(fourth.status).toBe("blocked");
    const posts = fake.calls.filter((call) => call.command === "conversations" && call.args[0] === "post");
    expect(posts).toHaveLength(4);
    expect(posts[2]?.args).toContain("urgent");
    expect(posts[2]?.args.some((arg) => arg.includes("crashlooping=seat-1"))).toBe(true);
    expect(fake.calls.filter((call) => call.command === "todos" && call.args.includes("add"))).toHaveLength(1);
    expect(existsSync(roster.heartbeatPath!)).toBe(false);
  });

  test("an unexpired SQLite lease suppresses a concurrent pass without a file lock", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    getDb().query("INSERT INTO roster_leases (name, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?)")
      .run("roster:station01", "other", Date.now(), Date.now() + 60_000);
    const fake = fakeRunner(roster);
    const result = await runRosterReconcile(roster, { runner: fake.run, resourceProbe: healthyResources });
    expect(result.status).toBe("lease-held");
    expect(fake.calls).toEqual([]);
  });

  test("a non-idle stale pane is never killed", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    roster.entries[0]!.heartbeatPath = join(dir, "missing-heartbeat");
    const fake = fakeRunner(roster);
    fake.panes.set("agents:0.1", { dead: false, command: "accounts" });
    const result = await runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
    });
    expect(result.status).toBe("blocked");
    expect(result.plan[0]?.reason).toContain("neither dead nor an idle shell");
    expect(fake.calls.some((call) => call.command === "tmux" && call.args[0] === "respawn-pane")).toBe(false);
  });

  test("an apparently idle shell with a child process is never killed", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    roster.entries[0]!.heartbeatPath = join(dir, "missing-heartbeat");
    const fake = fakeRunner(roster);
    fake.panes.set("agents:0.1", { dead: false, command: "bash" });
    const runner: RosterCommandRunner = (command, args, timeout) => command === "pgrep"
      ? { status: 0, stdout: "456\n", stderr: "" }
      : fake.run(command, args, timeout);
    const result = await runRosterReconcile(roster, {
      apply: true,
      runner,
      resourceProbe: healthyResources,
    });
    expect(result.status).toBe("blocked");
    expect(fake.calls.some((call) => call.command === "tmux" && call.args[0] === "respawn-pane")).toBe(false);
  });

  test("controller errors still produce one loud post and never touch the success heartbeat", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    const calls: Array<{ command: string; args: string[] }> = [];
    const runner: RosterCommandRunner = (command, args) => {
      calls.push({ command, args });
      if (command === "conversations" && args[0] === "post") return { status: 0, stdout: "{}", stderr: "" };
      return { status: 1, stdout: "", stderr: "probe exploded" };
    };
    const result = await runRosterReconcile(roster, { apply: true, runner, resourceProbe: healthyResources });
    expect(result.status).toBe("failed");
    expect(result.warnings.join(" ")).toContain("tmux list-panes failed");
    expect(calls.filter((call) => call.command === "conversations" && call.args[0] === "post")).toHaveLength(1);
    expect(existsSync(roster.heartbeatPath!)).toBe(false);
  });

  test("a failed pass leaves the prior success heartbeat byte-for-byte unchanged", async () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    roster.settleSeconds = 0;
    const fake = fakeRunner(roster);
    const first = await runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
      sleep: async () => {},
    });
    expect(first.status).toBe("succeeded");
    const heartbeat = readFileSync(roster.heartbeatPath!, "utf8");
    fake.panes.set("agents:0.1", { dead: true, command: "bash" });
    roster.gate.minMemAvailableGb = 100;
    const second = await runRosterReconcile(roster, {
      apply: true,
      runner: fake.run,
      resourceProbe: healthyResources,
      sleep: async () => {},
    });
    expect(second.status).toBe("blocked");
    expect(readFileSync(roster.heartbeatPath!, "utf8")).toBe(heartbeat);
  });

  test("the apply verb rejects an unapproved mutation before observing tmux", () => {
    const dir = fixtureDir();
    const roster = config(dir, 1);
    const configPath = join(dir, "roster.json");
    writeFileSync(configPath, JSON.stringify(roster));
    const env = { ...process.env };
    delete env["HASNA_MACHINES_ALLOW_MUTATIONS"];
    delete env["HASNA_MACHINES_MUTATION_APPROVAL"];
    delete env["HASNA_MACHINES_MUTATION_TOKEN"];
    const child = Bun.spawnSync([
      process.execPath,
      "run",
      "src/agent/index.ts",
      "roster",
      "reconcile",
      "--config",
      configPath,
      "--apply",
    ], { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).not.toBe(0);
    expect(child.stderr.toString()).toContain("requires operator approval");
  });
});
