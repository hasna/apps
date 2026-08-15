#!/usr/bin/env bun
/**
 * `sandboxes-mcp` — Model Context Protocol (stdio) server exposing disposable
 * sandbox lifecycle tools over the managed E2B/Daytona adapters (and the local
 * simulator). Tool names mirror the previous sandbox-manager MCP so existing
 * `mcp__sandboxes__*` client configs keep working. Every tool resolves a
 * provider-neutral SandboxBackend; credentials are never returned to clients.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { startMcpHttpServer } from "@hasna/mcp-harness/node"
import { isSandboxProvider, resolveBackend, SANDBOX_PROVIDERS, type SecretsReader } from "../runtime/resolve"
import type { SandboxBackend, SandboxProvider } from "../runtime/types"
import { resolvePackageVersion } from "../version"

/** HTTP port the fleet daemon (systemd `hasna-sandboxes-mcp.service`) expects. */
export const DEFAULT_MCP_HTTP_PORT = 8875

/**
 * stdio-vs-HTTP selection with identical semantics to `@hasna/sandboxes@0.2.5`
 * (which delegated to `@hasna/mcp-harness`). Implemented locally so this fast
 * path carries no dependency on the harness `.` entrypoint — that one top-level
 * imports an SDK transport module (`webStandardStreamableHttp`) not present in
 * our pinned `@modelcontextprotocol/sdk`. HTTP is the default; the systemd unit
 * passes no args, so with no `--stdio`/`MCP_STDIO=1` it serves HTTP on :8875.
 */
export function isStdioMode(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): boolean {
  return argv.includes("--stdio") || env.MCP_STDIO === "1"
}

