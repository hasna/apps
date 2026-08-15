#!/usr/bin/env bun
import { DEFAULT_PORT } from "../paths.js";
import { startClipServer } from "./server.js";

interface ServerArgs {
  host: string;
  port: number;
  baseUrl?: string;
  authToken?: string;
  homeDir?: string;
  dbPath?: string;
  artifactDir?: string;
}

function valueAfter(args: string[], long: string): string | undefined {
  const index = args.indexOf(long);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseArgs(args = process.argv.slice(2)): ServerArgs {
  const host = valueAfter(args, "--host") ?? process.env["HOST"] ?? "127.0.0.1";
  const rawPort = valueAfter(args, "--port") ?? process.env["PORT"];
  const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_PORT;
  return {
    host,
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : DEFAULT_PORT,
    baseUrl: valueAfter(args, "--base-url") ?? process.env["CLIP_BASE_URL"],
    authToken: valueAfter(args, "--auth-token") ?? process.env["CLIP_AUTH_TOKEN"],
    homeDir: valueAfter(args, "--home"),
    dbPath: valueAfter(args, "--db"),
    artifactDir: valueAfter(args, "--artifact-dir"),
  };
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: clip-serve [options]

Options:
  --host <host>          Bind host (default HOST or 127.0.0.1)
  --port <port>          Bind port (default PORT or 3741)
  --base-url <url>       Public/self-hosted share URL base
  --auth-token <token>   Require Bearer token for mutating API routes (default CLIP_AUTH_TOKEN)
  --home <path>          Override local data directory
  --db <path>            Override SQLite database path
  --artifact-dir <path>  Override artifact directory`);
  process.exit(0);
}

const parsed = parseArgs();

const server = startClipServer({
  host: parsed.host,
  port: parsed.port,
  baseUrl: parsed.baseUrl,
  authToken: parsed.authToken,
  clientOptions: {
    homeDir: parsed.homeDir,
    dbPath: parsed.dbPath,
    artifactDir: parsed.artifactDir,
    baseUrl: parsed.baseUrl,
    host: parsed.host,
    port: parsed.port,
  },
  log: (message) => console.error(message),
});

console.error(`clip-serve ready at http://${parsed.host}:${server.port}`);
await new Promise<never>(() => {});
