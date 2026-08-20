#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { createChangelogHandler, type ChangelogApiOptions } from "../api.js";

export interface StartChangelogServerOptions extends ChangelogApiOptions {
  host?: string;
  port?: number;
}

export function startChangelogServer(options: StartChangelogServerOptions = {}): ReturnType<typeof Bun.serve> {
  const host = options.host ?? process.env["CHANGELOG_HOST"] ?? "127.0.0.1";
  const port = options.port ?? resolveServerPort(process.env["CHANGELOG_PORT"]);
  const handler = createChangelogHandler(options);
  return Bun.serve({
    hostname: host,
    port,
    fetch: handler,
  });
}

/**
 * Resolve the CHANGELOG_PORT env value. Unset -> the documented default 8788;
 * a set-but-non-numeric string (including an empty string) -> 0, which
 * Bun.serve turns into an ephemeral port; a valid numeric string -> the parsed
 * number. Never returns NaN, which Bun.serve rejects with ERR_OUT_OF_RANGE on
 * current Bun versions.
 */
export function resolveServerPort(raw: string | undefined): number {
  if (raw === undefined) return 8788;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
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
  console.log(`Hasna Changelog API listening on http://${server.hostname}:${server.port}`);
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
