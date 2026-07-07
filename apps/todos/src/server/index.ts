#!/usr/bin/env bun
/**
 * Standalone entry point for the todos dashboard server.
 * Usage: todos-serve [--port 19427]
 *
 * If the default port is in use, automatically finds the next free port.
 */

import { getPackageVersion } from "../lib/package-version.js";

const DEFAULT_PORT = 19427;

function hasVersionFlag(): boolean {
  return process.argv.includes("--version") || process.argv.includes("-V");
}

function hasHelpFlag(): boolean {
  return process.argv.includes("--help") || process.argv.includes("-h");
}

function printHelp(): void {
  console.log(`Usage: todos-serve [options]

Start the @hasna/todos dashboard server.

Options:
  --port <port>     HTTP port to bind. Defaults to ${DEFAULT_PORT}
  --host <host>     Hostname to bind. Defaults to 127.0.0.1
  --api-key <key>   Require this API key for dashboard/API requests
  --no-open         Do not open the dashboard in a browser
  -V, --version     output the version number
  -h, --help        display help for command

Environment:
  TODOS_NO_OPEN=true       Do not open the dashboard in a browser
  TODOS_API_KEY=<key>      Require this API key for dashboard/API requests`);
}

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    if (portArg.includes("=")) {
      return parseInt(portArg.split("=")[1]!, 10) || DEFAULT_PORT;
    }
    const idx = process.argv.indexOf(portArg);
    return parseInt(process.argv[idx + 1]!, 10) || DEFAULT_PORT;
  }
  return DEFAULT_PORT;
}

function parseStringArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!arg) return undefined;
  if (arg.includes("=")) return arg.split("=")[1] || undefined;
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] || undefined;
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ port, fetch: () => new Response("") });
      server.stop(true);
      return port;
    } catch {
      // Port in use, try next
    }
  }
  return start; // fallback
}

async function runMigrate(): Promise<void> {
  const { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } = await import("./cloud.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_TODOS_DATABASE_URL / TODOS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (sync tables + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

async function main() {
  // One-shot schema migration (used by the ECS migration task):
  //   todos-serve migrate
  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  if (hasVersionFlag()) {
    console.log(getPackageVersion());
    return;
  }
  if (hasHelpFlag()) {
    printHelp();
    return;
  }
  // When PORT is set (container/service deployment) bind it EXACTLY — never scan
  // for a free port, or the ALB health check would target the wrong port.
  const explicitPortArg = process.argv.some((a) => a === "--port" || a.startsWith("--port="));
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const requestedPort = explicitPortArg ? parsePort() : (envPort ?? parsePort());
  const port = envPort || explicitPortArg ? requestedPort : await findFreePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} in use, using ${port}`);
  }
  const noOpen = process.argv.includes("--no-open") || process.env["TODOS_NO_OPEN"] === "true" || Boolean(envPort);
  const { startServer } = await import("./serve.js");
  startServer(port, {
    open: !noOpen,
    host: parseStringArg("--host") || process.env.HOST,
    apiKey: parseStringArg("--api-key"),
  });
}

main();
