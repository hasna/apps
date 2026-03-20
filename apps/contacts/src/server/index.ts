#!/usr/bin/env bun
import { startServer } from "./serve.js";

const DEFAULT_PORT = 19428;

function parsePort(): number {
  const portArg = process.argv.find(
    (a) => a === "--port" || a.startsWith("--port=")
  );
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
      // port in use, try next
    }
  }
  return start;
}

async function main() {
  const requested = parsePort();
  const port = await findFreePort(requested);
  if (port !== requested) {
    console.log(`Port ${requested} in use, using ${port}`);
  }
  startServer(port);
}

main();
