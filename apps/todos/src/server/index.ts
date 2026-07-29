#!/usr/bin/env bun
/**
 * Standalone entry point for the todos dashboard server.
 * Usage: todos-serve [--port 19427]
 *
 * If the default port is in use, automatically finds the next free port.
 */

import { getPackageVersion } from "../lib/package-version.js";
import { DEFAULT_PORT, coercePort, findFreePort, refuseInvalidPort } from "./port.js";
import { resolveTodosAuthority } from "../authority.js";

function hasVersionFlag(): boolean {
  return process.argv.includes("--version") || process.argv.includes("-V");
}

function hasHelpFlag(): boolean {
  return process.argv.includes("--help") || process.argv.includes("-h");
}

function printHelp(): void {
  console.log(`Usage: todos-serve [options]

Start the @hasna/todos dashboard server.

Commands:
  migrate                 Apply idempotent schema migrations

Options:
  --port <port>     HTTP port to bind. Defaults to ${DEFAULT_PORT}
  --host <host>     Hostname to bind. Defaults to 127.0.0.1
  --api-key <key>   Require this API key for dashboard/API requests
  --no-open         Do not open the dashboard in a browser
  -V, --version     output the version number
  -h, --help        display help for command

Environment:
  HASNA_TODOS_NO_OPEN=true  Do not open the dashboard in a browser
  HASNA_TODOS_API_KEY=<key> Require this API key for dashboard/API requests`);
}

function parsePort(): number {
  const portArg = process.argv.find((a) => a === "--port" || a.startsWith("--port="));
  if (portArg) {
    const raw = portArg.includes("=")
      ? portArg.split("=")[1]
      : process.argv[process.argv.indexOf(portArg) + 1];
    // An explicit --port that cannot be a port is refused rather than quietly
    // replaced by the default, which would start the server somewhere the
    // operator did not ask for and say nothing.
    return coercePort(raw) ?? refuseInvalidPort("--port", raw ?? "");
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


async function runMigrate(): Promise<void> {
  const { ensureLocalAuthoritySchema, pingLocalAuthority, closeLocalAuthority } =
    await import("./local-authority.js");
  console.log("migrate: validating customer authority…");
  await pingLocalAuthority();
  await ensureLocalAuthoritySchema();
  console.log("migrate: done");
  await closeLocalAuthority();
  process.exit(0);
}

async function main() {
  if (hasVersionFlag()) {
    console.log(getPackageVersion());
    return;
  }
  if (hasHelpFlag()) {
    printHelp();
    return;
  }
  const authority = resolveTodosAuthority();
  if (authority.mode !== "local") {
    throw new Error("TODOS_AUTHORITY_MISMATCH: todos-serve is a customer-operated local authority; cloud is client-only");
  }

  if (process.argv.includes("migrate")) {
    await runMigrate();
    return;
  }
  // When PORT is set (container/service deployment) bind it EXACTLY — never scan
  // for a free port, or the ALB health check would target the wrong port.
  const explicitPortArg = process.argv.some((a) => a === "--port" || a.startsWith("--port="));
  // An empty PORT is treated as unset, which is how containers and shells
  // routinely express "no value". A non-empty PORT that is not a port is refused,
  // for the same reason an explicit --port is.
  const rawEnvPort = process.env.PORT?.trim();
  const envPort = rawEnvPort
    ? coercePort(rawEnvPort) ?? refuseInvalidPort("PORT", rawEnvPort)
    : undefined;
  const requestedPort = explicitPortArg ? parsePort() : (envPort ?? parsePort());
  // An explicitly requested port (including 0 = "kernel, pick one") is bound as
  // asked. Only the implicit default may scan for a free port.
  const port = envPort !== undefined || explicitPortArg ? requestedPort : await findFreePort(requestedPort);
  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} in use, using ${port}`);
  }
  const noOpen = process.argv.includes("--no-open") || process.env["HASNA_TODOS_NO_OPEN"] === "true" || Boolean(envPort);
  const { startServer } = await import("./serve.js");
  try {
    await startServer(port, {
      open: !noOpen,
      host: parseStringArg("--host") || process.env.HOST,
      apiKey: parseStringArg("--api-key"),
      allowAnonymous: process.argv.includes("--allow-anonymous"),
    });
  } catch (error) {
    // Fail closed and LOUD: never fall back to serving data anonymously.
    const { AuthNotConfiguredError } = await import("./auth-posture.js");
    if (error instanceof AuthNotConfiguredError) {
      console.error(`\n${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

main();
