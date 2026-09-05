#!/usr/bin/env bun
/**
 * @hasna/dispatch daemon entrypoint. Owns the scheduled-dispatch queue and
 * fires due dispatches on an interval. Usually launched via
 * `dispatch daemon start`; can also be run directly as `dispatch-daemon`.
 */
import { getPackageVersion } from "../lib/version.js";
import { runDaemon } from "./daemon.js";

function intervalFromEnv(): number | undefined {
  const raw = process.env.DISPATCH_DAEMON_INTERVAL_MS;
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function printHelp(): void {
  console.log(`Usage: dispatch-daemon [options]

Daemon for @hasna/dispatch: owns the scheduled-dispatch queue and fires due
dispatches on an interval. Usually launched via \`dispatch daemon start\`.

Options:
  -V, --version  output the version number
  -h, --help     display help for command

Environment:
  DISPATCH_DATA_DIR            data directory (default: the dispatch data root, resolved
                               through @hasna/paths to the XDG data home once the store
                               is migrated there or HASNA_DATA_HOME is set)
  DISPATCH_DAEMON_INTERVAL_MS  tick interval in milliseconds (default: 1000)`);
}

if (import.meta.main) {
  // Binds-before-version class (todos row 8a43ca44): --help/--version must
  // answer BEFORE runDaemon() claims the pid. They previously fell through to
  // claimPid, which threw "daemon already running (pid N)" wherever a daemon
  // was live — and started a real daemon on a free machine.
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    console.log(getPackageVersion());
    process.exit(0);
  }
  runDaemon({ intervalMs: intervalFromEnv() }).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export { runDaemon, startDaemon } from "./daemon.js";
