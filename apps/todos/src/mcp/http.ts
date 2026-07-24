import { containHostedDatastoreSurface } from "../server/hosted-authority.js";
import {
  assertTodosLocalStorageRole,
  readStageADataProperty,
  resolveTodosStorageRole,
  snapshotTodosStorageEnvironment,
  TodosHostedStorageUnavailableError,
} from "../storage/config.js";
import { parsePositiveSafeInteger } from "../lib/positive-safe-integer.js";

type McpServer = import("@modelcontextprotocol/sdk/server/mcp.js").McpServer;

export const DEFAULT_MCP_HTTP_PORT = 8881;
export const MCP_HTTP_NAME = "todos";

export function isHttpMode(): boolean {
  return process.argv.includes("--http") || process.env["MCP_HTTP"] === "1";
}

export function isStdioMode(): boolean {
  return process.argv.includes("--stdio") || process.env["MCP_STDIO"] === "1";
}

export function resolveHttpPort(defaultPort = DEFAULT_MCP_HTTP_PORT): number {
  const portFlag = process.argv.find((arg) => arg === "--port" || arg.startsWith("--port="));
  if (portFlag) {
    if (portFlag.includes("=")) {
      return parsePositiveSafeInteger(portFlag.split("=")[1] ?? "", "--port");
    } else {
      const idx = process.argv.indexOf(portFlag);
      return parsePositiveSafeInteger(process.argv[idx + 1] ?? "", "--port");
    }
  }

  const rawEnvPort = process.env["MCP_HTTP_PORT"];
  if (rawEnvPort !== undefined) return parsePositiveSafeInteger(rawEnvPort, "MCP_HTTP_PORT");

  return defaultPort;
}

export function healthResponse(name = MCP_HTTP_NAME): Response {
  return Response.json({ status: "ok", name });
}

export function readinessResponse(
  name = MCP_HTTP_NAME,
  environment: NodeJS.ProcessEnv = process.env,
): Response {
  let role: ReturnType<typeof resolveTodosStorageRole>;
  try {
    const processRole = resolveTodosStorageRole(process.env);
    role = processRole.role === "local" && environment !== process.env
      ? resolveTodosStorageRole(environment)
      : processRole;
  } catch {
    role = { role: "invalid", mode: null, source: "environment", reason: "invalid_mode" };
  }
  if (role.role === "local") {
    return Response.json({ status: "ready", name, mode: "local" });
  }
  return Response.json(
    { status: "unavailable", name, mode: "remote", code: "HOSTED_AUTHORITY_UNAVAILABLE" },
    { status: 503 },
  );
}

export async function handleMcpHttpRequest(
  req: Request,
): Promise<Response> {
  return handleMcpHttpRequestWithRuntime(req, undefined, process.env);
}

/** Module-private server injection path; the public declaration remains arity one. */
async function handleMcpHttpRequestWithRuntime(
  req: Request,
  createServer: (() => McpServer) | undefined,
  environment: NodeJS.ProcessEnv,
): Promise<Response> {
  const containment = await containHostedDatastoreSurface(req, environment);
  if (containment) return containment;
  const { WebStandardStreamableHTTPServerTransport } = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createServer
    ? createServer()
    : (await import("./index.js")).buildServer({ environment });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function startHttpServer(
  port: number,
  options?: { createServer?: () => McpServer; name?: string; environment?: NodeJS.ProcessEnv },
): Promise<ReturnType<typeof Bun.serve>> {
  const { name, environment, createServer } = resolveStartHttpServerOptions(options);

  assertTodosLocalStorageRole(process.env);
  assertTodosLocalStorageRole(environment);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(req) {
      const containment = await containHostedDatastoreSurface(req, environment);
      if (containment) return containment;
      const url = new URL(req.url);
      if (url.pathname === "/health" && req.method === "GET") {
        return healthResponse(name);
      }
      if (url.pathname === "/ready" && req.method === "GET") {
        return readinessResponse(name, environment);
      }
      if (url.pathname === "/mcp") {
        return handleMcpHttpRequestWithRuntime(req, createServer, environment);
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.error(`todos-mcp HTTP listening on http://127.0.0.1:${port}/mcp`);
  return server;
}

interface StartMcpHttpServerOptions {
  createServer?: () => McpServer;
  name?: string;
  environment?: NodeJS.ProcessEnv;
}

export function resolveStartHttpServerOptions(
  options?: StartMcpHttpServerOptions,
): Required<Pick<StartMcpHttpServerOptions, "name" | "environment">> &
  Pick<StartMcpHttpServerOptions, "createServer"> {
  // Starting an HTTP listener is a runtime side effect. Reject before caller
  // getters and before Bun.serve when the actual process is not local.
  assertTodosLocalStorageRole(process.env);
  if (!options) {
    return Object.freeze({
      name: MCP_HTTP_NAME,
      environment: snapshotTodosStorageEnvironment(process.env),
      createServer: undefined,
    });
  }
  const environment = readStageADataProperty(options, "environment");
  if (environment !== undefined && (environment === null || typeof environment !== "object")) {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  const resolvedEnvironment = snapshotTodosStorageEnvironment(environment ?? process.env);
  assertTodosLocalStorageRole(resolvedEnvironment);
  const name = readStageADataProperty(options, "name");
  const createServer = readStageADataProperty(options, "createServer");
  if (name !== undefined && typeof name !== "string") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  if (createServer !== undefined && typeof createServer !== "function") {
    throw new TodosHostedStorageUnavailableError("unreadable_options");
  }
  return Object.freeze({
    name: name || MCP_HTTP_NAME,
    environment: resolvedEnvironment,
    createServer: createServer as (() => McpServer) | undefined,
  });
}
