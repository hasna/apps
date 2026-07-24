#!/usr/bin/env bun
/** Dependency-light, exact-argv todos-serve bootstrap. */

import { exactMetadataInvocation, hasMixedMetadataFlag } from "../cli/exact-argv.js";
import {
  exitWithTodosCliStageAError,
  todosCliStageAErrorPayload,
} from "../cli/stage-a.js";
import { getPackageVersion } from "../lib/package-version.js";
import { parsePositiveSafeInteger } from "../lib/positive-safe-integer.js";
import { assertTodosStageARemoteAccessFloor } from "../storage/authority-floor.js";
import {
  assertTodosLocalStorageRole,
  snapshotTodosStorageEnvironment,
  type TodosStorageEnv,
} from "../storage/config.js";

const DEFAULT_PORT = 19427;
const VALUE_OPTIONS = new Set(["--port", "--host", "--api-key"]);
const FLAG_OPTIONS = new Set(["--no-open"]);
const OPERATOR_COMMANDS = new Set(["migrate", "redact-comments"]);

function enforceStageAOperatorFloor(): never {
  return assertTodosStageARemoteAccessFloor();
}

function printHelp(): void {
  console.log(`Usage: todos-serve [options]

Start the @hasna/todos local dashboard server.

Commands:
  migrate                 Stage B deferred; unavailable in Stage A
  redact-comments         Stage B deferred; unavailable in Stage A

Options:
  --port <port>     HTTP port to bind. Defaults to ${DEFAULT_PORT}
  --host <host>     Hostname to bind. Defaults to 127.0.0.1
  --api-key <key>   Require this API key for dashboard/API requests
  --no-open         Do not open the dashboard in a browser
  -V, --version     output the version number
  -h, --help        display help for command`);
}

function validStartupGrammar(args: readonly string[]): boolean {
  if (hasMixedMetadataFlag(args)) return false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]!;
    if (FLAG_OPTIONS.has(token)) {
      if (seen.has(token)) return false;
      seen.add(token);
      continue;
    }
    const assignment = [...VALUE_OPTIONS].find((option) => token.startsWith(`${option}=`));
    if (assignment) {
      if (seen.has(assignment) || token.length === assignment.length + 1) return false;
      seen.add(assignment);
      continue;
    }
    if (VALUE_OPTIONS.has(token)) {
      const value = args[index + 1];
      if (seen.has(token) || value === undefined || value.startsWith("-")) return false;
      seen.add(token);
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function readValue(args: readonly string[], name: string): string | undefined {
  const assignment = args.find((arg) => arg.startsWith(`${name}=`));
  if (assignment) return assignment.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function findFreePort(start: number, environment: TodosStorageEnv): Promise<number> {
  for (let port = start; port < start + 100; port += 1) {
    // Keep authority outside the port-in-use catch: denial is not availability.
    assertTodosLocalStorageRole(process.env);
    assertTodosLocalStorageRole(environment);
    try {
      const probe = Bun.serve({ port, hostname: "127.0.0.1", fetch: () => new Response("") });
      probe.stop(true);
      return port;
    } catch {
      // Authorized local-only probing may continue to the next port.
    }
  }
  return start;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const metadata = exactMetadataInvocation(args);
  if (metadata === "version") {
    console.log(getPackageVersion(import.meta.url));
    return;
  }
  if (metadata === "help") {
    printHelp();
    return;
  }

  if (OPERATOR_COMMANDS.has(args[0] ?? "")) enforceStageAOperatorFloor();
  if (!validStartupGrammar(args)) enforceStageAOperatorFloor();

  // This is deliberately before port/env parsing, probing, imports, CORS/rate
  // setup, socket activity, and every possible Bun.serve call.
  assertTodosLocalStorageRole(process.env);
  const environment = snapshotTodosStorageEnvironment(process.env);

  const rawPort = readValue(args, "--port");
  const rawEnvironmentPort = environment.PORT;
  const explicitPort = rawPort === undefined ? undefined : parsePositiveSafeInteger(rawPort, "--port");
  const environmentPort = rawEnvironmentPort === undefined
    ? undefined
    : parsePositiveSafeInteger(rawEnvironmentPort, "PORT");
  const requestedPort = explicitPort ?? environmentPort ?? DEFAULT_PORT;
  const port = explicitPort !== undefined || environmentPort !== undefined
    ? requestedPort
    : await findFreePort(requestedPort, environment);
  const noOpen = args.includes("--no-open")
    || environment.TODOS_NO_OPEN === "true"
    || environmentPort !== undefined;
  const { startServer } = await import("./serve.js");
  await startServer(port, {
    open: !noOpen,
    host: readValue(args, "--host") ?? environment.HOST,
    apiKey: readValue(args, "--api-key"),
    environment,
  });
}

void main().catch((error) => {
  if (todosCliStageAErrorPayload(error)) exitWithTodosCliStageAError(error);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
