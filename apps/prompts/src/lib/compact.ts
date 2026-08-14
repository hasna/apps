import type { Prompt, PromptVersion, SearchResult, SlimPrompt, SlimSearchResult } from "../types/index.js"
import type { PromptSchedule } from "../db/schedules.js"

export const DEFAULT_PREVIEW_CHARS = 160

export function truncateText(value: string | null | undefined, max = DEFAULT_PREVIEW_CHARS): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim()
  if (text.length <= max) return text
  if (max <= 3) return text.slice(0, max)
  return `${text.slice(0, max - 3).trimEnd()}...`
}

export function promptVariableNames(prompt: {
  variable_names?: string[]
  variables?: Array<{ name: string }>
}): string[] {
  if (prompt.variable_names) return prompt.variable_names
  return prompt.variables?.map((v) => v.name) ?? []
}

export type PromptSummary = {
  id: string
  slug: string
  title: string
  description: string | null
  collection: string
  tags: string[]
  variable_names: string[]
  is_template: boolean
  source: Prompt["source"]
  pinned: boolean
  next_prompt: string | null
  expires_at: string | null
  project_id: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
  version?: number
  body_chars?: number
  body_preview?: string
}

export function toPromptSummary(prompt: Prompt | SlimPrompt, opts: { bodyPreviewChars?: number } = {}): PromptSummary {
  const body = "body" in prompt ? prompt.body : undefined
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    description: prompt.description,
    collection: prompt.collection,
    tags: prompt.tags,
    variable_names: promptVariableNames(prompt),
    is_template: prompt.is_template,
    source: prompt.source,
    pinned: prompt.pinned,
    next_prompt: prompt.next_prompt,
    expires_at: prompt.expires_at,
    project_id: prompt.project_id,
    use_count: prompt.use_count,
    last_used_at: prompt.last_used_at,
    created_at: prompt.created_at,
    updated_at: prompt.updated_at,
    ...("version" in prompt ? { version: prompt.version } : {}),
    ...(body !== undefined ? { body_chars: body.length } : {}),
    ...(body !== undefined && opts.bodyPreviewChars !== undefined
      ? { body_preview: truncateText(body, opts.bodyPreviewChars) }
      : {}),
  }
}

export type SearchSummary = {
  id: string
  slug: string
  title: string
  description: string | null
  collection: string
  tags: string[]
  variable_names: string[]
  is_template: boolean
  use_count: number
  score: number
  snippet?: string
}

export function toSearchSummary(result: SearchResult | SlimSearchResult, snippetChars = DEFAULT_PREVIEW_CHARS): SearchSummary {
  if ("prompt" in result) {
    const prompt = result.prompt
    return {
      id: prompt.id,
      slug: prompt.slug,
      title: prompt.title,
      description: prompt.description,
      collection: prompt.collection,
      tags: prompt.tags,
      variable_names: promptVariableNames(prompt),
      is_template: prompt.is_template,
      use_count: prompt.use_count,
      score: result.score,
      ...(result.snippet ? { snippet: truncateText(result.snippet, snippetChars) } : {}),
    }
  }
  return {
    id: result.id,
    slug: result.slug,
    title: result.title,
    description: result.description,
    collection: result.collection,
    tags: result.tags,
    variable_names: result.variable_names,
    is_template: result.is_template,
    use_count: result.use_count,
    score: result.score,
    ...(result.snippet ? { snippet: truncateText(result.snippet, snippetChars) } : {}),
  }
}

export function toVersionSummary(version: PromptVersion, opts: { includeBody?: boolean; bodyPreviewChars?: number } = {}) {
  return {
    id: version.id,
    prompt_id: version.prompt_id,
    version: version.version,
    changed_by: version.changed_by,
    created_at: version.created_at,
    body_chars: version.body.length,
    ...(opts.includeBody ? { body: version.body } : {}),
    ...(!opts.includeBody ? { body_preview: truncateText(version.body, opts.bodyPreviewChars ?? 120) } : {}),
  }
}

export function toScheduleSummary(schedule: PromptSchedule, opts: { includeVars?: boolean } = {}) {
  const varsJson = JSON.stringify(schedule.vars)
  return {
    id: schedule.id,
    prompt_id: schedule.prompt_id,
    prompt_slug: schedule.prompt_slug,
    cron: schedule.cron,
    agent_id: schedule.agent_id,
    last_run_at: schedule.last_run_at,
    next_run_at: schedule.next_run_at,
    run_count: schedule.run_count,
    created_at: schedule.created_at,
    vars_keys: Object.keys(schedule.vars),
    vars_chars: varsJson.length,
    ...(opts.includeVars ? { vars: schedule.vars } : {}),
  }
}

export function pageItems<T>(items: T[], limit: number, offset = 0): {
  items: T[]
  total: number
  limit: number
  offset: number
  has_more: boolean
  next_offset: number | null
} {
  const safeLimit = Math.max(1, limit)
  const safeOffset = Math.max(0, offset)
  const page = items.slice(safeOffset, safeOffset + safeLimit)
  const nextOffset = safeOffset + page.length
  return {
    items: page,
    total: items.length,
    limit: safeLimit,
    offset: safeOffset,
    has_more: nextOffset < items.length,
    next_offset: nextOffset < items.length ? nextOffset : null,
  }
}
