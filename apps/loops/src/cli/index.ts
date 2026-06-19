#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import type { AgentProvider, CatchUpPolicy, CreateLoopInput, LoopTarget, OverlapPolicy, ScheduleSpec } from "../types.js";
import { daemonLogPath } from "../lib/paths.js";
import { publicLoop, publicRun } from "../lib/format.js";
import { parseDuration } from "../lib/schedule.js";
import { Store } from "../lib/store.js";
import { executeLoop } from "../lib/executor.js";
import { tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon } from "../daemon/daemon.js";
import { installStartup } from "../daemon/install.js";

const program = new Command();

program.name("loops").description("Persistent local loops for commands and headless coding agents").version("0.1.0");
program.option("-j, --json", "print JSON");

function isJson(): boolean {
  return Boolean(program.opts().json);
}

function print(value: unknown, human?: string): void {
  if (isJson() || !human) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function parseSchedule(opts: { at?: string; every?: string; cron?: string; dynamic?: boolean }): ScheduleSpec {
  const count = [opts.at, opts.every, opts.cron, opts.dynamic ? "dynamic" : undefined].filter(Boolean).length;
  if (count !== 1) throw new Error("choose exactly one schedule: --at, --every, --cron, or --dynamic");
  if (opts.at) return { type: "once", at: new Date(opts.at).toISOString() };
  if (opts.every) return { type: "interval", everyMs: parseDuration(opts.every), anchor: "fixed_rate" };
  if (opts.cron) return { type: "cron", expression: opts.cron };
  return { type: "dynamic", minIntervalMs: 60_000 };
}

function positiveInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function positiveDuration(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined) return undefined;
  const value = parseDuration(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
}

function parsePolicy(opts: {
  catchUp?: string;
  catchUpLimit?: string;
  overlap?: string;
  attempts?: string;
  retryDelay?: string;
  lease?: string;
}) {
  const catchUp = (opts.catchUp ?? "latest") as CatchUpPolicy;
  if (!["none", "latest", "all"].includes(catchUp)) throw new Error("--catch-up must be none, latest, or all");
  const overlap = (opts.overlap ?? "skip") as OverlapPolicy;
  if (!["skip", "allow"].includes(overlap)) throw new Error("--overlap must be skip or allow");
  return {
    catchUp,
    catchUpLimit: positiveInteger(opts.catchUpLimit, "--catch-up-limit"),
    overlap,
    maxAttempts: positiveInteger(opts.attempts, "--attempts"),
    retryDelayMs: positiveDuration(opts.retryDelay, "--retry-delay"),
    leaseMs: positiveDuration(opts.lease, "--lease"),
  };
}

function baseCreateInput(name: string, opts: Record<string, string | boolean | undefined>, target: LoopTarget): CreateLoopInput {
  const schedule = parseSchedule({
    at: typeof opts.at === "string" ? opts.at : undefined,
    every: typeof opts.every === "string" ? opts.every : undefined,
    cron: typeof opts.cron === "string" ? opts.cron : undefined,
    dynamic: Boolean(opts.dynamic),
  });
  const policy = parsePolicy({
    catchUp: typeof opts.catchUp === "string" ? opts.catchUp : undefined,
    catchUpLimit: typeof opts.catchUpLimit === "string" ? opts.catchUpLimit : undefined,
    overlap: typeof opts.overlap === "string" ? opts.overlap : undefined,
    attempts: typeof opts.attempts === "string" ? opts.attempts : undefined,
    retryDelay: typeof opts.retryDelay === "string" ? opts.retryDelay : undefined,
    lease: typeof opts.lease === "string" ? opts.lease : undefined,
  });
  return {
    name,
    description: typeof opts.description === "string" ? opts.description : undefined,
    schedule,
    target,
    ...policy,
    expiresAt: typeof opts.expiresAt === "string" ? new Date(opts.expiresAt).toISOString() : undefined,
  };
}

function addScheduleOptions(command: Command): Command {
  return command
    .option("--at <time>", "run once at an absolute time")
    .option("--every <duration>", "run at a fixed interval, e.g. 15m, 1h, 30s")
    .option("--cron <expr>", "run on a 5-field cron expression")
    .option("--dynamic", "run on the default dynamic one-minute cadence")
    .option("--catch-up <policy>", "none, latest, or all", "latest")
    .option("--catch-up-limit <n>", "maximum missed slots to run when --catch-up all")
    .option("--overlap <policy>", "skip or allow", "skip")
    .option("--attempts <n>", "max attempts per scheduled slot")
    .option("--retry-delay <duration>", "delay between retries", "1m")
    .option("--lease <duration>", "running lease timeout", "30m")
    .option("--expires-at <time>", "stop scheduling after this time")
    .option("-d, --description <text>", "description");
}

const create = program.command("create").description("create loops");

addScheduleOptions(
  create
    .command("command <name>")
    .description("create a deterministic shell command loop")
    .requiredOption("--cmd <command>", "command string to execute")
    .option("--cwd <dir>", "working directory")
    .option("--timeout <duration>", "run timeout")
    .option("--no-shell", "execute without a shell"),
).action((name, opts) => {
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "command",
      command: opts.cmd,
      cwd: opts.cwd,
      shell: opts.shell,
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

addScheduleOptions(
  create
    .command("agent <name>")
    .description("create a headless coding-agent loop")
    .requiredOption("--provider <provider>", "claude, cursor, codewith, aicopilot, or opencode")
    .requiredOption("--prompt <prompt>", "agent prompt")
    .option("--cwd <dir>", "working directory")
    .option("--model <model>", "model")
    .option("--agent <agent>", "provider-specific agent")
    .option("--timeout <duration>", "run timeout")
    .option("--config-isolation <mode>", "safe or none", "safe"),
).action((name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode"].includes(provider)) {
    throw new Error("unsupported provider");
  }
  if (!["safe", "none"].includes(opts.configIsolation)) {
    throw new Error("--config-isolation must be safe or none");
  }
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "agent",
      provider,
      prompt: opts.prompt,
      cwd: opts.cwd,
      model: opts.model,
      agent: opts.agent,
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      configIsolation: opts.configIsolation,
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

program
  .command("list")
  .alias("ls")
  .option("--status <status>", "filter by status")
  .action((opts) => {
    const store = new Store();
    try {
      const loops = store.listLoops({ status: opts.status });
      if (isJson()) print(loops.map(publicLoop));
      else {
        for (const loop of loops) {
          console.log(`${loop.id}  ${loop.status.padEnd(7)}  next=${loop.nextRunAt ?? "-"}  ${loop.name}`);
        }
      }
    } finally {
      store.close();
    }
  });

program.command("show <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    print(publicLoop(store.requireLoop(idOrName)));
  } finally {
    store.close();
  }
});

program
  .command("runs [idOrName]")
  .option("--limit <n>", "limit", "50")
  .option("--show-output", "show stdout/stderr")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const loop = idOrName ? store.requireLoop(idOrName) : undefined;
      const runs = store.listRuns({ loopId: loop?.id, limit: Number(opts.limit) });
      if (isJson()) print(runs.map((run) => publicRun(run, opts.showOutput)));
      else {
        for (const run of runs) {
          console.log(
            `${run.id}  ${run.status.padEnd(10)}  attempt=${run.attempt}  slot=${run.scheduledFor}  ${run.loopName}`,
          );
        }
      }
    } finally {
      store.close();
    }
  });

