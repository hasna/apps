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
  | 'economy_get_agent_breakdown'
  | 'economy_get_account_breakdown'
  | 'economy_get_budget_status'
  | 'economy_set_budget'
  | 'economy_remove_budget'
  | 'economy_get_pricing'
  | 'economy_set_pricing'
  | 'economy_remove_pricing'
  | 'economy_get_daily'
  | 'economy_get_goals'
  | 'economy_set_goal'
  | 'economy_remove_goal'
  | 'economy_get_billing_summary'
  | 'economy_get_usage'
  | 'economy_get_savings'
  | 'economy_list_subscriptions'
  | 'economy_set_subscription'
  | 'economy_remove_subscription'
  | 'economy_sync'

const agentEnum = ['claude', 'takumi', 'codex', 'gemini', 'opencode', 'cursor', 'pi', 'hermes'] as const
const sourceEnum = ['all', ...agentEnum] as const

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
    description: 'List coding sessions with cost data from supported AI coding agents.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: agentEnum, description: 'Filter by AI agent' },
        project: { type: 'string', description: 'Filter by project path (partial match)' },
        account: { type: 'string', description: 'Filter by account key, name, or email' },
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
        agent: { type: 'string', enum: agentEnum, description: 'Filter by agent' },
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
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'], description: 'Optional period filter' },
      },
    },
  },
  {
    name: 'economy_get_agent_breakdown',
    description: 'Get cost breakdown by coding agent — shows sessions, requests, tokens, API-equivalent cost, billable API spend, subscription-included usage, and last activity',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'], description: 'Optional period filter' },
      },
    },
  },
  {
    name: 'economy_get_account_breakdown',
    description: 'Get cost breakdown by account — shows account identity, sessions, requests, tokens, API-equivalent cost, billable API spend, subscription-included usage, and last activity',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'], description: 'Optional period filter' },
      },
    },
  },
  {
    name: 'economy_get_budget_status',
    description: 'Get current budget status — spending vs limits, percent used, alert flags',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_set_budget',
    description: 'Create a spending budget for a period, optionally scoped to a project path or agent.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Budget period' },
        limit_usd: { type: 'number', description: 'Budget limit in USD; must be positive' },
        project_path: { type: 'string', description: 'Optional project path scope' },
        agent: { type: 'string', enum: agentEnum, description: 'Optional agent scope' },
        alert_at_percent: { type: 'number', description: 'Alert threshold percentage, 1-100; default 80' },
      },
      required: ['period', 'limit_usd'],
    },
  },
  {
    name: 'economy_remove_budget',
    description: 'Delete a spending budget by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Budget id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'economy_get_pricing',
    description: 'List editable model pricing rows — input, output, cache read/write, one-hour cache write, and context-cache storage rates',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_set_pricing',
    description: 'Create or update an editable model pricing row.',
    parameters: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model id' },
        input_per_1m: { type: 'number', description: 'Input token price per 1M tokens' },
        output_per_1m: { type: 'number', description: 'Output token price per 1M tokens' },
        cache_read_per_1m: { type: 'number', description: 'Cached input price per 1M tokens' },
        cache_write_per_1m: { type: 'number', description: '5-minute cache write price per 1M tokens' },
        cache_write_1h_per_1m: { type: 'number', description: '1-hour cache write price per 1M tokens' },
        cache_storage_per_1m_hour: { type: 'number', description: 'Context-cache storage price per 1M token-hours' },
      },
      required: ['model', 'input_per_1m', 'output_per_1m'],
    },
  },
  {
    name: 'economy_remove_pricing',
    description: 'Delete an editable model pricing row by model id.',
    parameters: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model id' },
      },
      required: ['model'],
    },
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
    name: 'economy_set_goal',
    description: 'Create a spending goal, optionally scoped to a project path or agent.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['day', 'week', 'month', 'year'], description: 'Goal period' },
        limit_usd: { type: 'number', description: 'Goal limit in USD; must be positive' },
        project_path: { type: 'string', description: 'Optional project path scope' },
        agent: { type: 'string', enum: agentEnum, description: 'Optional agent scope' },
      },
      required: ['period', 'limit_usd'],
    },
  },
  {
    name: 'economy_remove_goal',
    description: 'Delete a spending goal by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal id' },
      },
      required: ['id'],
    },
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
    name: 'economy_get_usage',
    description: 'Get subscription quota and usage snapshots with an all-machine cost summary.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'], description: 'Time period', default: 'month' },
        agent: { type: 'string', enum: agentEnum, description: 'Optional agent filter' },
      },
    },
  },
  {
    name: 'economy_get_savings',
    description: 'Get subscription-vs-API-equivalent savings, including subscription fee, included consumption, on-demand spend, API equivalent, and saved USD.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year', 'all'], description: 'Time period', default: 'month' },
        agent: { type: 'string', enum: agentEnum, description: 'Optional agent filter' },
      },
    },
  },
  {
    name: 'economy_list_subscriptions',
    description: 'List configured subscription plans used by savings calculations.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'economy_set_subscription',
    description: 'Create or update a subscription plan used by subscription-vs-API savings calculations.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Optional id to update an existing subscription' },
        provider: { type: 'string', description: 'Provider name, for example claude, openai, cursor, or codex' },
        plan: { type: 'string', description: 'Plan name' },
        agent: { type: 'string', enum: agentEnum, description: 'Optional agent scope' },
        monthly_fee_usd: { type: 'number', description: 'Monthly fee in USD; must be non-negative' },
        included_usage_usd: { type: 'number', description: 'Included usage value in USD; must be non-negative' },
        billing_cycle_start: { type: 'string', description: 'Optional billing cycle start date' },
        reset_policy: { type: 'string', description: 'Reset policy, default monthly' },
        active: { type: 'boolean', description: 'Whether the subscription is active' },
      },
      required: ['provider', 'plan'],
    },
  },
  {
    name: 'economy_remove_subscription',
    description: 'Delete a subscription plan by id.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Subscription id' },
      },
      required: ['id'],
    },
  },
  {
    name: 'economy_sync',
    description: 'Trigger cost data ingestion from supported AI coding agent sessions',
    parameters: {
      type: 'object',
      properties: {
        sources: { type: 'string', enum: sourceEnum, description: 'Which sources to sync (default: all)' },
      },
    },
  },
] as const
