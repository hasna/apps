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
 *
 * Why a dedicated entry file rather than one entry that sniffs the name it was
 * invoked under: bun installs bins as symlinks and resolves them before
 * `process.argv` is populated, so both names yield an identical argv. The
 * invoked name is not lost everywhere — on Linux `/proc/self/cmdline` still
 * retains it — but `/proc` does not exist on macOS, so recovering the name is a
 * *portability* problem rather than an impossibility. A separate entry avoids
 * the question entirely and behaves identically on every platform.
 *
 * The shim is bundled rather than transpile-only because transpile-only strips
 * the shebang, which a bin symlink requires.
 */
process.stderr.write(
  "uptime is renamed to uptimemon; the 'uptime' name will stop shadowing the system command in a future release\n",
);

await import("./index.js");

// Marks this file as a module so the top-level `await` above is legal under tsc
// (TS1375); the dynamic import alone does not make it one.
export {};
