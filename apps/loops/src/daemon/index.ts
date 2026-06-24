#!/usr/bin/env bun
import { Command } from "commander";
import { runDaemon, startDaemon } from "./daemon.js";
import { daemonStatus, stopDaemon } from "./control.js";
import { installStartup, type InstallStartupResult } from "./install.js";
import { Store } from "../lib/store.js";
import { packageVersion } from "../lib/version.js";
import { daemonStatusSummary } from "../lib/format.js";

const program = new Command();

program.name("loops-daemon").description("OpenLoops daemon helper").version(packageVersion());
program.option("-j, --json", "print JSON");
program.option("-v, --verbose", "show full detail output");

function isJson(): boolean {
  return Boolean(program.opts().json);
}

function isVerbose(): boolean {
  return Boolean(program.opts().verbose);
}

function printDetail(value: unknown, human: string): void {
  if (isJson() || isVerbose()) console.log(JSON.stringify(value, null, 2));
  else console.log(human);
}

function startSummary(result: Awaited<ReturnType<typeof startDaemon>>): string {
  const status = result.alreadyRunning ? "already running" : result.started ? "started" : "failed to start";
  return `${status}${result.pid ? ` pid=${result.pid}` : ""}\nUse --verbose or --json for full start result.`;
}

function stopSummary(result: Awaited<ReturnType<typeof stopDaemon>>): string {
  const status = result.stopped ? "stopped" : result.wasRunning ? "stop requested" : "not running";
  const forced = result.forced ? " forced=true" : "";
  return `${status}${result.pid ? ` pid=${result.pid}` : ""}${forced}\nUse --verbose or --json for full stop result.`;
}

function installSummary(result: InstallStartupResult): string {
  return [`wrote ${result.path} platform=${result.platform}`, ...result.instructions, "Use --verbose or --json for full install result."].join("\n");
}

program
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .option("--concurrency <n>", "maximum loop runs to execute concurrently", (value) => Number(value))
  .action(async (opts) => runDaemon({ intervalMs: opts.intervalMs, concurrency: opts.concurrency }));

program.command("start").action(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops-daemon", args: ["run"] });
  printDetail(result, startSummary(result));
});

program.command("stop").action(async () => {
  const result = await stopDaemon();
  printDetail(result, stopSummary(result));
});

program.command("status").action(() => {
  const store = new Store();
  try {
    const status = daemonStatus(store);
    printDetail(status, daemonStatusSummary(status));
  } finally {
    store.close();
  }
});

program.command("install").action(() => {
  const result = installStartup(process.argv[1] ?? "loops-daemon", process.execPath, ["run"]);
  printDetail(result, installSummary(result));
});

await program.parseAsync(process.argv);
