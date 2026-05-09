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
  | 'economy_get_session_detail'
  | 'economy_get_top_sessions'
  | 'economy_list_machines'
  | 'economy_get_model_breakdown'
  | 'economy_get_project_breakdown'
  | 'economy_get_budget_status'
  | 'economy_get_pricing'
  | 'economy_get_daily'
  | 'economy_get_goals'
  | 'economy_get_billing_summary'
  | 'economy_sync'

export const economyTools = [
  {
    name: 'economy_get_summary',
    description: 'Get total AI coding cost summary for a time period. Returns total USD, session count, request count, token count, and a human-readable summary sentence.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'week', 'month', 'year', 'all'], description: 'Time period', default: 'today' },
        machine: { type: 'string', description: 'Filter by machine/host id' },
      },
    },
  },
  {
    name: 'economy_get_sessions',
    description: 'List coding sessions with cost data from Claude Code, Takumi, Codex, or Gemini.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: ['claude', 'takumi', 'codex', 'gemini'], description: 'Filter by AI agent' },
        project: { type: 'string', description: 'Filter by project path (partial match)' },
        machine: { type: 'string', description: 'Filter by machine/host id' },
        search: { type: 'string', description: 'Search session id, agent, or project fields' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
    },
  },
  {
    name: 'economy_get_session_detail',
    description: 'Get per-request token and cost detail for one session by full id or prefix.',
    parameters: {
      type: 'object',
      properties: {
        session_id: { type: 'string', description: 'Session id or id prefix' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'economy_get_top_sessions',
    description: 'Get the most expensive coding sessions ranked by cost',
    parameters: {
      type: 'object',
      properties: {
        n: { type: 'number', description: 'Number of sessions (default 10)' },
        agent: { type: 'string', enum: ['claude', 'takumi', 'codex', 'gemini'], description: 'Filter by agent' },
      },
    },
  },
  {
    name: 'economy_list_machines',
    description: 'List machines that have synced cost data with session counts, request counts, spend, and last activity.',
    parameters: { type: 'object', properties: {} },
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
    name: 'economy_get_pricing',
    description: 'List editable model pricing rows — input, output, cache read/write, one-hour cache write, and context-cache storage rates',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_get_daily',
    description: 'Get daily cost data grouped by date and agent.',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of recent days (default 30)' },
      },
    },
  },
  {
    name: 'economy_get_goals',
    description: 'Get all spending goals with current progress and risk status.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_get_billing_summary',
    description: 'Get ground-truth provider billing totals imported from admin APIs',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'yesterday', 'week', 'month', 'year', 'all'], description: 'Time period', default: 'month' },
      },
    },
  },
  {
    name: 'economy_sync',
    description: 'Trigger cost data ingestion from Claude Code, Takumi, Codex, and Gemini sessions',
    parameters: {
      type: 'object',
      properties: {
        sources: { type: 'string', enum: ['all', 'claude', 'takumi', 'codex', 'gemini'], description: 'Which sources to sync (default: all)' },
      },
    },
  },
] as const
