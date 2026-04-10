#!/usr/bin/env bun
import { Command } from "commander";
import { getPackageVersion } from "../version.js";
import { getAdapter } from "../db.js";
import { getAgentStatus, markOffline, writeHeartbeat } from "./runtime.js";

const program = new Command();

program
  .name("machines-agent")
  .description("Lightweight machine agent reporting local heartbeat and registry status")
  .version(getPackageVersion())
  .option("--once", "Write one heartbeat and exit", false)
  .option("--status", "Print current agent heartbeat rows and exit", false)
  .option("--offline", "Mark the current process offline and exit", false)
  .option("--interval-ms <ms>", "Heartbeat interval in milliseconds", "30000")
  .option("-j, --json", "Print JSON output", false);

const options = program.parse(process.argv).opts<{
  once: boolean;
  status: boolean;
  offline: boolean;
  intervalMs: string;
  json: boolean;
}>();
const intervalMs = Number.parseInt(options.intervalMs, 10);

async function tick(): Promise<void> {
  getAdapter();
  const payload = writeHeartbeat("online");
  console.log(JSON.stringify(payload));
}

if (options.status) {
  console.log(JSON.stringify(getAgentStatus(), null, options.json ? 2 : 0));
  process.exit(0);
}

if (options.offline) {
  console.log(JSON.stringify(markOffline(), null, options.json ? 2 : 0));
  process.exit(0);
}

await tick();

if (!options.once) {
  const timer = setInterval(() => {
    void tick();
  }, Number.isFinite(intervalMs) ? intervalMs : 30000);

  process.on("SIGINT", () => {
    clearInterval(timer);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(timer);
    process.exit(0);
  });
}
