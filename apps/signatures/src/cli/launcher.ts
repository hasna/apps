#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const forwardedSignals: NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
  "SIGQUIT",
];

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.js");
const child = spawn("bun", [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
});
let childExited = false;

for (const signal of forwardedSignals) {
  process.on(signal, () => {
    if (!childExited) child.kill(signal);
  });
}

// The launcher may be killed directly by PID (timeout, docker stop, systemd),
// which never reaches the CLI. Never leave the Bun process orphaned.
process.on("exit", () => {
  if (!childExited) child.kill("SIGKILL");
});

child.on("error", (error) => {
  childExited = true;
  console.error(`Failed to start open-signatures with Bun: ${error.message}`);
  process.exit(1);
});

child.on("exit", (status, signal) => {
  childExited = true;
  if (signal) {
    // Removing the forwarding listeners restores the default disposition, so
    // re-raising reports the CLI's signal death to our own caller.
    process.removeAllListeners(signal);
    process.kill(process.pid, signal);
    return;
  }
  process.exit(status ?? 1);
});
