import {
  handleMcpHttpRequest as harnessHandleMcpHttpRequest,
  healthPayload,
  isHttpMode as harnessIsHttpMode,
  isStdioMode as harnessIsStdioMode,
  resolveMcpHttpPort as harnessResolveMcpHttpPort,
} from './harness.js'
import { buildServer, DEFAULT_MCP_HTTP_PORT, MCP_NAME } from './server.js'

// Port is owned by server.ts (co-located with the tool/server definitions);
// re-exported here rather than redefined so there is a single source of truth.
export { DEFAULT_MCP_HTTP_PORT, MCP_NAME }

// Bun's default HTTP idle timeout (10s) is too short for long-lived MCP
// Streamable HTTP requests. The vendored startBunHttpServer doesn't
// expose an idleTimeout knob, so this transport is hand-wired directly on
// Bun.serve (below) instead of delegating to the harness's Bun server starter.
export const MCP_HTTP_IDLE_TIMEOUT_SECONDS = 0

export function isHttpMode(argv: string[] = process.argv.slice(2)): boolean {
  return harnessIsHttpMode(argv)
}

export function isStdioMode(argv: string[] = process.argv.slice(2)): boolean {
  return harnessIsStdioMode(argv)
}

export function resolveHttpPort(argv: string[] = process.argv.slice(2)): number {
  // Preserve the `-p <port>` shorthand (documented in --help) by normalizing
  // it to `--port` before delegating to the harness's strict parser/precedence.
  const normalized = argv.map((arg) => (arg === '-p' ? '--port' : arg))
  return harnessResolveMcpHttpPort({ argv: normalized, default: DEFAULT_MCP_HTTP_PORT })
}

export async function handleMcpHttpRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/health' && req.method === 'GET') {
    return Response.json(healthPayload(MCP_NAME))
  }

  if (url.pathname === '/mcp') {
    return harnessHandleMcpHttpRequest(req, buildServer)
  }

  return new Response('Not Found', { status: 404 })
}

export interface StartHttpServerOptions {
  port?: number
  hostname?: string
  log?: (message: string) => void
}

export function startHttpServer(options: StartHttpServerOptions = {}): ReturnType<typeof Bun.serve> {
  const port = options.port ?? DEFAULT_MCP_HTTP_PORT
  const hostname = options.hostname ?? '127.0.0.1'
  const log = options.log ?? console.error

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: MCP_HTTP_IDLE_TIMEOUT_SECONDS,
    fetch: handleMcpHttpRequest,
  })

  const address = `http://${hostname}:${server.port}`
  log(`${MCP_NAME}-mcp HTTP listening on ${address}/mcp (health: ${address}/health)`)
  return server
}
