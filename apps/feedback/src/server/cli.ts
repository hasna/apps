#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { startFeedbackServer } from "./index.js";
import { VERSION } from "../version.js";
import { emitDeprecationNotice } from "./deprecation.js";

function printHelp(): void {
  console.log(`Usage: feedback-serve [options]

Options:
  --host <host>   Host to bind (default: 127.0.0.1)
  --port <port>   Port to bind (default: 8787)
  -V, --version   Display version
  -h, --help      Display help`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  // Emitted on every path, including --help and --version, so that any caller
  // touching this bin learns it is going away. stderr only — stdout stays
  // byte-for-byte what it was, so scripted callers are unaffected.
  emitDeprecationNotice();

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }
  const parsed = parseArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      version: { type: "boolean", short: "V" },
    },
    allowPositionals: false,
  });
  const server = startFeedbackServer({
    host: parsed.values.host,
    port: parsed.values.port ? Number.parseInt(parsed.values.port, 10) : undefined,
  });
  console.log(`Hasna Feedback API listening on http://${server.hostname}:${server.port}`);
}

// Only run when invoked as the bin. Without this guard, importing this module —
// which the deprecation tests must do — starts a real server on a real port.
// Mirrors the same guard in src/cli/index.ts.
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/server/cli.ts") ||
  process.argv[1]?.endsWith("/server/cli.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
