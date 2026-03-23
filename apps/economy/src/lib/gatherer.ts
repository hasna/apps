// Training data gatherer for @hasna/economy
// Exports gatherTrainingData() conforming to GatherResult interface from @hasna/brains

import { openDatabase, querySummary, querySessions, queryModelBreakdown, queryProjectBreakdown, getBudgetStatuses, getGoalStatuses } from '../db/database.js'

// Inline type definition — mirrors GatherResult / GatherTrainingDataFn from @hasna/brains
// (avoids requiring @hasna/brains as a hard dependency)

interface TrainingMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface TrainingExample {
  messages: TrainingMessage[]
}

interface GatherResult {
  source: string
  examples: TrainingExample[]
  count: number
}

interface GathererOptions {
  limit?: number
  since?: Date
  outputDir?: string
}

type GatherTrainingDataFn = (options?: GathererOptions) => Promise<GatherResult>

const SYSTEM_PROMPT =
  'You are a cost-aware AI assistant that tracks API usage, identifies expensive patterns, and helps optimize spending.'

export const gatherTrainingData: GatherTrainingDataFn = async (
  options: GathererOptions = {}
): Promise<GatherResult> => {
  const limit = options.limit ?? 500
  const examples: TrainingExample[] = []

  try {
    const db = openDatabase()

    // ── Summary examples ──────────────────────────────────────────────────────

    const periods = ['today', 'week', 'month', 'all'] as const
    for (const period of periods) {
      try {
        const s = querySummary(db, period)
        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `What did I spend on AI ${period === 'all' ? 'in total' : period}?` },
            {
              role: 'assistant',
              content: `${period === 'all' ? 'Total' : period.charAt(0).toUpperCase() + period.slice(1)} AI spending: $${s.total_usd.toFixed(4)} across ${s.sessions} session(s), ${s.requests} request(s), ${s.tokens.toLocaleString()} tokens.`,
            },
          ],
        })
      } catch { /* skip */ }
    }

    // ── Session cost examples ─────────────────────────────────────────────────

    const sessions = querySessions(db, {
      limit: Math.min(Math.floor(limit / 4), 50),
      since: options.since?.toISOString().substring(0, 10),
    })

    for (const s of sessions) {
      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `How much did the session "${s.id.substring(0, 12)}" cost?`,
          },
          {
            role: 'assistant',
            content: `Session ${s.id.substring(0, 12)} (${s.agent}, project: ${s.project_name || 'unknown'}): $${s.total_cost_usd.toFixed(4)}, ${s.total_tokens.toLocaleString()} tokens, ${s.request_count} requests. Started: ${s.started_at.substring(0, 16)}.`,
          },
        ],
      })

      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `What was the token usage for session ${s.id.substring(0, 12)}?`,
          },
          {
            role: 'assistant',
            content: `Session ${s.id.substring(0, 12)} used ${s.total_tokens.toLocaleString()} tokens across ${s.request_count} requests on project "${s.project_name || 'unknown'}" (${s.agent}).`,
          },
        ],
      })

      if (examples.length >= limit) break
    }

    // ── Model breakdown examples ──────────────────────────────────────────────

    const modelBreakdown = queryModelBreakdown(db)
    if (modelBreakdown.length > 0) {
      const topModels = modelBreakdown.slice(0, 5)
      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Which AI models have I spent the most on?' },
          {
            role: 'assistant',
            content: `Model cost breakdown (top ${topModels.length}):\n${topModels
              .map((m) => `- ${m.model} (${m.agent}): $${m.cost_usd.toFixed(4)}, ${m.requests} requests, ${m.total_tokens.toLocaleString()} tokens`)
              .join('\n')}`,
          },
        ],
      })

      for (const m of topModels) {
        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `How much have I spent on ${m.model}?` },
            {
              role: 'assistant',
              content: `${m.model} (${m.agent}): $${m.cost_usd.toFixed(4)} total across ${m.requests.toLocaleString()} requests and ${m.total_tokens.toLocaleString()} tokens.`,
            },
          ],
        })
      }
    }

    // ── Project breakdown examples ────────────────────────────────────────────

    const projectBreakdown = queryProjectBreakdown(db)
    if (projectBreakdown.length > 0) {
      const topProjects = projectBreakdown.slice(0, 5)
      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Which projects are costing the most?' },
          {
            role: 'assistant',
            content: `Project cost breakdown (top ${topProjects.length}):\n${topProjects
              .map((p) => `- ${p.project_name || 'unknown'}: $${p.cost_usd.toFixed(4)}, ${p.sessions} sessions`)
              .join('\n')}`,
          },
        ],
      })

      for (const p of topProjects.slice(0, 3)) {
        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `What is the AI spend for project "${p.project_name}"?` },
            {
              role: 'assistant',
              content: `Project "${p.project_name}": $${p.cost_usd.toFixed(4)} across ${p.sessions} session(s) and ${p.requests.toLocaleString()} requests. Last active: ${p.last_active?.substring(0, 10) ?? 'unknown'}.`,
            },
          ],
        })
      }
    }

    // ── Budget examples ────────────────────────────────────────────────────────

    try {
      const budgets = getBudgetStatuses(db)
      if (budgets.length > 0) {
        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'How am I tracking against my AI spending budgets?' },
            {
              role: 'assistant',
              content: `Budget status:\n${budgets
                .map((b) => `- ${b.project_path ?? 'global'} (${b.period}): $${b.current_spend_usd.toFixed(4)} / $${b.limit_usd.toFixed(2)} (${b.percent_used.toFixed(1)}%) — ${b.is_over_limit ? 'OVER LIMIT' : b.is_over_alert ? 'ALERT' : 'OK'}`)
                .join('\n')}`,
            },
          ],
        })
      }
    } catch { /* budgets optional */ }

    // ── Goal examples ──────────────────────────────────────────────────────────

    try {
      const goals = getGoalStatuses(db)
      if (goals.length > 0) {
        examples.push({
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: 'Am I on track with my AI cost reduction goals?' },
            {
              role: 'assistant',
              content: `Goal progress:\n${goals
                .map((g) => `- ${g.period} goal (${g.project_path ?? g.agent ?? 'global'}): $${g.current_spend_usd.toFixed(4)} / $${g.limit_usd.toFixed(2)} (${g.percent_used.toFixed(1)}%) — ${g.is_over ? 'OVER' : g.is_at_risk ? 'AT RISK' : 'ON TRACK'}`)
                .join('\n')}`,
            },
          ],
        })
      }
    } catch { /* goals optional */ }

    // ── Optimization advice examples ──────────────────────────────────────────

    const weekSummary = querySummary(db, 'week')
    const monthSummary = querySummary(db, 'month')
    if (weekSummary.total_usd > 0) {
      const projectedMonthly = (weekSummary.total_usd / 7) * 30
      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'Based on my usage, what will I spend this month?' },
          {
            role: 'assistant',
            content: `Based on your last 7 days ($${weekSummary.total_usd.toFixed(4)}), projected monthly spend is approximately $${projectedMonthly.toFixed(2)}. Current month-to-date: $${monthSummary.total_usd.toFixed(4)}.`,
          },
        ],
      })
    }

    if (modelBreakdown.length > 1) {
      const expensive = modelBreakdown[0]!
      const cheaper = modelBreakdown[modelBreakdown.length - 1]!
      examples.push({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'How can I reduce my AI API costs?' },
          {
            role: 'assistant',
            content: `Your most expensive model is ${expensive.model} at $${expensive.cost_usd.toFixed(4)}. Consider switching some workloads to ${cheaper.model} ($${cheaper.cost_usd.toFixed(4)}) for cost savings. Cache frequently repeated prompts to reduce cache-miss costs.`,
          },
        ],
      })
    }
  } catch {
    // Return partial results on any DB error
  }

  const finalExamples = examples.slice(0, limit)
  return { source: 'economy', examples: finalExamples, count: finalExamples.length }
}
