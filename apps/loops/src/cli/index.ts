#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import type { AccountRef, AgentProvider, CatchUpPolicy, CreateLoopInput, LoopTarget, OverlapPolicy, ScheduleSpec } from "../types.js";
import { daemonLogPath } from "../lib/paths.js";
import {
  publicLoop,
  publicExecutorResult,
  publicRun,
  publicWorkflow,
  publicWorkflowEvent,
  publicWorkflowRun,
  publicWorkflowStepRun,
  textOutputBlocks,
} from "../lib/format.js";
import { parseDuration } from "../lib/schedule.js";
import { Store } from "../lib/store.js";
import { executeWorkflow, preflightWorkflow } from "../lib/workflow-runner.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, manualRunSource, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { daemonStatus, stopDaemon } from "../daemon/control.js";
import { runDaemon, startDaemon } from "../daemon/daemon.js";
import { enableStartup, installStartup } from "../daemon/install.js";
import { workflowBodyFromJson } from "../lib/workflow-spec.js";
import { runDoctor } from "../lib/doctor.js";

const program = new Command();

program.name("loops").description("Persistent local loops for commands and headless coding agents").version("0.3.3");
program.option("-j, --json", "print JSON");

function isJson(): boolean {
  return Boolean(program.opts().json);
}

function print(value: unknown, human?: string): void {
  if (isJson() || !human) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function printTextOutput(value: { stdout?: string; stderr?: string }): void {
  for (const line of textOutputBlocks(value, { indent: "  " })) console.log(line);
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

function addAccountOptions(command: Command): Command {
  return command
    .option("--account <profile>", "OpenAccounts profile name for this target")
    .option("--account-tool <tool>", "OpenAccounts tool id; defaults from provider for agents");
}

function accountFromOpts(opts: { account?: string; accountTool?: string }): AccountRef | undefined {
  if (!opts.account && opts.accountTool) throw new Error("--account-tool requires --account");
  return opts.account ? { profile: opts.account, tool: opts.accountTool } : undefined;
}

function providerAuthProfileFromOpts(opts: { authProfile?: string }, provider: AgentProvider): string | undefined {
  if (!opts.authProfile) return undefined;
  if (provider !== "codewith") throw new Error("--auth-profile is currently supported only for --provider codewith");
  return opts.authProfile;
}

const create = program.command("create").description("create loops");

addAccountOptions(
  addScheduleOptions(
    create
      .command("command <name>")
      .description("create a deterministic shell command loop")
      .requiredOption("--cmd <command>", "command string to execute")
      .option("--cwd <dir>", "working directory")
      .option("--timeout <duration>", "run timeout")
      .option("--no-shell", "execute without a shell"),
  ),
).action((name, opts) => {
  const store = new Store();
  try {
    const target: LoopTarget = {
      type: "command",
      command: opts.cmd,
      cwd: opts.cwd,
      shell: opts.shell,
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      account: accountFromOpts(opts),
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

addAccountOptions(
  addScheduleOptions(
    create
      .command("agent <name>")
      .description("create a headless coding-agent loop")
      .requiredOption("--provider <provider>", "claude, cursor, codewith, aicopilot, opencode, or codex")
      .requiredOption("--prompt <prompt>", "agent prompt")
      .option("--cwd <dir>", "working directory")
      .option("--model <model>", "model")
      .option("--agent <agent>", "provider-specific agent")
      .option("--auth-profile <profile>", "provider-native auth profile; currently supported for codewith")
      .option("--timeout <duration>", "run timeout")
      .option("--config-isolation <mode>", "safe or none", "safe"),
  ),
).action((name, opts) => {
  const provider = opts.provider as AgentProvider;
  if (!["claude", "cursor", "codewith", "aicopilot", "opencode", "codex"].includes(provider)) {
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
      authProfile: providerAuthProfileFromOpts(opts, provider),
      timeoutMs: opts.timeout ? parseDuration(opts.timeout) : undefined,
      configIsolation: opts.configIsolation,
      account: accountFromOpts(opts),
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created loop ${loop.id} (${loop.name}) next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

addScheduleOptions(
  create
    .command("workflow <name>")
    .description("schedule a stored workflow")
    .requiredOption("--workflow <idOrName>", "workflow id or name"),
).action((name, opts) => {
  const store = new Store();
  try {
    const workflow = store.requireWorkflow(opts.workflow);
    const target: LoopTarget = {
      type: "workflow",
      workflowId: workflow.id,
    };
    const loop = store.createLoop(baseCreateInput(name, opts, target));
    print(publicLoop(loop), `created workflow loop ${loop.id} (${loop.name}) workflow=${workflow.name} next=${loop.nextRunAt}`);
  } finally {
    store.close();
  }
});

const workflows = program.command("workflows").alias("workflow").description("manage workflow specs and runs");

workflows
  .command("validate <file>")
  .description("validate a workflow JSON file without storing or running it")
  .option("--name <name>", "override workflow name from the file")
  .option("--preflight", "also check account env and target executables")
  .action((file, opts) => {
    const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
    const now = new Date().toISOString();
    const workflow = {
      id: "validation",
      name: body.name,
      description: body.description,
      version: body.version ?? 1,
      status: "active" as const,
      steps: body.steps,
      createdAt: now,
      updatedAt: now,
    };
    const preflight = opts.preflight ? preflightWorkflow(workflow) : undefined;
    print({ valid: true, workflow: publicWorkflow(workflow), preflight }, `valid workflow ${workflow.name} steps=${workflow.steps.length}`);
  });

workflows
  .command("create <file>")
  .description("validate and store a workflow JSON file")
  .option("--name <name>", "override workflow name from the file")
  .action((file, opts) => {
    const store = new Store();
    try {
      const body = workflowBodyFromJson(JSON.parse(readFileSync(file, "utf8")), opts.name);
      const workflow = store.createWorkflow(body);
      print(publicWorkflow(workflow), `created workflow ${workflow.id} (${workflow.name}) steps=${workflow.steps.length}`);
    } finally {
      store.close();
    }
  });

workflows
  .command("list")
  .alias("ls")
  .option("--status <status>", "active or archived", "active")
  .action((opts) => {
    const store = new Store();
    try {
      const workflowsList = store.listWorkflows({ status: opts.status });
      if (isJson()) print(workflowsList.map(publicWorkflow));
      else {
        for (const workflow of workflowsList) {
          console.log(`${workflow.id}  ${workflow.status.padEnd(8)}  steps=${workflow.steps.length}  ${workflow.name}`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows.command("show <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    print(publicWorkflow(store.requireWorkflow(idOrName)));
  } finally {
    store.close();
  }
});

workflows.command("inspect <runId>").description("show a workflow run with steps and events").action((runId) => {
  const store = new Store();
  try {
    const run = store.requireWorkflowRun(runId);
    const steps = store.listWorkflowStepRuns(run.id);
    const events = store.listWorkflowEvents(run.id);
    const value = {
      workflowRun: publicWorkflowRun(run),
      steps: steps.map((step) => publicWorkflowStepRun(step)),
      events: events.map(publicWorkflowEvent),
    };
    if (isJson()) print(value);
    else {
      console.log(`${run.id}  ${run.status}  ${run.workflowName}`);
      for (const step of steps) {
        const publicStep = publicWorkflowStepRun(step);
        console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
      }
      console.log(`  events=${events.length}`);
    }
  } finally {
    store.close();
  }
});

workflows
  .command("run <idOrName>")
  .option("--show-output", "show step stdout/stderr")
  .action(async (idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = store.requireWorkflow(idOrName);
      const result = await executeWorkflow(store, workflow);
      const run = store.listWorkflowRuns({ workflowId: workflow.id, limit: 1 })[0];
      const steps = run ? store.listWorkflowStepRuns(run.id) : [];
      const value = {
        result: publicExecutorResult(result),
        workflowRun: run ? publicWorkflowRun(run) : undefined,
        steps: steps.map((step) => publicWorkflowStepRun(step, opts.showOutput)),
      };
      if (isJson()) print(value);
      else {
        console.log(`${run?.id ?? workflow.id} ${result.status}`);
        for (const step of steps) {
          const publicStep = publicWorkflowStepRun(step, opts.showOutput);
          console.log(`  ${String(step.sequence).padStart(2, "0")}  ${step.status.padEnd(10)}  ${step.stepId}  ${publicStep.error ?? ""}`);
          if (opts.showOutput) printTextOutput(step);
        }
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("runs [idOrName]")
  .option("--limit <n>", "limit", "50")
  .action((idOrName, opts) => {
    const store = new Store();
    try {
      const workflow = idOrName ? store.requireWorkflow(idOrName) : undefined;
      const runs = store.listWorkflowRuns({ workflowId: workflow?.id, limit: Number(opts.limit) });
      if (isJson()) print(runs.map(publicWorkflowRun));
      else {
        for (const run of runs) {
          console.log(`${run.id}  ${run.status.padEnd(10)}  ${run.workflowName}  started=${run.startedAt ?? "-"}`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("events <runId>")
  .option("--limit <n>", "limit", "200")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const events = store.listWorkflowEvents(runId, Number(opts.limit));
      if (isJson()) print(events.map(publicWorkflowEvent));
      else {
        for (const event of events) {
          console.log(`${String(event.sequence).padStart(3, "0")}  ${event.eventType.padEnd(14)}  ${event.stepId ?? "-"}  ${event.createdAt}`);
        }
      }
    } finally {
      store.close();
    }
  });

workflows
  .command("cancel <runId>")
  .description("mark a workflow run cancelled and cancel pending/running steps")
  .option("--reason <reason>", "cancellation reason", "cancelled by user")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const run = store.cancelWorkflowRun(runId, opts.reason);
      print(publicWorkflowRun(run), `${run.id} ${run.status}`);
    } finally {
      store.close();
    }
  });

workflows
  .command("recover <runId>")
  .description("reset interrupted running workflow steps to pending")
  .option("--reason <reason>", "recovery reason", "manual recovery")
  .action((runId, opts) => {
    const store = new Store();
    try {
      const result = store.recoverWorkflowRun(runId, opts.reason);
      print(
        {
          workflowRun: publicWorkflowRun(result.run),
          recoveredSteps: result.recoveredSteps.map((step) => publicWorkflowStepRun(step)),
        },
        `${result.run.id} recovered=${result.recoveredSteps.length}`,
      );
    } finally {
      store.close();
    }
  });

workflows.command("archive <idOrName>").action((idOrName) => {
  const store = new Store();
  try {
    const workflow = store.archiveWorkflow(idOrName);
    print(publicWorkflow(workflow), `${workflow.id} ${workflow.status}`);
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
          if (opts.showOutput) printTextOutput(run);
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
      const runnerId = `manual:${process.pid}`;
      const now = new Date();
      let scheduledFor = manualRunScheduledFor(loop, now);
      let source = manualRunSource(loop, scheduledFor, now);
      let shouldAdvance = shouldAdvanceManualRun(loop, scheduledFor, now);
      let claim = store.claimRun(loop, scheduledFor, runnerId, now);
      if (!claim && shouldAdvance) {
        const existing = store.getRunBySlot(loop.id, scheduledFor);
        if (existing && existing.status !== "running") {
          scheduledFor = now.toISOString();
          source = "ad_hoc";
          shouldAdvance = false;
          claim = store.claimRun(loop, scheduledFor, runnerId, now);
        }
      }
      if (!claim) throw new Error("could not claim manual run");
      const run = await executeClaimedRun({ store, runnerId, loop: claim.loop, run: claim.run });
      if (shouldAdvance) {
        advanceLoop(store, claim.loop, run, new Date(run.finishedAt ?? new Date()), run.status === "succeeded");
      }
      const value = { ...publicRun(run, opts.showOutput), runNow: { source, advancesLoop: shouldAdvance } };
      print(value, `${run.id} ${run.status} source=${source} slot=${run.scheduledFor}`);
      if (!isJson() && opts.showOutput) printTextOutput(run);
      if (run.status !== "succeeded") process.exitCode = 1;
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

program.command("doctor").description("check local OpenLoops runtime dependencies and state").action(() => {
  const store = new Store();
  try {
    const report = runDoctor(store);
    if (isJson()) print(report);
    else {
      for (const check of report.checks) {
        const marker = check.status === "ok" ? "ok" : check.status === "warn" ? "warn" : "fail";
        console.log(`${marker.padEnd(4)} ${check.id.padEnd(22)} ${check.message}${check.detail ? ` (${check.detail})` : ""}`);
      }
      if (!report.ok) process.exitCode = 1;
    }
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

daemon
  .command("install")
  .description("write a systemd user service or launchd plist")
  .option("--enable", "also enable/start the user service when supported")
  .action((opts) => {
    const result = installStartup(process.argv[1] ?? "loops");
    if (opts.enable) result.enableResults = enableStartup(result);
    const enableText = result.enableResults
      ? `\n${result.enableResults.map((item) => `${item.command} -> ${item.status === 0 ? "ok" : `exit ${item.status}`}`).join("\n")}`
      : "";
    print(result, `wrote ${result.path}\n${result.instructions.join("\n")}${enableText}`);
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
