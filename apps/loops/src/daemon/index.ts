#!/usr/bin/env bun
import { Command } from "commander";
import { runDaemon, startDaemon } from "./daemon.js";
import { daemonStatus, stopDaemon } from "./control.js";
import { installStartup } from "./install.js";
import { Store } from "../lib/store.js";

const program = new Command();

program.name("loops-daemon").description("OpenLoops daemon helper").version("0.3.1");

program
  .command("run")
  .option("--interval-ms <ms>", "tick interval", (value) => Number(value))
  .action(async (opts) => runDaemon({ intervalMs: opts.intervalMs }));

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
