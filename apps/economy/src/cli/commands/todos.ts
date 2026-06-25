import { Command } from 'commander'
import chalk from 'chalk'

export type TodoStatus = 'pending' | 'in_progress' | 'done'

export interface TodoTask {
  id: string
  title: string
  status: TodoStatus
  deps?: string[]
}

export interface TodoPhase {
  id: string
  title: string
  summary: string
  tasks: TodoTask[]
}

export const ROADMAP_VERSION = '2026-05-23-b'
export const ROADMAP_GOAL =
  'Unified AI spend across 4+ machines: auto-sync local telemetry, track subscription usage & savings, ingest all major coding agents, and expose proactive CLI/MCP intelligence — not just per-machine API cost estimates.'

export const ROADMAP_PHASES: TodoPhase[] = [
  {
    id: 'phase-0',
    title: 'Foundation — usage vs spend model',
    summary:
      'Separate metered API cost, subscription-included usage, and savings so every agent reports the same dimensions.',
    tasks: [
      {
        id: '0.1',
        title: 'Extend Agent union: claude | codex | gemini | takumi | opencode | cursor | pi | hermes',
        status: 'done',
      },
      {
        id: '0.2',
        title: 'Add requests.cost_basis enum: metered_api | subscription_included | estimated | unknown',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '0.3',
        title: 'Add subscriptions table (provider, plan, monthly_fee_usd, included_usage_usd, billing_cycle_start, reset_policy)',
        status: 'done',
      },
      {
        id: '0.4',
        title: 'Add usage_snapshots table (agent, date, metric, value, unit, source_path) for quota %, premium requests, fast requests',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '0.5',
        title: 'Add savings_daily rollup: api_equivalent_usd, subscription_fee_usd, included_consumed_usd, on_demand_usd, saved_usd',
        status: 'done',
        deps: ['0.2', '0.3', '0.4'],
      },
      {
        id: '0.6',
        title: 'Document cost math: saved = max(0, api_equivalent - on_demand - prorated_subscription_fee)',
        status: 'done',
        deps: ['0.5'],
      },
    ],
  },
  {
    id: 'phase-1',
    title: 'Claude Code — subscription usage + API spend',
    summary: 'Claude ingest exists; add Pro/Max quota tracking and subscription vs API reconciliation.',
    tasks: [
      {
        id: '1.1',
        title: 'Ingest ~/.claude/telemetry for tengu_api_success (exact costUSD) — already done; tag cost_basis=metered_api',
        status: 'done',
      },
      {
        id: '1.2',
        title: 'Parse Claude session JSONL for subscription vs extra-usage signals (usage.service_tier, isMaxPlan, extra_usage flags)',
        status: 'done',
        deps: ['0.2'],
      },
      {
        id: '1.3',
        title: 'Add optional Claude OAuth usage endpoint ingest (claude.ai/api/organizations/.../usage) for plan quota %',
        status: 'done',
        deps: ['0.4'],
      },
      {
        id: '1.4',
        title: 'Map Claude Pro ($20) / Max ($100–200) plans in subscriptions; compute subscription vs pay-as-you-go savings',
        status: 'done',
        deps: ['0.3', '1.2', '1.3'],
      },
      {
        id: '1.5',
        title: 'CLI: economy usage --agent claude and economy savings --agent claude',
        status: 'done',
        deps: ['1.4', '0.5'],
      },
    ],
  },
  {
    id: 'phase-2',
    title: 'Codex — subscription vs API-equivalent',
    summary: 'Codex ingest estimates from tokens; add ChatGPT/Codex subscription quota where available.',
    tasks: [
      {
        id: '2.1',
        title: 'Ingest ~/.codex/state_5.sqlite threads + rollout token events — already done; mark cost_basis=estimated',
        status: 'done',
      },
      {
        id: '2.2',
        title: 'Detect Codex auth mode (ChatGPT subscription vs API key) from ~/.codex/config.toml / auth.json',
        status: 'done',
        deps: ['0.2'],
      },
      {
        id: '2.3',
        title: 'Ingest OpenAI usage limits if Codex exposes rate-limit headers or usage API for Plus/Pro subscribers',
        status: 'done',
        deps: ['0.4', '2.2'],
      },
      {
        id: '2.4',
        title: 'Reconcile Codex estimated cost vs OpenAI billing_daily for API-key mode',
        status: 'done',
        deps: ['2.1'],
      },
      {
        id: '2.5',
        title: 'Savings view: ChatGPT Plus/Pro fee vs API-equivalent token cost for same sessions',
        status: 'done',
        deps: ['2.2', '0.5'],
      },
    ],
  },
  {
    id: 'phase-3',
    title: 'OpenCode — new ingest',
    summary: 'Parse local JSON storage or OTLP metrics; OpenCode mirrors Claude Code telemetry shape.',
    tasks: [
      {
        id: '3.1',
        title: 'Discover paths: ~/.local/share/opencode/storage/{session,message,part}/**/*.json',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '3.2',
        title: 'Build ingest/opencode.ts: walk messages, extract model + token buckets + cost if present',
        status: 'done',
        deps: ['3.1'],
      },
      {
        id: '3.3',
        title: 'Optional OTLP collector mode: ingest opencode.cost.usage / opencode.token.usage from local collector',
        status: 'done',
        deps: ['3.2'],
      },
      {
        id: '3.4',
        title: 'Optional bridge: read opencode-telemetry SQLite at ~/.local/share/opencode-telemetry/data.db',
        status: 'done',
        deps: ['3.1'],
      },
      {
        id: '3.5',
        title: 'Wire economy sync --opencode, MCP sync sources, REST /api/sync, dashboard agent filter',
        status: 'done',
        deps: ['3.2'],
      },
      {
        id: '3.6',
        title: 'Tag OpenCode BYOK vs provider-subscription auth from ~/.local/share/opencode/auth.json',
        status: 'done',
        deps: ['3.2', '0.2'],
      },
    ],
  },
  {
    id: 'phase-4',
    title: 'Cursor Agent — subscription + on-demand',
    summary: 'Cursor bundles $20/mo included usage; track premium requests, on-demand spend, and API-equivalent.',
    tasks: [
      {
        id: '4.1',
        title: 'Ingest personal plan: GET cursor.com/api/usage, /api/usage-summary, /api/auth/stripe (session cookie or CURSOR_SESSION_TOKEN)',
        status: 'done',
        deps: ['0.1', '0.4'],
      },
      {
        id: '4.2',
        title: 'Ingest per-model spend: POST /api/dashboard/get-daily-spend-by-category (teamId, userId, billing cycle)',
        status: 'done',
        deps: ['4.1'],
      },
      {
        id: '4.3',
        title: 'Optional Enterprise: Admin API filtered-usage-events + Analytics API (CURSOR_ADMIN_API_KEY)',
        status: 'done',
        deps: ['4.1'],
      },
      {
        id: '4.4',
        title: 'Store premium/fast request counts, included $20 consumption, on-demand overage separately',
        status: 'done',
        deps: ['4.2', '0.4'],
      },
      {
        id: '4.5',
        title: 'Savings: Cursor subscription fee + on-demand vs raw API list price + Cursor Token Rate ($0.25/M)',
        status: 'done',
        deps: ['4.4', '0.5'],
      },
      {
        id: '4.6',
        title: 'Ingest local Cursor agent transcripts if ~/.cursor/ or project .cursor/ stores token metadata',
        status: 'done',
        deps: ['0.1'],
      },
    ],
  },
  {
    id: 'phase-5',
    title: 'Pi (pi.dev) — BYOK sessions',
    summary: 'Pi has no subscription; track provider-token usage from session JSON and optional pi-otlp metrics.',
    tasks: [
      {
        id: '5.1',
        title: 'Discover session dir: ~/.pi/agent/sessions/ or PI_CODING_AGENT_SESSION_DIR',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '5.2',
        title: 'Build ingest/pi.ts: parse session JSON/RPC export for provider, model, token counts per turn',
        status: 'done',
        deps: ['5.1'],
      },
      {
        id: '5.3',
        title: 'Optional OTLP: ingest pi.token.usage / pi.cost.usage from pi-otlp extension (localhost:4318)',
        status: 'done',
        deps: ['5.2'],
      },
      {
        id: '5.4',
        title: 'Savings vs subscription: compare Pi BYOK spend to hypothetical Claude Code/Cursor subscription for same token volume',
        status: 'done',
        deps: ['5.2', '0.5'],
      },
      {
        id: '5.5',
        title: 'Wire economy sync --pi and agent filters across CLI, MCP, SDK, dashboard',
        status: 'done',
        deps: ['5.2'],
      },
    ],
  },
  {
    id: 'phase-6',
    title: 'Hermes Agent — state.db ingest',
    summary: 'Hermes already stores estimated_cost_usd, actual_cost_usd, billing_mode per session in SQLite.',
    tasks: [
      {
        id: '6.1',
        title: 'Build ingest/hermes.ts: read ~/.hermes/state.db sessions (tokens, estimated/actual cost, billing_mode, source)',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '6.2',
        title: 'Map billing_mode (subscription | api | routed) to cost_basis and subscription provider',
        status: 'done',
        deps: ['6.1', '0.2'],
      },
      {
        id: '6.3',
        title: 'Ingest parent/child session chains for orchestration rollup (conductor + subagents)',
        status: 'done',
        deps: ['6.1'],
      },
      {
        id: '6.4',
        title: 'Optional: poll Hermes /usage CLI output or gateway metrics for live quota snapshots',
        status: 'done',
        deps: ['0.4', '6.1'],
      },
      {
        id: '6.5',
        title: 'Savings: Hermes cost-routing vs naive single-frontier-model baseline (per /usage --by-provider)',
        status: 'done',
        deps: ['6.2', '0.5'],
      },
      {
        id: '6.6',
        title: 'Wire economy sync --hermes and MCP install snippet',
        status: 'done',
        deps: ['6.1'],
      },
    ],
  },
  {
    id: 'phase-7',
    title: 'Unified usage & savings UX',
    summary: 'Surface subscription quota, API-equivalent, on-demand, and saved dollars in CLI, API, and dashboard.',
    tasks: [
      {
        id: '7.1',
        title: 'CLI economy usage [today|week|month] [--agent] — quota %, premium requests, included $ consumed',
        status: 'done',
        deps: ['0.4'],
      },
      {
        id: '7.2',
        title: 'CLI economy savings [period] [--agent] — table: subscription fee | included used | on-demand | API equivalent | saved',
        status: 'done',
        deps: ['0.5'],
      },
      {
        id: '7.3',
        title: 'CLI economy subscriptions set/list — configure plan fees and included usage caps',
        status: 'done',
        deps: ['0.3'],
      },
      {
        id: '7.4',
        title: 'REST GET /api/usage, GET /api/savings; extend billing show with savings column',
        status: 'done',
        deps: ['7.1', '7.2'],
      },
      {
        id: '7.5',
        title: 'Dashboard UsageTab + SavingsTab with agent breakdown and subscription vs API chart',
        status: 'done',
        deps: ['7.4'],
      },
      {
        id: '7.6',
        title: 'MCP tools: get_usage, get_savings, list_subscriptions; extend sync sources enum',
        status: 'done',
        deps: ['7.1', '7.2'],
      },
      {
        id: '7.7',
        title: 'Menubar: show today saved $ and highest-quota agent (Cursor/Claude)',
        status: 'done',
        deps: ['7.2'],
      },
      {
        id: '7.8',
        title: 'Storage sync: push/pull usage_snapshots, subscriptions, savings_daily tables',
        status: 'done',
        deps: ['0.3', '0.4', '0.5'],
      },
    ],
  },
  {
    id: 'phase-8',
    title: 'Quality, tests, docs',
    summary: 'Fixtures per agent, golden savings math tests, and operator docs.',
    tasks: [
      {
        id: '8.1',
        title: 'Fixtures: sample OpenCode message JSON, Cursor usage API responses, Pi session, Hermes state.db',
        status: 'done',
      },
      {
        id: '8.2',
        title: 'Unit tests for savings formula and cost_basis tagging per agent ingest',
        status: 'done',
        deps: ['0.5', '8.1'],
      },
      {
        id: '8.3',
        title: 'Integration test: economy sync --all-agents populates requests + usage_snapshots',
        status: 'done',
        deps: ['8.1'],
      },
      {
        id: '8.4',
        title: 'Update README, CLAUDE.md, economy todos list when tasks ship',
        status: 'done',
      },
      {
        id: '8.5',
        title: 'economy doctor: detect installed agents, missing auth, stale usage snapshots, storage drift',
        status: 'done',
        deps: ['7.1', '9.1'],
      },
    ],
  },
  {
    id: 'phase-9',
    title: 'Multi-machine auto sync (4-machine fleet)',
    summary:
      'Investigation: machine_id + listMachines + manual storage push/pull exist; repo-native storage needed incremental sync, conflict resolution, and launchd/systemd schedulers. Economy did not own them yet, requests/sessions lacked updated_at, ingest was local-only, RDS was hardcoded, and default commands never pulled before query.',
    tasks: [
      {
        id: '9.1',
        title: 'INVESTIGATION DONE: document gaps — no auto-sync, no updated_at on requests/sessions, ingest_state not storage-synced, billing_daily multi-writer OK via UPSERT, request IDs agent-prefixed (cross-machine safe), storage sync manual only',
        status: 'done',
      },
      {
        id: '9.2',
        title: 'Add updated_at + synced_at columns to requests, sessions, usage_snapshots; migrate SQLite + PG',
        status: 'done',
        deps: ['9.1', '0.4'],
      },
      {
        id: '9.3',
        title: 'Switch storage sync to repo-native incremental push/pull with _sync_meta (replace full table scans)',
        status: 'done',
        deps: ['9.2'],
      },
      {
        id: '9.4',
        title: 'Extract storage config: HASNA_ECONOMY_DATABASE_URL + explicit PostgreSQL credentials; remove hardcoded RDS host from CLI',
        status: 'done',
        deps: ['9.1'],
      },
      {
        id: '9.5',
        title: 'Auto-sync hook: after economy sync (ingest), auto storage push if HASNA_ECONOMY_SYNC_AUTO=1',
        status: 'done',
        deps: ['9.3', '9.4'],
      },
      {
        id: '9.6',
        title: 'Auto-pull hook: before summary queries (today/week/default), pull from storage if last pull > N minutes (HASNA_ECONOMY_SYNC_PULL_INTERVAL)',
        status: 'done',
        deps: ['9.3'],
      },
      {
        id: '9.7',
        title: 'CLI economy storage schedule install|status|remove — repo-native launchd/systemd scheduler every 5–15m',
        status: 'done',
        deps: ['9.5'],
      },
      {
        id: '9.8',
        title: 'CLI economy storage sync --all-machines: ingest local → push → pull → show per-machine row counts',
        status: 'done',
        deps: ['9.5', '9.6'],
      },
      {
        id: '9.9',
        title: 'Add machines registry table (machine_id, hostname, last_seen_at, last_push_at, last_pull_at, economy_version)',
        status: 'done',
        deps: ['9.2'],
      },
      {
        id: '9.10',
        title: 'storage status: show all 4 machines last sync time, row counts, stale warnings (>1h)',
        status: 'done',
        deps: ['9.9'],
      },
      {
        id: '9.11',
        title: 'Conflict policy for budgets/goals/pricing: detectConflicts + newest-wins; store conflicts in _sync_conflicts',
        status: 'done',
        deps: ['9.3'],
      },
      {
        id: '9.12',
        title: 'Include ingest_state in storage sync OR derive from max(timestamp) per machine to avoid re-ingest skew',
        status: 'done',
        deps: ['9.3'],
      },
      {
        id: '9.13',
        title: 'Unified fleet summary: economy today --all-machines (sum across spark01/spark02/apple01/apple02 without double-count)',
        status: 'done',
        deps: ['9.6', '9.10'],
      },
      {
        id: '9.14',
        title: 'Dashboard: machine filter dropdown + fleet-wide overview (all machines default when storage is connected)',
        status: 'done',
        deps: ['9.13'],
      },
      {
        id: '9.15',
        title: 'MCP + REST: get_fleet_summary, POST /api/storage/sync, storage schedule status endpoint',
        status: 'done',
        deps: ['9.8'],
      },
      {
        id: '9.16',
        title: 'Billing sync leader election: only one machine runs billing sync per day (storage lock via ingest_state or PG advisory lock)',
        status: 'done',
        deps: ['9.4'],
      },
    ],
  },
  {
    id: 'phase-10',
    title: 'Proactive ops — real-time & alerts',
    summary: 'Move from pull-based ledger to background watcher, health checks, and spike alerts.',
    tasks: [
      {
        id: '10.1',
        title: 'CLI economy status — one-line: today $X · week $Y · top agent · storage sync age · stale machines',
        status: 'done',
        deps: ['9.10'],
      },
      {
        id: '10.2',
        title: 'CLI economy doctor — installed agents, missing keys, pricing gaps, billing drift, storage connectivity, per-machine last ingest',
        status: 'done',
        deps: ['9.10', '8.5'],
      },
      {
        id: '10.3',
        title: 'File watcher daemon: economy watch --daemon on telemetry dirs (~/.claude/telemetry, ~/.codex, opencode storage)',
        status: 'done',
      },
      {
        id: '10.4',
        title: 'Watcher triggers ingest + optional storage push on new events (debounced 5s)',
        status: 'done',
        deps: ['10.3', '9.5'],
      },
      {
        id: '10.5',
        title: 'Spike alerts via webhook: reuse OverviewTab spike logic, fire on >2σ daily cost vs 14-day mean',
        status: 'done',
      },
      {
        id: '10.6',
        title: 'Forecast-over-budget alert: webhook when linear month projection exceeds active budget/goal',
        status: 'done',
      },
      {
        id: '10.7',
        title: 'economy watch --notify per-session threshold (extend existing --notify cumulative)',
        status: 'done',
      },
      {
        id: '10.8',
        title: 'systemd/launchd unit for economy watch --daemon + storage schedule on each machine',
        status: 'done',
        deps: ['10.4', '9.7'],
      },
    ],
  },
  {
    id: 'phase-11',
    title: 'Agent cost intelligence (MCP + CLI)',
    summary: 'Agents should self-regulate spend: estimate before call, advise cheaper models, dedup cross-agent.',
    tasks: [
      {
        id: '11.1',
        title: 'MCP estimate_cost(model, input_tokens, output_tokens, cache?) — pre-flight $ estimate',
        status: 'done',
      },
      {
        id: '11.2',
        title: 'MCP can_afford(scope, estimated_usd) — check budget/goal/subscription quota headroom',
        status: 'done',
        deps: ['7.1', '11.1'],
      },
      {
        id: '11.3',
        title: 'MCP suggest_model(complexity, max_usd) — rank models by price for task tier',
        status: 'done',
        deps: ['11.1'],
      },
      {
        id: '11.4',
        title: 'MCP get_savings_opportunities — cache misses, expensive models, duplicate agent overlap',
        status: 'done',
        deps: ['7.2', '11.6'],
      },
      {
        id: '11.5',
        title: 'CLI economy estimate / economy advise / economy report week --format markdown',
        status: 'done',
        deps: ['11.1'],
      },
      {
        id: '11.6',
        title: 'Cross-agent dedup: canonical key (provider, source_request_id); skip duplicate requests across hermes/codex/claude',
        status: 'done',
        deps: ['0.2'],
      },
      {
        id: '11.7',
        title: 'Attribution tags: ECONOMY_TAG env + git branch on sessions; economy attribution breakdown command',
        status: 'done',
      },
    ],
  },
  {
    id: 'phase-12',
    title: 'CLI ergonomics & agent registry',
    summary: 'Scriptability, discoverability, single source of truth for agents across CLI/MCP/SDK/dashboard.',
    tasks: [
      {
        id: '12.1',
        title: 'Central src/lib/agents.ts registry — replace duplicated AGENTS arrays in CLI, MCP, SDK, dashboard charts',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '12.2',
        title: '--json flag on today, week, month, breakdown, budget list, billing show, machines, savings',
        status: 'done',
      },
      {
        id: '12.3',
        title: 'economy completion bash|zsh|fish',
        status: 'done',
      },
      {
        id: '12.4',
        title: 'economy init — detect agents, set ECONOMY_MACHINE_ID, storage URL, MCP install, storage schedule, cron hint',
        status: 'done',
        deps: ['9.7', '12.1'],
      },
      {
        id: '12.5',
        title: 'Grouped help: economy help ingest|alerts|storage|usage',
        status: 'done',
      },
      {
        id: '12.6',
        title: 'Mark existing machine_id + listMachines + storage push/pull/sync as done baseline',
        status: 'done',
      },
    ],
  },
  {
    id: 'phase-13',
    title: 'Billing reconciliation depth',
    summary: 'Close the trust gap between estimated token cost and provider invoices.',
    tasks: [
      {
        id: '13.1',
        title: 'billing diff --period month — unexplained delta as first-class metric with % threshold',
        status: 'done',
      },
      {
        id: '13.2',
        title: 'Per-agent reconciliation: attribute OpenAI bill slice to codex vs other usage',
        status: 'done',
      },
      {
        id: '13.3',
        title: 'Match Anthropic billing description line items to ingested model names',
        status: 'done',
      },
      {
        id: '13.4',
        title: 'Auto-suggest sync --recalculate when drift > 15%',
        status: 'done',
        deps: ['13.1'],
      },
      {
        id: '13.5',
        title: 'Dashboard Reconciliation tab — estimated vs billed vs subscription-included Venn',
        status: 'done',
        deps: ['7.5', '13.1'],
      },
    ],
  },
  {
    id: 'phase-14',
    title: 'Universal ingest (OTel) & platform',
    summary: 'OTLP sidecar for OpenCode/Pi/Claude; Linux tray; serve auth.',
    tasks: [
      {
        id: '14.1',
        title: 'Ingest plugin interface: { agentId, discover(), ingest(db) } for third-party sources',
        status: 'done',
        deps: ['0.1'],
      },
      {
        id: '14.2',
        title: 'economy-otel sidecar: normalize *.cost.usage / *.token.usage OTLP metrics into requests table',
        status: 'done',
        deps: ['14.1', '3.3', '5.3'],
      },
      {
        id: '14.3',
        title: 'Windows path support: %USERPROFILE% for opencode, codex, claude, hermes, pi',
        status: 'done',
      },
      {
        id: '14.4',
        title: 'Linux status widget: waybar module or economy bar --tui (menubar is macOS-only today)',
        status: 'done',
      },
      {
        id: '14.5',
        title: 'economy serve auth token (ECONOMY_API_TOKEN) — localhost-only default, optional LAN bind',
        status: 'done',
      },
    ],
  },
]

