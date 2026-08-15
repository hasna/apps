#!/usr/bin/env bun
import { startServer } from "./serve.js";
import { getPackageVersion } from "../lib/package-version.js";

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
  // CONTACTS_HOST is the explicit control (the ARM64 container image sets it to
  // 0.0.0.0 so the ALB can reach the task). Local runs stay loopback-only.
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

/**
 * One-shot schema migration used by the ECS migration task and local dev.
 *   contacts-serve migrate
 * Applies the relational schema (PG_MIGRATIONS) + contracts api-keys table to
 * the cloud Postgres. Idempotent; never drops or clobbers existing tables.
 */
async function runMigrate(): Promise<void> {
  const { ensureCloudSchema, pingCloud, resolveCloudDatabaseUrl, closeCloud } = await import("./cloud.js");
  if (!resolveCloudDatabaseUrl()) {
    console.error("migrate: no database URL (HASNA_CONTACTS_DATABASE_URL / CONTACTS_DATABASE_URL / DATABASE_URL)");
    process.exit(2);
  }
  console.log("migrate: connecting…");
  await pingCloud();
  console.log("migrate: applying schema (contacts relational schema + api_keys)…");
  await ensureCloudSchema();
  console.log("migrate: done");
  await closeCloud();
  process.exit(0);
}

async function main() {
  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }

  const hostname = parseHost();
  // When PORT env or --port is set (container/service deployment) bind it
  // EXACTLY — never scan for a free port, or the ALB health check would target
  // the wrong port.
  const explicitPortArg = process.argv.some((a) => a === "--port" || a.startsWith("--port="));
  const envPort = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;
  const requested = explicitPortArg ? parsePort() : (envPort ?? parsePort());
  const port = envPort || explicitPortArg ? requested : await findFreePort(requested, hostname);
  if (port !== requested) {
    console.log(`Port ${requested} in use, using ${port}`);
  }
  startServer(port, { hostname });
}

main();
