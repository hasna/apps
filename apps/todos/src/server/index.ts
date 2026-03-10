#!/usr/bin/env bun
/**
 * Standalone entry point for the todos dashboard server.
 * Usage: todos-serve [--port 19427]
 *
 * If the default port is in use, automatically finds the next free port.
 */

import { startServer } from "./serve.js";

const DEFAULT_PORT = 19427;

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

async function main() {
  const requestedPort = parsePort();
  const port = await findFreePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} in use, using ${port}`);
  }
  startServer(port);
}

main();