function statusLabel(status: TodoStatus): string {
  if (status === 'done') return chalk.green('done')
  if (status === 'in_progress') return chalk.yellow('in progress')
  return chalk.dim('pending')
}

function countByStatus(tasks: TodoTask[]): Record<TodoStatus, number> {
  return tasks.reduce(
    (acc, task) => {
      acc[task.status]++
      return acc
    },
    { pending: 0, in_progress: 0, done: 0 } as Record<TodoStatus, number>,
  )
}

export function printTodosHelp(): void {
  console.log()
  console.log(chalk.bold.cyan('  Economy Roadmap — fleet, usage & savings'))
  console.log()
  console.log(chalk.dim(`  Version: ${ROADMAP_VERSION}`))
  console.log(`  ${ROADMAP_GOAL}`)
  console.log()
  console.log(chalk.bold('  Commands'))
  console.log('    economy todos              Overview of phases and progress')
  console.log('    economy todos list         All granular tasks')
  console.log('    economy todos list --phase <id>   Tasks for one phase (e.g. phase-9)')
  console.log('    economy todos show <task-id>      Task detail (e.g. 9.7)')
  console.log()
  console.log(chalk.bold('  Multi-machine (current vs target)'))
  console.log('    today       machine_id on rows, economy machines, manual storage push/pull/sync')
  console.log('    gap         no auto-sync, no updated_at, hardcoded RDS, queries are local-only')
  console.log('    target      4 machines → PostgreSQL storage hub → auto push/pull every 5–15m → fleet today')
  console.log()
  console.log(chalk.bold('  Agents covered'))
  console.log('    claude       Claude Code telemetry + Pro/Max quota (partial)')
  console.log('    codex        Codex SQLite + ChatGPT subscription mode')
  console.log('    opencode     ~/.local/share/opencode/storage JSON + OTLP')
  console.log('    cursor       Cursor Agent usage/on-demand APIs')
  console.log('    pi           Pi coding agent sessions (BYOK)')
  console.log('    hermes       ~/.hermes/state.db sessions + cost routing')
  console.log('    gemini/takumi  Existing; extend with usage quota where available')
  console.log()
  console.log(chalk.bold('  Key metrics (target)'))
  console.log('    api_equivalent_usd     What the same tokens would cost at list API prices')
  console.log('    subscription_fee_usd   Monthly plan cost (prorated per period)')
  console.log('    included_consumed_usd  Usage counted against plan inclusion')
  console.log('    on_demand_usd          Overage billed beyond inclusion')
  console.log('    saved_usd              api_equivalent - on_demand - prorated_fee (when positive)')
  console.log()
}

