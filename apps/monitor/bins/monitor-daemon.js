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

// The exact supported invocation is a single flag: `--version`/`-v` or
// `--help`/`-h`. Anything else — including trailing arguments after a valid
// flag, and zero arguments — is refused rather than silently accepted.
const args = process.argv.slice(2);

if (args.length !== 1) {
  console.error(
    `monitor-daemon: expected exactly one argument (--version | --help), got ${args.length}: ${JSON.stringify(args)}`
  );
  console.error(USAGE);
  process.exit(1);
}

const arg = args[0];

if (arg === "--version" || arg === "-v") {
  console.log(MONITOR_VERSION);
  process.exit(0);
}

if (arg === "--help" || arg === "-h") {
  console.log(USAGE);
  process.exit(0);
}

console.error(`monitor-daemon: unknown argument ${JSON.stringify(arg)}`);
console.error(USAGE);
process.exit(1);
