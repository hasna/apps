import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resetEconomyCloudStorageCache } from '../lib/cloud-storage.js'

// server.js resolves the storage seam (getStore()) at module scope, and that
// resolution now FAILS CLOSED unless the fleet API env or the explicit local
// opt-in is present. These tests serve the on-box SQLite store under
// HASNA_ECONOMY_DB_PATH, so pin the local opt-in and a hermetic no-API env
// BEFORE the server module is first evaluated (dynamic import, below).
//
// Snapshot BEFORE mutating, restore in afterAll: the pinned opt-in must not
// leak into the rest of the suite. Left on process.env it turned the #1788
// ambient-gate test in credential-resolution.test.ts (which resolves from the
// LIVE process env on purpose) into a local-mode run — green alone, red in
// the full run.
const PINNED_ENV_KEYS = [
  'HASNA_ECONOMY_API_URL',
  'HASNA_ECONOMY_API_KEY',
  'ECONOMY_API_URL',
  'ECONOMY_API_KEY',
  'HASNA_ECONOMY_LOCAL',
  'ECONOMY_LOCAL',
  'HASNA_ECONOMY_DB_PATH',
] as const
const savedEnv: Record<string, string | undefined> = Object.fromEntries(
  PINNED_ENV_KEYS.map((key) => [key, process.env[key]]),
)
for (const key of [
  'HASNA_ECONOMY_API_URL',
  'HASNA_ECONOMY_API_KEY',
  'ECONOMY_API_URL',
  'ECONOMY_API_KEY',
]) {
  delete process.env[key]
}
process.env['HASNA_ECONOMY_LOCAL'] = '1'
process.env['ECONOMY_LOCAL'] = '1'

const { buildServer, DEFAULT_MCP_HTTP_PORT, MCP_NAME } = await import('./server.js')
const { startHttpServer, MCP_HTTP_IDLE_TIMEOUT_SECONDS } = await import('./http.js')

const roots: string[] = []
const servers: Array<ReturnType<typeof startHttpServer>> = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop(true)
  }
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

afterAll(() => {
  for (const key of PINNED_ENV_KEYS) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  // The seam memoizes its resolution for the process; drop the local-mode
  // resolution this file pinned so the next file resolves its own env.
  resetEconomyCloudStorageCache()
})

describe('economy-mcp HTTP transport', () => {
  it('exposes health and serves MCP over Streamable HTTP', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-mcp-http-test-'))
    roots.push(root)
    process.env['HASNA_ECONOMY_DB_PATH'] = join(root, 'economy.db')

    const server = startHttpServer({ port: 0, log: () => {} })
    servers.push(server)

    const baseUrl = `http://127.0.0.1:${server.port}`
    const health = await fetch(`${baseUrl}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok', name: MCP_NAME })

    const client = new Client({ name: 'economy-mcp-http-test', version: '1.0.0' }, { capabilities: {} })
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`))

    try {
      await client.connect(transport, { timeout: 10_000 })

      const tools = await client.listTools(undefined, { timeout: 10_000 })
      expect(tools.tools.some((tool) => tool.name === 'get_cost_summary')).toBe(true)

      const summary = await client.callTool(
        { name: 'get_cost_summary', arguments: { period: 'today' } },
        undefined,
        { timeout: 10_000 },
      )
      expect(summary.content[0]?.type).toBe('text')
      expect(summary.content[0]?.type === 'text' ? summary.content[0].text : '').toContain('period: today')
    } finally {
      await client.close()
    }
  })

  it('uses the assigned default port constant', () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8860)
  })

  it('disables Bun request idle timeout for long-lived MCP requests', () => {
    expect(MCP_HTTP_IDLE_TIMEOUT_SECONDS).toBe(0)
  })
})

describe('economy-mcp buildServer', () => {
  it('registers core tools for stdio and HTTP modes', () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-mcp-build-test-'))
    roots.push(root)
    process.env['HASNA_ECONOMY_DB_PATH'] = join(root, 'economy.db')

    const server = buildServer()
    expect(server).toBeTruthy()
  })
})