export function printTodosOverview(): void {
  console.log()
  console.log(chalk.bold.cyan('  Economy Roadmap'))
  console.log(chalk.dim(`  ${ROADMAP_VERSION} — ${ROADMAP_GOAL}`))
  console.log()

  const allTasks = ROADMAP_PHASES.flatMap(phase => phase.tasks)
  const totals = countByStatus(allTasks)

  console.log(
    `  ${chalk.green(String(totals.done))} done · ${chalk.yellow(String(totals.in_progress))} in progress · ${chalk.dim(String(totals.pending))} pending · ${allTasks.length} total`,
  )
  console.log()

  for (const phase of ROADMAP_PHASES) {
    const counts = countByStatus(phase.tasks)
    const progress =
      phase.tasks.length > 0 ? Math.round((counts.done / phase.tasks.length) * 100) : 0
    console.log(`  ${chalk.bold(phase.id)}  ${phase.title}  ${chalk.dim(`(${progress}% · ${phase.tasks.length} tasks)`)}`)
    console.log(chalk.dim(`    ${phase.summary}`))
  }
  console.log()
  console.log(chalk.dim('  Run: economy todos list'))
  console.log(chalk.dim('  Run: economy todos --help'))
  console.log()
}

export function printTodosList(opts: { phase?: string; status?: TodoStatus }): void {
  const phases = opts.phase
    ? ROADMAP_PHASES.filter(phase => phase.id === opts.phase)
    : ROADMAP_PHASES

  if (phases.length === 0) {
    console.log(chalk.red(`Unknown phase: ${opts.phase}`))
    console.log(chalk.dim(`Valid phases: ${ROADMAP_PHASES.map(phase => phase.id).join(', ')}`))
    return
  }

  console.log()
  for (const phase of phases) {
    const tasks = opts.status ? phase.tasks.filter(task => task.status === opts.status) : phase.tasks
    if (tasks.length === 0) continue

    console.log(chalk.bold.cyan(`  ${phase.id} — ${phase.title}`))
    console.log(chalk.dim(`  ${phase.summary}`))
    console.log()
    for (const task of tasks) {
      const deps = task.deps?.length ? chalk.dim(`  deps: ${task.deps.join(', ')}`) : ''
      console.log(`    ${chalk.dim(task.id.padEnd(5))} ${statusLabel(task.status).padEnd(14)} ${task.title}${deps ? `\n${' '.repeat(22)}${deps}` : ''}`)
    }
    console.log()
  }
}

