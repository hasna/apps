#!/usr/bin/env bun
/**
 * machines-serve — standalone HTTP control-plane API for the machine registry.
 *
 * Usage: machines-serve [--port 8080] [--host 0.0.0.0]
 * Env:   PORT, HOST, HASNA_MACHINES_STORAGE_MODE=cloud, HASNA_MACHINES_DATABASE_URL,
 *        HASNA_MACHINES_API_SIGNING_KEY (or API_KEY_SIGNING_SECRET).
 */

import { getPackageVersion } from "../version.js";

function argValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a === name || a.startsWith(`${name}=`));
  if (!arg) return undefined;
  if (arg.includes("=")) return arg.split("=")[1] || undefined;
  const idx = process.argv.indexOf(arg);
  return process.argv[idx + 1] || undefined;
}

function main(): void {
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: machines-serve [options]

Start the @hasna/machines control-plane HTTP API.

Options:
  --port <port>   HTTP port to bind. Default 8080 (or $PORT)
  --host <host>   Host to bind.      Default 0.0.0.0 (or $HOST)
  -V, --version   print the version
  -h, --help      show this help

Environment:
  HASNA_MACHINES_STORAGE_MODE=cloud
  HASNA_MACHINES_DATABASE_URL=<app-role DSN>
  HASNA_MACHINES_API_SIGNING_KEY=<hmac signing secret>`);
    return;
  }

  const portArg = argValue("--port");
  const hostArg = argValue("--host");

  // Lazy import so --version/--help never require DB/signing env.
  import("./serve.js").then(({ startServer }) => {
    const server = startServer({
      ...(portArg ? { port: Number(portArg) } : {}),
      ...(hostArg ? { host: hostArg } : {}),
    });
    console.log(JSON.stringify({ evt: "listening", url: server.url, version: getPackageVersion() }));
  }).catch((error) => {
    console.error(`machines-serve failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

main();
