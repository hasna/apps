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
      for (const expected of ['get_cost_summary', 'get_sessions', 'get_pricing', 'set_budget', 'set_pricing', 'get_billing_summary', 'sync', 'describe_tools']) {
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

      const budgetSet = await client.callTool(
        { name: 'set_budget', arguments: { period: 'weekly', limit_usd: 25, project_path: '/workspace/open-economy', agent: 'codex', alert_at_percent: 70 } },
        undefined,
        { timeout: 5_000 },
      )
      const budgetSetText = budgetSet.content[0]?.type === 'text' ? budgetSet.content[0].text : ''
      expect(budgetSetText).toContain('Budget set:')
      const budgetId = budgetSetText.split(': ')[1]
      expect(budgetId?.length).toBeGreaterThan(8)

      const budgetStatus = await client.callTool(
        { name: 'get_budget_status', arguments: {} },
        undefined,
        { timeout: 5_000 },
      )
      expect(budgetStatus.content[0]?.type === 'text' ? budgetStatus.content[0].text : '').toContain('/workspace/open-econ')

      await client.callTool(
        { name: 'remove_budget', arguments: { id: budgetId } },
        undefined,
        { timeout: 5_000 },
      )

      await client.callTool(
        {
          name: 'set_pricing',
          arguments: {
            model: 'custom-model',
            input_per_1m: 1,
            output_per_1m: 2,
            cache_storage_per_1m_hour: 4.5,
          },
        },
        undefined,
        { timeout: 5_000 },
      )
      const customPricing = await client.callTool(
        { name: 'get_pricing', arguments: {} },
        undefined,
        { timeout: 5_000 },
      )
      const customPricingText = customPricing.content[0]?.type === 'text' ? customPricing.content[0].text : ''
      expect(customPricingText).toContain('custom-model')
      expect(customPricingText).toContain('$4.50')
      await client.callTool(
        { name: 'remove_pricing', arguments: { model: 'custom-model' } },
        undefined,
        { timeout: 5_000 },
      )

      const description = await client.callTool(
        { name: 'describe_tools', arguments: { names: ['sync', 'get_billing_summary', 'get_pricing', 'set_budget', 'set_pricing'] } },
        undefined,
        { timeout: 5_000 },
      )
      const text = description.content[0]?.type === 'text' ? description.content[0].text : ''
      expect(text).toContain('sync: sources(all|claude|takumi|codex|gemini|opencode|cursor|pi|hermes)')
      expect(text).toContain('get_billing_summary: period(today|yesterday|week|month|year|all)')
      expect(text).toContain('get_pricing: no params -> model pricing rows')
      expect(text).toContain('set_budget: period(daily|weekly|monthly)')
      expect(text).toContain('set_pricing: model, input_per_1m')
    } finally {
      await client.close()
    }
  })
})