export function printTodoShow(taskId: string): void {
  for (const phase of ROADMAP_PHASES) {
    const task = phase.tasks.find(entry => entry.id === taskId)
    if (!task) continue

    console.log()
    console.log(chalk.bold.cyan(`  ${task.id} — ${task.title}`))
    console.log(`  Phase: ${phase.id} (${phase.title})`)
    console.log(`  Status: ${statusLabel(task.status)}`)
    if (task.deps?.length) {
      console.log(`  Depends on: ${task.deps.join(', ')}`)
    }
    console.log(chalk.dim(`\n  ${phase.summary}`))
    console.log()
    return
  }

  console.log(chalk.red(`Task not found: ${taskId}`))
  console.log(chalk.dim('Run: economy todos list'))
}

export function registerTodosCommand(program: Command): void {
  const todosCmd = program
    .command('todos')
    .description('Roadmap and granular tasks — fleet sync, usage tracking, subscription savings')
    .option('--help-roadmap', 'Show roadmap help (usage vs API spend, agents, metrics)')
    .action((opts: { helpRoadmap?: boolean }) => {
      if (opts.helpRoadmap) {
        printTodosHelp()
        return
      }
      printTodosOverview()
    })

  todosCmd
    .command('list')
    .description('List granular roadmap tasks')
    .option('--phase <id>', 'Filter by phase id (e.g. phase-4)')
    .option('--status <status>', 'Filter by status: pending|in_progress|done')
    .action((opts: { phase?: string; status?: string }) => {
      const status = opts.status as TodoStatus | undefined
      if (status && !['pending', 'in_progress', 'done'].includes(status)) {
        console.error(chalk.red('--status must be one of: pending, in_progress, done'))
        process.exit(1)
      }
      printTodosList({ phase: opts.phase, status })
    })

  todosCmd
    .command('show <task-id>')
    .description('Show a single task (e.g. 4.2)')
    .action((taskId: string) => {
      printTodoShow(taskId)
    })

  todosCmd.addHelpText('after', () => {
    printTodosHelp()
    return ''
  })
}
