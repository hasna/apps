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

export type TemplateValueType = "string" | "number" | "boolean" | "object" | "array"
export type TemplateRenderFormat = "json" | "json-pretty" | "string"

export interface TemplateVariable {
  name: string
  type?: TemplateValueType
  description?: string
  /** Inline string default from the body ({{name|default}}) */
  default?: string
  /** Typed default value (persisted JSON) */
  typed_default?: unknown
  required: boolean
  /** JSON-serialized validation constraints: { pattern?, min?, max?, minLength?, maxLength?, enum? } */
  validation?: string
  render_format?: TemplateRenderFormat
}

/** Input shape for declaring typed variable metadata (save/update --var-schema). */
export interface VariableSchemaEntry {
  name: string
  type?: TemplateValueType
  required?: boolean
  /** Typed default value */
  default?: unknown
  description?: string
  validation?: string
  render_format?: TemplateRenderFormat
}

export interface PromptLabel {
  id: string
  prompt_id: string
  key: string
  value: string
  created_at: string
}

export type PromptDependencyRelation = "parent" | "partial"

export interface PromptDependency {
  id: string
  prompt_id: string
  dependency_prompt_id: string
  dependency_slug: string
  relation: PromptDependencyRelation
  slot: string | null
  pinned_version: number | null
  ordering: number
  created_at: string
}

export interface ResolvedSource {
  id: string
  version: number
  relation: "self" | "parent" | "partial"
  slot?: string | null
}

export interface RenderReceipt {
  id: string
  prompt_id: string
  prompt_version: number
  resolved_sources: ResolvedSource[]
  render_hash: string
  missing_vars: string[]
  used_defaults: string[]
  created_at: string
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
  var_schema?: VariableSchemaEntry[]
  labels?: Array<{ key: string; value: string }>
  /** One optional parent prompt (slug or id). No multiple inheritance. */
  extends_prompt?: string | null
}

export interface UpdatePromptInput {
  title?: string
  body?: string
  description?: string
  collection?: string
  tags?: string[]
  next_prompt?: string | null
  changed_by?: string
  var_schema?: VariableSchemaEntry[]
  labels?: Array<{ key: string; value: string }>
  /** One optional parent prompt (slug or id). null clears. */
  extends_prompt?: string | null
}

export interface ListPromptsFilter {
  collection?: string
  tags?: string[]
  labels?: Array<{ key: string; value: string }>
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
  /** Visible [UNRESOLVED ...] markers placed in preview mode */
  unresolved?: string[]
  /** Prompt sources resolved during dependency-aware rendering */
  resolved_sources?: ResolvedSource[]
  /** Resolved integration source ids/versions — render receipt. */
  resolved_integrations?: Array<{
    kind: string
    ref: string
    source_id: string
    source_version: string | number | null
    projection: string
  }>
  /** Unresolved integration refs with their named codes — render receipt. */
  unresolved_integrations?: Array<{
    kind: string
    ref: string
    code: string
  }>
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
  /** Machine-readable failure code: MISSING_VARIABLE, PARTIAL_NOT_FOUND, TEMPLATE_CYCLE, ... */
  code?: string
  /** Names of missing required variables (code MISSING_VARIABLE) */
  missing?: string[]
  constructor(message: string, code?: string, missing?: string[]) {
    super(message)
    this.name = "TemplateRenderError"
    this.code = code
    this.missing = missing
  }
}

export class ProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Project not found: ${id}`)
    this.name = "ProjectNotFoundError"
  }
}