function parsePort(value: string): number {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid MCP HTTP port: ${JSON.stringify(value)}`)
  }
  return port
}

/** Resolve the HTTP port: `--port=<n>` / `--port <n>` / `MCP_HTTP_PORT`, else default. */
export function resolveMcpHttpPort(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): number {
  const inline = argv.find((arg) => arg.startsWith("--port="))
  if (inline !== undefined) return parsePort(inline.slice("--port=".length))
  const flagIdx = argv.indexOf("--port")
  if (flagIdx !== -1) {
    const value = argv[flagIdx + 1]
    if (value !== undefined) return parsePort(value)
  }
  const envPort = env.MCP_HTTP_PORT
  if (typeof envPort === "string" && envPort.length > 0) return parsePort(envPort)
  return DEFAULT_MCP_HTTP_PORT
}

// Reported as `serverInfo.version` in the MCP `initialize` handshake and by the
// `version`/`health` tools; sourced from package.json (shared with the CLI via
// ../version) so it never drifts.
export const MCP_VERSION = resolvePackageVersion(import.meta.url)

export interface McpDeps {
  resolve?: (provider: SandboxProvider) => Promise<SandboxBackend>
  env?: NodeJS.ProcessEnv
  home?: string
  secretsReader?: SecretsReader
}

type Json = Record<string, unknown>
type ToolHandler = (args: Json, backend: SandboxBackend) => Promise<unknown>

interface ToolDef {
  name: string
  description: string
  inputSchema: Json
  handler: ToolHandler
}

const providerProp = { type: "string", enum: [...SANDBOX_PROVIDERS], description: "provider (default local)" }
const idProp = { type: "string", description: "sandbox id" }

function str(args: Json, key: string): string {
  const value = args[key]
  if (typeof value !== "string" || value.length === 0) throw new Error(`missing required string '${key}'`)
  return value
}

function argvFrom(args: Json): string[] {
  const command = args.command
  if (Array.isArray(command)) return command.map((c) => String(c))
  if (typeof command === "string") return ["sh", "-c", command]
  throw new Error("missing required 'command' (string or string[])")
}

export const SANDBOX_TOOLS: ToolDef[] = [
  {
    name: "create_sandbox",
    description: "Create a new sandbox",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProp,
        template: { type: "string", description: "template / image alias" },
        timeout_ms: { type: "number", description: "auto-expire after N ms" },
        metadata: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    handler: async (args, backend) =>
      backend.create({
        ...(typeof args.template === "string" ? { template: args.template } : {}),
        ...(typeof args.timeout_ms === "number" ? { timeout_ms: args.timeout_ms } : {}),
        ...(args.metadata && typeof args.metadata === "object" ? { metadata: args.metadata as Record<string, string> } : {}),
      }),
  },
  {
    name: "list_sandboxes",
    description: "List sandboxes",
    inputSchema: { type: "object", properties: { provider: providerProp } },
    handler: async (_args, backend) => backend.list(),
  },
  {
    name: "get_sandbox",
    description: "Get sandbox details by ID",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => backend.get(str(args, "sandbox_id")),
  },
  {
    name: "delete_sandbox",
    description: "Delete a sandbox",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => {
      await backend.destroy(str(args, "sandbox_id"))
      return { deleted: true, sandbox_id: args.sandbox_id }
    },
  },
  {
    name: "stop_sandbox",
    description: "Stop a running sandbox",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => backend.stop(str(args, "sandbox_id")),
  },
  {
    name: "keep_alive",
    description: "Extend sandbox lifetime",
    inputSchema: {
      type: "object",
      properties: { provider: providerProp, sandbox_id: idProp, timeout_ms: { type: "number" } },
      required: ["sandbox_id", "timeout_ms"],
    },
    handler: async (args, backend) => backend.keepAlive(str(args, "sandbox_id"), Number(args.timeout_ms)),
  },
  {
    name: "exec_command",
    description: "Execute a command in a sandbox",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProp,
        sandbox_id: idProp,
        command: { description: "command string or argv array" },
        cwd: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["sandbox_id", "command"],
    },
    handler: async (args, backend) =>
      backend.exec(str(args, "sandbox_id"), argvFrom(args), {
        ...(typeof args.cwd === "string" ? { cwd: args.cwd } : {}),
        ...(typeof args.timeout_ms === "number" ? { timeout_ms: args.timeout_ms } : {}),
      }),
  },
  {
    name: "read_file",
    description: "Read a file from a sandbox",
    inputSchema: {
      type: "object",
      properties: { provider: providerProp, sandbox_id: idProp, path: { type: "string" } },
      required: ["sandbox_id", "path"],
    },
    handler: async (args, backend) => {
      const bytes = await backend.readFile(str(args, "sandbox_id"), str(args, "path"))
      return { path: args.path, content: new TextDecoder().decode(bytes), content_base64: Buffer.from(bytes).toString("base64") }
    },
  },
  {
    name: "write_file",
    description: "Write a file to a sandbox",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProp,
        sandbox_id: idProp,
        path: { type: "string" },
        content: { type: "string", description: "UTF-8 content" },
        content_base64: { type: "string", description: "base64-encoded content" },
      },
      required: ["sandbox_id", "path"],
    },
    handler: async (args, backend) => {
      const bytes =
        typeof args.content_base64 === "string"
          ? new Uint8Array(Buffer.from(args.content_base64, "base64"))
          : new TextEncoder().encode(typeof args.content === "string" ? args.content : "")
      return backend.writeFile(str(args, "sandbox_id"), str(args, "path"), bytes)
    },
  },
  {
    name: "list_files",
    description: "List files in a sandbox directory",
    inputSchema: {
      type: "object",
      properties: { provider: providerProp, sandbox_id: idProp, path: { type: "string" } },
      required: ["sandbox_id"],
    },
    handler: async (args, backend) => backend.listFiles(str(args, "sandbox_id"), typeof args.path === "string" ? args.path : "/workspace"),
  },
  {
    name: "get_logs",
    description: "Get sandbox event logs",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => backend.getLogs(str(args, "sandbox_id")),
  },
  {
    name: "expose_port",
    description: "Forward a sandbox port and get a public URL",
    inputSchema: {
      type: "object",
      properties: { provider: providerProp, sandbox_id: idProp, port: { type: "number" } },
      required: ["sandbox_id", "port"],
    },
    handler: async (args, backend) => backend.exposePort(str(args, "sandbox_id"), Number(args.port)),
  },
  {
    name: "list_exposed_ports",
    description: "List all forwarded ports for a sandbox",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => backend.listExposedPorts(str(args, "sandbox_id")),
  },
  {
    name: "snapshot_sandbox",
    description: "Capture sandbox filesystem state as a snapshot",
    inputSchema: { type: "object", properties: { provider: providerProp, sandbox_id: idProp }, required: ["sandbox_id"] },
    handler: async (args, backend) => backend.snapshot(str(args, "sandbox_id")),
  },
  {
    name: "upload_dir",
    description: "Upload a local (host) directory into a sandbox. Reads files from the host filesystem path given in local_dir; only expose to trusted callers.",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProp,
        sandbox_id: idProp,
        local_dir: { type: "string", description: "local directory to upload" },
        dest: { type: "string", description: "destination directory in the sandbox (default /workspace)" },
      },
      required: ["sandbox_id", "local_dir"],
    },
    handler: async (args, backend) => {
      const id = str(args, "sandbox_id")
      const localDir = str(args, "local_dir")
      const dest = typeof args.dest === "string" ? args.dest : "/workspace"
      const uploaded: string[] = []
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) walk(full)
          else uploaded.push(full)
        }
      }
      walk(localDir)
      for (const full of uploaded) {
        const rel = relative(localDir, full)
        await backend.writeFile(id, `${dest.replace(/\/$/u, "")}/${rel}`, new Uint8Array(readFileSync(full)))
      }
      return { uploaded: uploaded.length, dest }
    },
  },
  {
    name: "run_agent",
    description: "Run an agent command inside a sandbox (thin exec wrapper)",
    inputSchema: {
      type: "object",
      properties: {
        provider: providerProp,
        sandbox_id: idProp,
        agent: { type: "string", description: "agent executable (default: agent)" },
        prompt: { type: "string", description: "prompt / task" },
        args: { type: "array", items: { type: "string" } },
      },
      required: ["sandbox_id", "prompt"],
    },
    handler: async (args, backend) => {
      const agent = typeof args.agent === "string" ? args.agent : "agent"
      const extra = Array.isArray(args.args) ? args.args.map((a) => String(a)) : []
      return backend.exec(str(args, "sandbox_id"), [agent, ...extra, str(args, "prompt")])
    },
  },
  {
    name: "version",
    description: "Get server version and available providers",
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({ name: "@hasna/sandboxes", server: "sandboxes-mcp", version: MCP_VERSION, providers: SANDBOX_PROVIDERS }),
  },
  {
    name: "health",
    description: "Health check",
    inputSchema: { type: "object", properties: {} },
    handler: async () => ({ status: "ok", version: MCP_VERSION }),
  },
]

export function createSandboxesMcpServer(deps: McpDeps = {}): Server {
  const server = new Server({ name: "sandboxes-mcp", version: MCP_VERSION }, { capabilities: { tools: {} } })
  const resolve =
    deps.resolve ??
    ((provider: SandboxProvider): Promise<SandboxBackend> =>
      resolveBackend(provider, {
        ...(deps.env === undefined ? {} : { env: deps.env }),
        ...(deps.home === undefined ? {} : { home: deps.home }),
        ...(deps.secretsReader === undefined ? {} : { secretsReader: deps.secretsReader }),
      }))

  const byName = new Map(SANDBOX_TOOLS.map((tool) => [tool.name, tool]))

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: SANDBOX_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = byName.get(request.params.name)
    if (tool === undefined) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `unknown tool: ${request.params.name}` }) }], isError: true }
    }
    const args = (request.params.arguments ?? {}) as Json
    const providerRaw = typeof args.provider === "string" ? args.provider : "local"
    if (!isSandboxProvider(providerRaw)) {
      return { content: [{ type: "text", text: JSON.stringify({ error: `unknown provider: ${providerRaw}` }) }], isError: true }
    }
    let backend: SandboxBackend | undefined
    try {
      backend = await resolve(providerRaw)
      const result = await tool.handler(args, backend)
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      }
    } finally {
      await backend?.close()
    }
  })

  return server
}

/**
 * Start the Streamable HTTP transport on 127.0.0.1 at `/mcp`, wired through the
 * shared `@hasna/mcp-harness` Node adapter — the exact transport the fleet
 * daemon (@hasna/sandboxes@0.2.5) served on :8875, so the unchanged systemd
 * unit stays a drop-in. Each request builds a fresh, stateless server.
 */
export function startSandboxesHttpServer(
  options: { port?: number; hostname?: string; deps?: McpDeps } = {},
): Promise<{ port: number; host: string; close: () => Promise<void> }> {
  const deps = options.deps ?? {}
  return startMcpHttpServer(() => createSandboxesMcpServer(deps), {
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.hostname === undefined ? {} : { host: options.hostname }),
    serviceName: "sandboxes",
    defaultPort: DEFAULT_MCP_HTTP_PORT,
  })
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: sandboxes-mcp [options]",
      "",
      "MCP server for @hasna/sandboxes disposable sandbox lifecycle tools.",
      `Defaults to Streamable HTTP on 127.0.0.1:${DEFAULT_MCP_HTTP_PORT}/mcp (the transport`,
      "the fleet daemon exposes); pass --stdio to serve over stdio instead.",
      "",
      "Options:",
      "  --http           Serve over Streamable HTTP (default; env MCP_HTTP=1)",
      "  --stdio          Serve over stdio (env MCP_STDIO=1)",
      `  --port <n>       HTTP port (default ${DEFAULT_MCP_HTTP_PORT}, env MCP_HTTP_PORT)`,
      "  -h, --help       Show this help",
      "  -V, --version    Show version",
      "",
    ].join("\n") + "\n",
  )
}

async function runCli(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp()
    return
  }
  if (argv.includes("--version") || argv.includes("-V")) {
    process.stdout.write(`${MCP_VERSION}\n`)
    return
  }
  if (isStdioMode(argv)) {
    const server = createSandboxesMcpServer()
    await server.connect(new StdioServerTransport())
    return
  }
  await startSandboxesHttpServer({ port: resolveMcpHttpPort(argv) })
}

if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`fatal: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
