#!/usr/bin/env bun
import { getPackageVersion } from "../lib/package-version.js";
import { exactMetadataInvocation, hasMixedMetadataFlag } from "../cli/exact-argv.js";
import { parsePositiveSafeInteger } from "../lib/positive-safe-integer.js";
import {
  assertTodosLocalStorageRole,
  TodosHostedStorageUnavailableError,
  type TodosStorageEnv,
} from "../storage/config.js";

export interface BuildMcpServerOptions {
  environment?: TodosStorageEnv;
}

function loadRuntime(): typeof import("./runtime.js") {
  assertTodosLocalStorageRole(process.env);
  // Keep the specifier runtime-derived so Bun does not fold the heavy graph
  // back into the dependency-light bootstrap during the package build. The
  // build emits runtime.js beside this file; direct source execution resolves
  // runtime.ts instead.
  const runtimeSpecifier = import.meta.url.endsWith(".ts") ? "./runtime.ts" : "./runtime.js";
  return require(runtimeSpecifier) as typeof import("./runtime.js");
}

function readEnvironment(options: BuildMcpServerOptions): TodosStorageEnv | undefined {
  try {
    const environment = Reflect.get(options, "environment") as unknown;
    if (environment !== undefined && (environment === null || typeof environment !== "object")) {
      throw new TodosHostedStorageUnavailableError("unreadable_options");
    }
    return environment as TodosStorageEnv | undefined;
  } catch (error) {
    if (error instanceof TodosHostedStorageUnavailableError) throw error;
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
}

export function buildServer(options: BuildMcpServerOptions = {}): ReturnType<typeof import("./runtime.js")["buildServer"]> {
  // The real process role is authoritative and must precede caller getters and
  // the runtime graph containing transports, tools, database modules, and SQLite.
  assertTodosLocalStorageRole(process.env);
  const environment = readEnvironment(options);
  assertTodosLocalStorageRole(environment ?? process.env);
  return loadRuntime().buildServer(options);
}

export function applyFocus(params: Record<string, any>, agentId?: string): void {
  // Preserve the base synchronous signature while keeping the focus/database
  // graph behind proven process-local authority and before param getters.
  assertTodosLocalStorageRole(process.env);
  return loadRuntime().applyFocus(params, agentId);
}

function isExactMcpStartupInvocation(args: readonly string[]): boolean {
  if (args.length === 0) return true;
  if (hasMixedMetadataFlag(args)) return false;
  if (args.length === 1) {
    if (args[0] === "--stdio" || args[0] === "--http") return true;
    if (args[0]!.startsWith("--port=")) {
      try {
        parsePositiveSafeInteger(args[0]!.slice("--port=".length), "--port");
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
  const portIndex = args.indexOf("--port");
  if (portIndex !== -1) {
    const value = args[portIndex + 1];
    if (value === undefined) return false;
    try {
      parsePositiveSafeInteger(value, "--port");
    } catch {
      return false;
    }
    const remaining = args.filter((_arg, index) => index !== portIndex && index !== portIndex + 1);
    return remaining.length === 0 || (remaining.length === 1 && remaining[0] === "--http");
  }
  return false;
}

function printHelp(): void {
  console.log(`Usage: todos-mcp [options]

Start the @hasna/todos MCP server.

Options:
  --stdio          Use stdio transport (default)
  --http           Use Streamable HTTP transport
  --port <port>    Use Streamable HTTP on the given port (implies --http)
  -V, --version    output the version number
  -h, --help       display help for command

Environment:
  MCP_STDIO=1                Force stdio transport
  MCP_HTTP=1                 Use Streamable HTTP transport
  MCP_HTTP_PORT=<port>       HTTP port when using HTTP transport
  TODOS_PROFILE=<profile>    Tool profile filter
  TODOS_TOOL_GROUPS=<list>   Comma-separated tool group filter`);
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
  if (!isExactMcpStartupInvocation(args)) {
    throw new TodosHostedStorageUnavailableError("authority_resolver_unavailable");
  }
  assertTodosLocalStorageRole(process.env);
  await loadRuntime().runMcpServer();
}

const isDirectRun = import.meta.main
  || process.argv[1]?.endsWith("/mcp/index.ts")
  || process.argv[1]?.endsWith("/mcp/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
