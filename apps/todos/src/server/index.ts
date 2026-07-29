#!/usr/bin/env bun
import { getPackageVersion } from "../lib/package-version.js";
import { getTodosMode } from "../runtime-mode.js";
import { DEFAULT_PORT, coercePort, refuseInvalidPort } from "./port.js";

function argument(name: string): string | undefined {
  const index = process.argv.findIndex((item) => item === name || item.startsWith(`${name}=`));
  if (index < 0) return undefined;
  const token = process.argv[index]!;
  return token.includes("=") ? token.slice(token.indexOf("=") + 1) : process.argv[index + 1];
}

async function main(): Promise<void> {
  getTodosMode();
  if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(getPackageVersion());
    return;
  }
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: todos-serve [options]

Start the headless /v1 Todos API.

Options:
  --port <port>  Port to bind (default: ${DEFAULT_PORT})
  --host <host>  Address to bind (default: 127.0.0.1)
  -V, --version  Print the version
  -h, --help     Print this help

Environment:
  HASNA_TODOS_MODE=local|cloud`);
    return;
  }

  const rawPort = argument("--port") ?? process.env.PORT?.trim();
  const port = rawPort === undefined ? DEFAULT_PORT : coercePort(rawPort) ?? refuseInvalidPort("port", rawPort);
  const { startServer } = await import("./serve.js");
  await startServer(port, { host: argument("--host") });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
