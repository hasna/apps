#!/usr/bin/env bun
/**
 * Transition entry point for the retired `uptime` bin name.
 *
 * `@hasna/uptime` historically installed a bin called `uptime`, which shadows
 * `/usr/bin/uptime` (procps) on PATH. The monitor-management CLI is now called
 * `uptimemon`; this shim keeps the old name working for one transition release.
 *
 * It prints a single deprecation line to **stderr** — never stdout — so that
 * `--json` output stays machine-parseable, and then runs the real CLI
 * unchanged. A deprecation notice that breaks the command is not a transition.
 */
process.stderr.write(
  "uptime is renamed to uptimemon; the 'uptime' name will stop shadowing the system command in a future release\n",
);

await import("./index.js");

// Marks this file as a module so the top-level `await` above is legal under tsc
// (TS1375); the dynamic import alone does not make it one.
export {};
