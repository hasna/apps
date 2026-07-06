#!/usr/bin/env bun
import { startServer } from "./serve.js";

const DEFAULT_PORT = 19428;
const DEFAULT_HOST = "127.0.0.1";

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

function parseHost(): string {
  const hostArg = process.argv.find(
    (a) => a === "--host" || a.startsWith("--host=")
  );
  if (hostArg) {
    if (hostArg.includes("=")) {
      return hostArg.split("=")[1] || DEFAULT_HOST;
    }
    const idx = process.argv.indexOf(hostArg);
    return process.argv[idx + 1] || DEFAULT_HOST;
  }
  return process.env["CONTACTS_HOST"] || DEFAULT_HOST;
}

async function findFreePort(start: number, hostname: string): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    try {
      const server = Bun.serve({ hostname, port, fetch: () => new Response("") });
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
  const hostname = parseHost();
  const port = await findFreePort(requested, hostname);
  if (port !== requested) {
    console.log(`Port ${requested} in use, using ${port}`);
  }
  startServer(port, { hostname });
}

main();