program.command("pause <idOrName>").action((idOrName) => updateStatus(idOrName, "paused"));
program.command("resume <idOrName>").action((idOrName) => updateStatus(idOrName, "active"));
program.command("stop <idOrName>").action((idOrName) => updateStatus(idOrName, "stopped"));

function updateStatus(idOrName: string, status: "paused" | "active" | "stopped"): void {
  const store = new Store();
  try {
    const loop = store.requireLoop(idOrName);
    const updated = store.updateLoop(loop.id, { status, nextRunAt: status === "stopped" ? undefined : loop.nextRunAt });
    print(publicLoop(updated), `${updated.id} ${updated.status}`);
  } finally {
    store.close();
  }
}

program
  .command("remove <idOrName>")
  .alias("rm")
  .action((idOrName) => {
    const store = new Store();
    try {
      const removed = store.deleteLoop(idOrName);
      print({ removed }, removed ? "removed" : "not removed");
    } finally {
      store.close();
    }
  });

program
  .command("run-now <idOrName>")
  .option("--show-output", "show stdout/stderr")
  .action(async (idOrName, opts) => {
  const store = new Store();
  try {
    const loop = store.requireLoop(idOrName);
    const claim = store.claimRun(loop, new Date().toISOString(), `manual:${process.pid}`);
    if (!claim) throw new Error("could not claim manual run");
    const result = await executeLoop(loop, claim.run);
    const run = store.finalizeRun(claim.run.id, {
      status: result.status,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error: result.error,
      pid: result.pid,
    });
    print(publicRun(run, opts.showOutput), `${run.id} ${run.status}`);
  } finally {
    store.close();
  }
});

program.command("tick").description("run one scheduler tick").action(async () => {
  const store = new Store();
  try {
    const result = await tick({ store, runnerId: `manual-tick:${process.pid}` });
    print(result, `completed=${result.completed.length} skipped=${result.skipped.length} recovered=${result.recovered.length}`);
  } finally {
    store.close();
  }
});

const daemon = program.command("daemon").description("manage the local daemon");

daemon
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .action(async (opts) => runDaemon({ intervalMs: opts.intervalMs }));

daemon.command("start").action(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops" });
  print(result, result.alreadyRunning ? `already running pid=${result.pid}` : result.started ? `started pid=${result.pid}` : "failed to start");
});

daemon.command("stop").action(async () => {
  const result = await stopDaemon();
  print(result, result.stopped ? `stopped pid=${result.pid}` : "not running");
});

daemon.command("status").action(() => {
  const store = new Store();
  try {
    print(daemonStatus(store));
  } finally {
    store.close();
  }
});

daemon.command("install").description("write a systemd user service or launchd plist").action(() => {
  const result = installStartup(process.argv[1] ?? "loops");
  print(result, `wrote ${result.path}\n${result.instructions.join("\n")}`);
});

daemon
  .command("logs")
  .option("-n, --lines <n>", "lines", "80")
  .action((opts) => {
    const path = daemonLogPath();
    if (!existsSync(path)) {
      console.log("");
      return;
    }
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    console.log(lines.slice(-Number(opts.lines)).join("\n"));
  });

await program.parseAsync(process.argv);
