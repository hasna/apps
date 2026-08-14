#!/usr/bin/env bun
import { Command } from "commander";
import { runDaemon, startDaemon } from "./daemon.js";
import { daemonStatus, stopDaemon } from "./control.js";
import { installStartup } from "./install.js";
import { Store } from "../lib/store.js";
import { packageVersion } from "../lib/version.js";

const program = new Command();

program.name("loops-daemon").description("Loops daemon helper").version(packageVersion());

program
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .option("--concurrency <n>", "legacy total knob; sets the agent/workflow lane budget", (value) => Number(value))
  .option("--command-concurrency <n>", "claim budget for command-target loops (default 4)", (value) => Number(value))
  .option("--agent-concurrency <n>", "claim budget for agent/workflow-target loops (default 8)", (value) => Number(value))
  .action(async (opts) =>
    runDaemon({
      intervalMs: opts.intervalMs,
      concurrency: opts.concurrency,
      commandConcurrency: opts.commandConcurrency,
      agentConcurrency: opts.agentConcurrency,
    }),
  );

program.command("start").action(async () => {
  const result = await startDaemon({ cliEntry: process.argv[1] ?? "loops-daemon", args: ["run"] });
  console.log(JSON.stringify(result, null, 2));
});

program.command("stop").action(async () => {
  console.log(JSON.stringify(await stopDaemon(), null, 2));
});

program.command("status").action(() => {
  const store = new Store();
  try {
    console.log(JSON.stringify(daemonStatus(store), null, 2));
  } finally {
    store.close();
  }
});

program.command("install").action(() => {
  console.log(JSON.stringify(installStartup(process.argv[1] ?? "loops-daemon", process.execPath, ["run"]), null, 2));
});

await program.parseAsync(process.argv);
