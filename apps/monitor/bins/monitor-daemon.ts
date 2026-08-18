#!/usr/bin/env bun
/**
 * monitor-daemon — execution daemon entry point.
 *
 * MON-V2-14 creates this bin so the contract-declared daemon surface
 * (hasna.contract.json serviceSurfaces.daemon, kind cli) is real and
 * validated end to end. MON-V2-04 lands the scheduler/worker implementation
 * that this entry drives; until then the entry is honest about its scope:
 * version and usage only, and a clear refusal for anything else.
 */
import { MONITOR_VERSION } from "../src/version.js";

const USAGE = `Usage: monitor-daemon [--version|--help]

Execution daemon for monitor slug runs. The scheduler/worker implementation
lands with MON-V2-04; this entry currently answers --version and --help only.`;

const arg = process.argv[2];

if (arg === "--version" || arg === "-v") {
  console.log(MONITOR_VERSION);
  process.exit(0);
}

if (arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(0);
}

console.error(`monitor-daemon: unknown argument ${JSON.stringify(arg ?? "(none)")}`);
console.error(USAGE);
process.exit(1);
