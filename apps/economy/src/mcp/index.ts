#!/usr/bin/env bun
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { openDatabase, querySummary, querySessions, queryTopSessions, queryModelBreakdown, queryProjectBreakdown, getBudgetStatuses } from '../db/database.js'
import { ingestClaude } from '../ingest/claude.js'
import { ingestCodex } from '../ingest/codex.js'
import { ensurePricingSeeded } from '../lib/pricing.js'
import type { Period, Agent } from '../types/index.js'

const db = openDatabase()
ensurePricingSeeded(db)

const server = new Server(
  { name: 'economy', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

const TOOLS = [
  {
    name: 'get_cost_summary',
    description: 'Get total cost summary for a time period',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'all'], description: 'Time period', default: 'today' },
      },
    },
  },
  {
    name: 'get_sessions',
    description: 'List coding sessions with cost data',
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Filter by agent' },
        project: { type: 'string', description: 'Filter by project path (partial match)' },
        limit: { type: 'number', description: 'Max results', default: 20 },
      },
    },
  },
  {
    name: 'get_top_sessions',
    description: 'Get the most expensive coding sessions',
    inputSchema: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of sessions to return', default: 10 },
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Filter by agent' },
      },
    },
  },
  {
    name: 'get_model_breakdown',
    description: 'Get cost breakdown by AI model',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_project_breakdown',
    description: 'Get cost breakdown by project',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_budget_status',
    description: 'Get current budget status and spending vs limits',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sync',
    description: 'Trigger cost data ingestion from Claude Code and/or Codex',
    inputSchema: {
      type: 'object',
      properties: {
        sources: { type: 'string', enum: ['all', 'claude', 'codex'], default: 'all' },
      },
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params
  const a = (args ?? {}) as Record<string, unknown>

  try {
    switch (name) {
      case 'get_cost_summary': {
        const period = (a['period'] as Period | undefined) ?? 'today'
        const summary = querySummary(db, period)
        return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] }
      }
      case 'get_sessions': {
        const sessions = querySessions(db, {
          agent: a['agent'] as Agent | undefined,
          project: a['project'] as string | undefined,
          limit: Number(a['limit'] ?? 20),
        })
        return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] }
      }
      case 'get_top_sessions': {
        const sessions = queryTopSessions(db, Number(a['n'] ?? 10), a['agent'] as string | undefined)
        return { content: [{ type: 'text', text: JSON.stringify(sessions, null, 2) }] }
      }
      case 'get_model_breakdown': {
        return { content: [{ type: 'text', text: JSON.stringify(queryModelBreakdown(db), null, 2) }] }
      }
      case 'get_project_breakdown': {
        return { content: [{ type: 'text', text: JSON.stringify(queryProjectBreakdown(db), null, 2) }] }
      }
      case 'get_budget_status': {
        return { content: [{ type: 'text', text: JSON.stringify(getBudgetStatuses(db), null, 2) }] }
      }
      case 'sync': {
        const sources = (a['sources'] as string | undefined) ?? 'all'
        const results: Record<string, unknown> = {}
        if (sources === 'all' || sources === 'claude') results['claude'] = await ingestClaude(db)
        if (sources === 'all' || sources === 'codex') results['codex'] = await ingestCodex(db)
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
