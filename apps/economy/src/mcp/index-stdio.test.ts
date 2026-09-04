import { afterEach, describe, expect, it } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const roots: string[] = []
// Storage-mode variables are retired. The fleet shell exports
// HASNA_ECONOMY_API_URL/KEY and the disk app-config tier derives from HOME, so
// these tests pin the spawned server to the local backend by clearing both
// tiers (the contracts client selects the http transport purely from the API
// URL/KEY pair; an empty HOME kills the disk tier). HASNA_ECONOMY_LOCAL is the
// explicit opt-in that keeps this a legal local-mode run — without it the
// server fails closed (see src/lib/cloud-storage.ts).
const localStorageEnv = {
  HOME: '',
  HASNA_ECONOMY_API_URL: '',
  HASNA_ECONOMY_API_KEY: '',
  ECONOMY_API_URL: '',
  ECONOMY_API_KEY: '',
  HASNA_ECONOMY_LOCAL: '1',
  ECONOMY_LOCAL: '1',
} as const

function envWith(overrides: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    ...localStorageEnv,
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
      for (const expected of ['get_cost_summary', 'get_sessions', 'get_pricing', 'get_cost_center_breakdown', 'set_budget', 'set_pricing', 'get_billing_summary', 'get_usage', 'get_savings', 'list_subscriptions', 'set_subscription', 'remove_subscription', 'sync', 'describe_tools']) {
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
        { name: 'get_pricing', arguments: { limit: 100 } },
        undefined,
        { timeout: 5_000 },
      )
      const pricingText = pricing.content[0]?.type === 'text' ? pricing.content[0].text : ''
      expect(pricingText).toContain('gemini-3.1-pro-preview')
      expect(pricingText).toContain('storage-h')

      const budgetSet = await client.callTool(
        { name: 'set_budget', arguments: { period: 'weekly', limit_usd: 25, project_path: '/workspace/economy', agent: 'codex', cost_center_id: 'loop:fleet-evaluator', alert_at_percent: 70 } },
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
      expect(budgetStatus.content[0]?.type === 'text' ? budgetStatus.content[0].text : '').toContain('loop:fleet-evaluator')

      await client.callTool(
        { name: 'remove_budget', arguments: { id: budgetId } },
        undefined,
        { timeout: 5_000 },
      )

      const costCenters = await client.callTool(
        { name: 'get_cost_center_breakdown', arguments: { kind: 'loop' } },
        undefined,
        { timeout: 5_000 },
      )
      expect(costCenters.content[0]?.type === 'text' ? costCenters.content[0].text : '').toContain('No cost-center usage yet.')

      const subscriptionSet = await client.callTool(
        {
          name: 'set_subscription',
          arguments: {
            id: 'sub-stdio',
            provider: 'cursor',
            plan: 'pro',
            agent: 'cursor',
            monthly_fee_usd: 20,
            included_usage_usd: 20,
          },
        },
        undefined,
        { timeout: 5_000 },
      )
      const subscriptionSetText = subscriptionSet.content[0]?.type === 'text' ? subscriptionSet.content[0].text : ''
      expect(subscriptionSetText).toContain('Subscription set: sub-stdio')
      expect(subscriptionSetText).toContain('provider: cursor')
      expect(subscriptionSetText).not.toContain('"id"')

      const subscriptionSetJson = await client.callTool(
        {
          name: 'set_subscription',
          arguments: {
            id: 'sub-stdio',
            provider: 'cursor',
            plan: 'pro',
            agent: 'cursor',
            monthly_fee_usd: 20,
            included_usage_usd: 20,
            json: true,
          },
        },
        undefined,
        { timeout: 5_000 },
      )
      const subscriptionSetJsonText = subscriptionSetJson.content[0]?.type === 'text' ? subscriptionSetJson.content[0].text : ''
      expect(JSON.parse(subscriptionSetJsonText)).toMatchObject({ id: 'sub-stdio', provider: 'cursor', plan: 'pro' })

      const savings = await client.callTool(
        { name: 'get_savings', arguments: { period: 'month' } },
        undefined,
        { timeout: 5_000 },
      )
      const savingsText = savings.content[0]?.type === 'text' ? savings.content[0].text : ''
      expect(savingsText).toContain('api_equivalent:')
      expect(savingsText).not.toContain('"by_agent"')

      const savingsJson = await client.callTool(
        { name: 'get_savings', arguments: { period: 'month', json: true } },
        undefined,
        { timeout: 5_000 },
      )
      const savingsJsonText = savingsJson.content[0]?.type === 'text' ? savingsJson.content[0].text : ''
      expect(JSON.parse(savingsJsonText)).toMatchObject({ period: 'month' })

      const usageJson = await client.callTool(
        { name: 'get_usage', arguments: { period: 'month', json: true } },
        undefined,
        { timeout: 5_000 },
      )
      const usageJsonText = usageJson.content[0]?.type === 'text' ? usageJson.content[0].text : ''
      expect(JSON.parse(usageJsonText)).toHaveProperty('summary')

      const subscriptions = await client.callTool(
        { name: 'list_subscriptions', arguments: {} },
        undefined,
        { timeout: 5_000 },
      )
      const subscriptionsText = subscriptions.content[0]?.type === 'text' ? subscriptions.content[0].text : ''
      expect(subscriptionsText).toContain('cursor')
      expect(subscriptionsText).toContain('$20.00')

      await client.callTool(
        { name: 'remove_subscription', arguments: { id: 'sub-stdio' } },
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
        { name: 'get_pricing', arguments: { limit: 100 } },
        undefined,
        { timeout: 5_000 },
      )
      const customPricingText = customPricing.content[0]?.type === 'text' ? customPricing.content[0].text : ''
      expect(customPricingText).toContain('custom-model')
      expect(customPricingText).toContain('$4.50')

      const defaultPricing = await client.callTool(
        { name: 'get_pricing', arguments: {} },
        undefined,
        { timeout: 5_000 },
      )
      const defaultPricingText = defaultPricing.content[0]?.type === 'text' ? defaultPricing.content[0].text : ''
      expect(defaultPricingText).toContain('more pricing rows hidden')

      await client.callTool(
        { name: 'remove_pricing', arguments: { model: 'custom-model' } },
        undefined,
        { timeout: 5_000 },
      )

      const description = await client.callTool(
        { name: 'describe_tools', arguments: { names: ['sync', 'get_sessions', 'get_billing_summary', 'get_pricing', 'get_usage', 'get_savings', 'get_session_detail', 'set_budget', 'set_pricing', 'list_subscriptions', 'set_subscription', 'register_agent', 'list_agents'] } },
        undefined,
        { timeout: 5_000 },
      )
      const text = description.content[0]?.type === 'text' ? description.content[0].text : ''
      expect(text).toContain('sync: sources(all|claude|takumi|codex|gemini|opencode|cursor|pi|hermes|loops), json?')
      expect(text).toContain('get_sessions: agent(claude|takumi|codex|gemini|opencode|cursor|pi|hermes), project(partial), account?(key/name/email)')
      expect(text).toContain('get_billing_summary: period(today|yesterday|week|month|year|all)')
      expect(text).toContain('get_pricing: limit(20), verbose?, json?')
      expect(text).toContain('get_usage: period(today|week|month|year|all)')
      expect(text).toContain('limit(20), json? -> usage snapshots')
      expect(text).toContain('get_savings: period(today|week|month|year|all)')
      expect(text).toContain('get_session_detail: session_id(prefix ok), limit(20), verbose?')
      expect(text).toContain('set_budget: period(daily|weekly|monthly)')
      expect(text).toContain('cost_center_id?')
      expect(text).toContain('set_pricing: model, input_per_1m')
      expect(text).toContain('list_subscriptions: no params')
      expect(text).toContain('set_subscription: provider, plan')
      expect(text).toContain('json? -> create/update subscription plan')
      expect(text).toContain('register_agent: name, session_id?')
      expect(text).toContain('list_agents: no params')
    } finally {
      await client.close()
    }
  })
})
