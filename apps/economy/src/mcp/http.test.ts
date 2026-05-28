import { afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildServer } from './server.js'
import { DEFAULT_MCP_HTTP_PORT, MCP_NAME, startHttpServer } from './http.js'

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
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8815)
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
