/**
 * Slim prompt — no body, no full variable details.
 * Returned by list/search/stats/recent/stale/trending by default.
 * Saves tokens — use prompts_use / prompts_get / prompts_body to get the actual body.
 */
export interface SlimPrompt {
  id: string
  slug: string
  title: string
  description: string | null
  collection: string
  tags: string[]
  variable_names: string[]
  is_template: boolean
  source: PromptSource
  pinned: boolean
  next_prompt: string | null
  expires_at: string | null
  project_id: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface Prompt {
  id: string
  name: string
  slug: string
  title: string
  body: string
  description: string | null
  collection: string
  tags: string[]
  variables: TemplateVariable[]
  is_template: boolean
  source: PromptSource
  pinned: boolean
  next_prompt: string | null
  expires_at: string | null
  project_id: string | null
  version: number
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  name: string
  slug: string
  description: string | null
  path: string | null
  prompt_count: number
  created_at: string
}

export interface TemplateVariable {
  name: string
  description?: string
  default?: string
  required: boolean
}

export interface PromptVersion {
  id: string
  prompt_id: string
  body: string
  version: number
  changed_by: string | null
  created_at: string
}

export interface Collection {
  id: string
  name: string
  description: string | null
  prompt_count: number
  created_at: string
}

export interface Agent {
  id: string
  name: string
  description: string | null
  created_at: string
  last_seen_at: string
}

export type PromptSource = "manual" | "ai-session" | "imported"

export interface CreatePromptInput {
  name?: string
  slug?: string
  title: string
  body: string
  description?: string
  collection?: string
  tags?: string[]
  source?: PromptSource
  changed_by?: string
  project_id?: string | null
}

export interface UpdatePromptInput {
  title?: string
  body?: string
  description?: string
  collection?: string
  tags?: string[]
  next_prompt?: string | null
  changed_by?: string
}

export interface ListPromptsFilter {
  collection?: string
  tags?: string[]
  is_template?: boolean
  source?: PromptSource
  q?: string
  limit?: number
  offset?: number
  project_id?: string | null
}

export interface SearchResult {
  prompt: Prompt
  score: number
  snippet?: string
}

/** Slim search result — body replaced by snippet, no full prompt */
export interface SlimSearchResult {
  id: string
  slug: string
  title: string
  description: string | null
  collection: string
  tags: string[]
  is_template: boolean
  variable_names: string[]
  use_count: number
  score: number
  snippet?: string
}

/** Returned by save/update to avoid echoing back the full body */
export interface SaveResult {
  id: string
  slug: string
  title: string
  collection: string
  is_template: boolean
  variable_names: string[]
  created: boolean
  duplicate_warning?: string | null
}

export interface RenderResult {
  rendered: string
  missing_vars: string[]
  used_defaults: string[]
}

export interface PromptStats {
  total_prompts: number
  total_templates: number
  total_collections: number
  most_used: Array<{ id: string; name: string; slug: string; title: string; use_count: number }>
  recently_used: Array<{ id: string; name: string; slug: string; title: string; last_used_at: string }>
  by_collection: Array<{ collection: string; count: number }>
  by_source: Array<{ source: string; count: number }>
}

export class PromptNotFoundError extends Error {
  constructor(id: string) {
    super(`Prompt not found: ${id}`)
    this.name = "PromptNotFoundError"
  }
}

export class VersionConflictError extends Error {
  constructor(id: string) {
    super(`Version conflict on prompt: ${id}`)
    this.name = "VersionConflictError"
  }
}

export class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`A prompt with slug "${slug}" already exists`)
    this.name = "DuplicateSlugError"
  }
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TemplateRenderError"
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`)
    this.name = "ProjectNotFoundError"
  }
}
