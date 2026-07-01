#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { createChangelogHandler, type ChangelogApiOptions } from "../api.js";

export interface StartChangelogServerOptions extends ChangelogApiOptions {
  host?: string;
  port?: number;
}

export function startChangelogServer(options: StartChangelogServerOptions = {}): ReturnType<typeof Bun.serve> {
  const host = options.host ?? process.env["CHANGELOG_HOST"] ?? "127.0.0.1";
  const port = options.port ?? Number.parseInt(process.env["CHANGELOG_PORT"] ?? "8788", 10);
  const handler = createChangelogHandler(options);
  return Bun.serve({
    hostname: host,
    port,
    fetch: handler,
  });
}

function printHelp(): void {
  console.log(`Usage: changelog-serve [options]

Options:
  --host <host>   Host to bind (default: 127.0.0.1)
  --port <port>   Port to bind (default: 8788)
  -h, --help      Display help`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const parsed = parseArgs({
    args,
    options: {
      host: { type: "string" },
      port: { type: "string" },
    },
    allowPositionals: false,
  });
  const server = startChangelogServer({
    host: parsed.values.host,
    port: parsed.values.port ? Number.parseInt(parsed.values.port, 10) : undefined,
  });
  console.log(`Open Changelog API listening on http://${server.hostname}:${server.port}`);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/server/index.ts") ||
  process.argv[1]?.endsWith("/server/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

