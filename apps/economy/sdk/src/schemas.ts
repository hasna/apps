/**
 * OpenAI-compatible function/tool schemas for @hasna/economy.
 * Use with any agent framework that supports OpenAI function calling.
 *
 * Usage with OpenAI:
 *   const tools = economyTools.map(t => ({ type: "function", function: t }));
 *
 * Usage with Anthropic:
 *   const tools = economyTools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
 */

export type EconomyToolName =
  | 'economy_get_summary'
  | 'economy_get_sessions'
  | 'economy_get_top_sessions'
  | 'economy_get_model_breakdown'
  | 'economy_get_project_breakdown'
  | 'economy_get_budget_status'
  | 'economy_sync'

export const economyTools = [
  {
    name: 'economy_get_summary',
    description: 'Get total AI coding cost summary for a time period (today, week, month, all). Returns total USD, session count, request count, token count, and a human-readable summary sentence.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'all'], description: 'Time period', default: 'today' },
      },
    },
  },
  {
    name: 'economy_get_sessions',
    description: 'List coding sessions with cost data. Each session represents one Claude Code or Codex CLI interaction.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Filter by AI agent' },
        project: { type: 'string', description: 'Filter by project path (partial match)' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
    },
  },
  {
    name: 'economy_get_top_sessions',
    description: 'Get the most expensive coding sessions ranked by cost',
    parameters: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of sessions (default 10)' },
        agent: { type: 'string', enum: ['claude', 'codex'], description: 'Filter by agent' },
      },
    },
  },
  {
    name: 'economy_get_model_breakdown',
    description: 'Get cost breakdown by AI model — shows requests, tokens, and cost per model',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_get_project_breakdown',
    description: 'Get cost breakdown by project — shows sessions, tokens, and cost per project',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_get_budget_status',
    description: 'Get current budget status — spending vs limits, percent used, alert flags',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_sync',
    description: 'Trigger cost data ingestion from Claude Code telemetry and/or Codex sessions',
    parameters: {
      type: 'object',
      properties: {
        sources: { type: 'string', enum: ['all', 'claude', 'codex'], description: 'Which sources to sync (default: all)' },
      },
    },
  },
] as const
