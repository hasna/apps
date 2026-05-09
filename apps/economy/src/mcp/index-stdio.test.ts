import { afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const roots: string[] = []

function envWith(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('economy-mcp stdio server', () => {
  it('exposes Economy tools and serves cost summaries over MCP stdio', async () => {
    const root = mkdtempSync(join(tmpdir(), 'economy-mcp-stdio-test-'))
    roots.push(root)

    const client = new Client({ name: 'economy-mcp-stdio-test', version: '1.0.0' }, { capabilities: {} })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['run', 'src/mcp/index.ts'],
      cwd: process.cwd(),
      env: envWith({ HASNA_ECONOMY_DB_PATH: join(root, 'economy.db') }),
      stderr: 'pipe',
    })

    try {
      await client.connect(transport, { timeout: 5_000 })

      const tools = await client.listTools(undefined, { timeout: 5_000 })
      const names = new Set(tools.tools.map((tool) => tool.name))
      for (const expected of ['get_cost_summary', 'get_sessions', 'get_pricing', 'get_billing_summary', 'sync', 'describe_tools']) {
        expect(names.has(expected)).toBe(true)
      }

      const summary = await client.callTool(
        { name: 'get_cost_summary', arguments: { period: 'today' } },
        undefined,
        { timeout: 5_000 },
      )
      expect(summary.content[0]?.type).toBe('text')
      expect(summary.content[0]?.type === 'text' ? summary.content[0].text : '').toContain('period: today')

      const pricing = await client.callTool(
        { name: 'get_pricing', arguments: {} },
        undefined,
        { timeout: 5_000 },
      )
      const pricingText = pricing.content[0]?.type === 'text' ? pricing.content[0].text : ''
      expect(pricingText).toContain('gemini-3.1-pro-preview')
      expect(pricingText).toContain('storage-h')

      const description = await client.callTool(
        { name: 'describe_tools', arguments: { names: ['sync', 'get_billing_summary', 'get_pricing'] } },
        undefined,
        { timeout: 5_000 },
      )
      const text = description.content[0]?.type === 'text' ? description.content[0].text : ''
      expect(text).toContain('sync: sources(all|claude|takumi|codex|gemini)')
      expect(text).toContain('get_billing_summary: period(today|yesterday|week|month|year|all)')
      expect(text).toContain('get_pricing: no params -> model pricing rows')
    } finally {
      await client.close()
    }
  })
})
