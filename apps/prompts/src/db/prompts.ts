import { getDatabase, resolvePrompt } from "./database.js"
import { generatePromptId, generateSlug, uniqueSlug } from "../lib/ids.js"
import { ensureCollection } from "./collections.js"
import { findDuplicates } from "../lib/duplicates.js"
import { extractVariableInfo } from "../lib/template.js"
import { syncPromptVariables, loadPromptVariablesForPrompts } from "./variables.js"
import { setLabel } from "./labels.js"
import { setParent, removeDependency } from "./dependencies.js"
import type {
  Prompt,
  SlimPrompt,
  SaveResult,
  CreatePromptInput,
  UpdatePromptInput,
  ListPromptsFilter,
  PromptSource,
  TemplateVariable,
} from "../types/index.js"
import { PromptNotFoundError, VersionConflictError, DuplicateSlugError } from "../types/index.js"
import { generateId } from "../lib/ids.js"

function rowToSlimPrompt(row: Record<string, unknown>): SlimPrompt {
  const variables = JSON.parse((row["variables"] as string) || "[]") as Array<{ name: string }>
  return {
    id: row["id"] as string,
    slug: row["slug"] as string,
    title: row["title"] as string,
    description: (row["description"] as string | null) ?? null,
    collection: row["collection"] as string,
    tags: JSON.parse((row["tags"] as string) || "[]") as string[],
    variable_names: variables.map((v) => v.name),
    is_template: Boolean(row["is_template"]),
    source: row["source"] as PromptSource,
    pinned: Boolean(row["pinned"]),
    next_prompt: (row["next_prompt"] as string | null) ?? null,
    expires_at: (row["expires_at"] as string | null) ?? null,
    project_id: (row["project_id"] as string | null) ?? null,
    use_count: row["use_count"] as number,
    last_used_at: (row["last_used_at"] as string | null) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  }
}

export function promptToSaveResult(prompt: Prompt, created: boolean, duplicate_warning?: string | null): SaveResult {
  return {
    id: prompt.id,
    slug: prompt.slug,
    title: prompt.title,
    collection: prompt.collection,
    is_template: prompt.is_template,
    variable_names: prompt.variables.map((v) => v.name),
    created,
    duplicate_warning: duplicate_warning ?? null,
  }
}

function rowToPrompt(row: Record<string, unknown>, persistedVariables?: TemplateVariable[]): Prompt {
  const legacyVariables = JSON.parse((row["variables"] as string) || "[]") as TemplateVariable[]
  // prompt_variables is authoritative when populated; fall back to the legacy JSON column.
  const variables = persistedVariables && persistedVariables.length > 0 ? persistedVariables : legacyVariables
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    title: row["title"] as string,
    body: row["body"] as string,
    description: (row["description"] as string | null) ?? null,
    collection: row["collection"] as string,
    tags: JSON.parse((row["tags"] as string) || "[]") as string[],
    variables,
    pinned: Boolean(row["pinned"]),
    next_prompt: (row["next_prompt"] as string | null) ?? null,
    expires_at: (row["expires_at"] as string | null) ?? null,
    project_id: (row["project_id"] as string | null) ?? null,
    is_template: Boolean(row["is_template"]),
    source: row["source"] as PromptSource,
    version: row["version"] as number,
    use_count: row["use_count"] as number,
    last_used_at: (row["last_used_at"] as string | null) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  }
}

export function createPrompt(input: CreatePromptInput): Prompt {
  const db = getDatabase()

  const slug = input.slug
    ? input.slug
    : uniqueSlug(generateSlug(input.title))

  // Check slug uniqueness if provided explicitly
  if (input.slug) {
    const existing = db.query("SELECT id FROM prompts WHERE slug = ?").get(input.slug)
    if (existing) throw new DuplicateSlugError(input.slug)
  }

  const id = generatePromptId()
  const name = input.name || input.title
  const collection = input.collection || "default"
  ensureCollection(collection)
  const tags = JSON.stringify(input.tags || [])
  const source = input.source || "manual"
  const project_id = input.project_id ?? null

  // Auto-detect template variables and persist real metadata
  // (required reflects the presence of an inline default; typed metadata overlays via var_schema).
  const variableInfos = extractVariableInfo(input.body)
  const variables = JSON.stringify(
    variableInfos.map((v) => ({ name: v.name, required: v.required }))
  )
  const is_template = variableInfos.length > 0 ? 1 : 0

  db.run(
    `INSERT INTO prompts (id, name, slug, title, body, description, collection, tags, variables, is_template, source, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, slug, input.title, input.body, input.description ?? null, collection, tags, variables, is_template, source, project_id]
  )

  // Persist typed variable metadata in prompt_variables (source of truth for types/descriptions).
  syncPromptVariables(id, input.body, input.var_schema ?? [])

  // Exact labels.
  for (const label of input.labels ?? []) {
    setLabel(id, label.key, label.value)
  }

  // One optional parent (no multiple inheritance).
  if (input.extends_prompt) {
    setParent(id, input.extends_prompt)
  }

  // Save initial version
  db.run(
    `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by)
     VALUES (?, ?, ?, 1, ?)`,
    [generateId("VER"), id, input.body, input.changed_by ?? null]
  )

  return getPrompt(id)!
}

export function getPrompt(idOrSlug: string): Prompt | null {
  const db = getDatabase()
  const id = resolvePrompt(db, idOrSlug)
  if (!id) return null
  const row = db.query("SELECT * FROM prompts WHERE id = ?").get(id) as Record<string, unknown> | null
  if (!row) return null
  return rowToPrompt(row, loadPromptVariablesForPrompts([id]).get(id))
}

export function requirePrompt(idOrSlug: string): Prompt {
  const prompt = getPrompt(idOrSlug)
  if (!prompt) throw new PromptNotFoundError(idOrSlug)
  return prompt
}

export function listPrompts(filter: ListPromptsFilter = {}): Prompt[] {
  const db = getDatabase()
  const conditions: string[] = []
  const params: (string | number)[] = []
  const orderParams: (string | number)[] = []

  if (filter.collection) {
    conditions.push("collection = ?")
    params.push(filter.collection)
  }
  if (filter.is_template !== undefined) {
    conditions.push("is_template = ?")
    params.push(filter.is_template ? 1 : 0)
  }
  if (filter.source) {
    conditions.push("source = ?")
    params.push(filter.source)
  }
  if (filter.tags && filter.tags.length > 0) {
    // Match any of the tags (JSON contains)
    const tagConditions = filter.tags.map(() => "tags LIKE ?")
    conditions.push(`(${tagConditions.join(" OR ")})`)
    for (const tag of filter.tags) {
      params.push(`%"${tag}"%`)
    }
  }
  if (filter.labels && filter.labels.length > 0) {
    for (const label of filter.labels) {
      conditions.push(
        "EXISTS (SELECT 1 FROM prompt_labels pl WHERE pl.prompt_id = prompts.id AND pl.key = ? AND pl.value = ?)"
      )
      params.push(label.key, label.value)
    }
  }

  let orderBy = "pinned DESC, use_count DESC, updated_at DESC"

  if (filter.project_id !== undefined && filter.project_id !== null) {
    // Show project prompts + global prompts, project prompts first
    conditions.push("(project_id = ? OR project_id IS NULL)")
    params.push(filter.project_id)
    orderBy = "(CASE WHEN project_id = ? THEN 0 ELSE 1 END), pinned DESC, use_count DESC, updated_at DESC"
    orderParams.push(filter.project_id)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ?? 20
  const offset = filter.offset ?? 0

  const rows = db
    .query(`SELECT * FROM prompts ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, ...orderParams, limit, offset) as Array<Record<string, unknown>>

  const varsByPrompt = loadPromptVariablesForPrompts(rows.map((r) => r["id"] as string))
  return rows.map((row) => rowToPrompt(row, varsByPrompt.get(row["id"] as string)))
}

/** Slim version of listPrompts — no body, no full variables. Default for MCP listing. */
export function listPromptsSlim(filter: ListPromptsFilter = {}): SlimPrompt[] {
  const db = getDatabase()
  const conditions: string[] = []
  const params: (string | number)[] = []
  const orderParams: (string | number)[] = []

  if (filter.collection) { conditions.push("collection = ?"); params.push(filter.collection) }
  if (filter.is_template !== undefined) { conditions.push("is_template = ?"); params.push(filter.is_template ? 1 : 0) }
  if (filter.source) { conditions.push("source = ?"); params.push(filter.source) }
  if (filter.tags && filter.tags.length > 0) {
    const tagConds = filter.tags.map(() => "tags LIKE ?")
    conditions.push(`(${tagConds.join(" OR ")})`)
    for (const tag of filter.tags) params.push(`%"${tag}"%`)
  }
  if (filter.labels && filter.labels.length > 0) {
    for (const label of filter.labels) {
      conditions.push(
        "EXISTS (SELECT 1 FROM prompt_labels pl WHERE pl.prompt_id = prompts.id AND pl.key = ? AND pl.value = ?)"
      )
      params.push(label.key, label.value)
    }
  }

  let orderBy = "pinned DESC, use_count DESC, updated_at DESC"
  if (filter.project_id) {
    conditions.push("(project_id = ? OR project_id IS NULL)")
    params.push(filter.project_id)
    orderBy = "(CASE WHEN project_id = ? THEN 0 ELSE 1 END), pinned DESC, use_count DESC, updated_at DESC"
    orderParams.push(filter.project_id)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ?? 20
  const offset = filter.offset ?? 0

  // Select only needed columns — no body
  const rows = db
    .query(`SELECT id, slug, name, title, description, collection, tags, variables, is_template, source, pinned, next_prompt, expires_at, project_id, use_count, last_used_at, created_at, updated_at FROM prompts ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, ...orderParams, limit, offset) as Array<Record<string, unknown>>

  return rows.map(rowToSlimPrompt)
}

export function updatePrompt(idOrSlug: string, input: UpdatePromptInput): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)

  const newBody = input.body ?? prompt.body
  const mergedVariables = syncPromptVariables(prompt.id, newBody, input.var_schema ?? [])
  const variables = JSON.stringify(
    mergedVariables.map((v) => ({
      name: v.name,
      required: v.required,
      ...(v.description !== undefined ? { description: v.description } : {}),
    }))
  )
  const is_template = mergedVariables.length > 0 ? 1 : 0

  const updated = db.run(
    `UPDATE prompts SET
      title = COALESCE(?, title),
      body = COALESCE(?, body),
      description = COALESCE(?, description),
      collection = COALESCE(?, collection),
      tags = COALESCE(?, tags),
      next_prompt = CASE WHEN ? IS NOT NULL THEN ? ELSE next_prompt END,
      variables = ?,
      is_template = ?,
      version = version + 1,
      updated_at = datetime('now')
     WHERE id = ? AND version = ?`,
    [
      input.title ?? null,
      input.body ?? null,
      input.description ?? null,
      input.collection ?? null,
      input.tags ? JSON.stringify(input.tags) : null,
      "next_prompt" in input ? (input.next_prompt ?? "") : null,
      "next_prompt" in input ? (input.next_prompt ?? null) : null,
      variables,
      is_template,
      prompt.id,
      prompt.version,
    ]
  )

  if (updated.changes === 0) throw new VersionConflictError(prompt.id)

  // Labels
  for (const label of input.labels ?? []) {
    setLabel(prompt.id, label.key, label.value)
  }

  // One optional parent: explicit value sets, null clears.
  if ("extends_prompt" in input) {
    if (input.extends_prompt) {
      setParent(prompt.id, input.extends_prompt)
    } else {
      removeDependency(prompt.id, "parent")
    }
  }

  // Save version snapshot if body changed
  if (input.body && input.body !== prompt.body) {
    db.run(
      `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by)
       VALUES (?, ?, ?, ?, ?)`,
      [generateId("VER"), prompt.id, input.body, prompt.version + 1, input.changed_by ?? null]
    )
  }

  return requirePrompt(prompt.id)
}

export function deletePrompt(idOrSlug: string): void {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)
  db.run("DELETE FROM prompts WHERE id = ?", [prompt.id])
}

export function usePrompt(idOrSlug: string): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)
  db.run(
    "UPDATE prompts SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?",
    [prompt.id]
  )
  db.run("INSERT INTO usage_log (id, prompt_id) VALUES (?, ?)", [generateId("UL"), prompt.id])
  return requirePrompt(prompt.id)
}

export function getTrending(days = 7, limit = 10, projectId?: string | null): Array<{ id: string; slug: string; title: string; uses: number }> {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const projectFilter = projectId ? "AND (p.project_id = ? OR p.project_id IS NULL)" : ""
  const rows = db.query(
    `SELECT p.id, p.slug, p.title, COUNT(ul.id) as uses
     FROM usage_log ul
     JOIN prompts p ON p.id = ul.prompt_id
     WHERE ul.used_at >= ?
     ${projectFilter}
     GROUP BY p.id
     ORDER BY uses DESC
     LIMIT ?`
  )
  if (projectId) {
    return rows.all(cutoff, projectId, limit) as Array<{ id: string; slug: string; title: string; uses: number }>
  }
  return rows.all(cutoff, limit) as Array<{ id: string; slug: string; title: string; uses: number }>
}

export function setExpiry(idOrSlug: string, expiresAt: string | null): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)
  db.run("UPDATE prompts SET expires_at = ?, updated_at = datetime('now') WHERE id = ?", [expiresAt, prompt.id])
  return requirePrompt(prompt.id)
}

export function setNextPrompt(idOrSlug: string, nextSlug: string | null): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)
  db.run("UPDATE prompts SET next_prompt = ?, updated_at = datetime('now') WHERE id = ?", [nextSlug, prompt.id])
  return requirePrompt(prompt.id)
}

export function pinPrompt(idOrSlug: string, pinned: boolean): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)
  db.run("UPDATE prompts SET pinned = ?, updated_at = datetime('now') WHERE id = ?", [pinned ? 1 : 0, prompt.id])
  return requirePrompt(prompt.id)
}

export function upsertPrompt(input: CreatePromptInput, force = false): { prompt: Prompt; created: boolean; duplicate_warning?: string } {
  const db = getDatabase()
  const slug = input.slug || generateSlug(input.title)
  const existing = db.query("SELECT id FROM prompts WHERE slug = ?").get(slug) as { id: string } | null

  if (existing) {
    const update: UpdatePromptInput = {
      title: input.title,
      body: input.body,
      description: input.description,
      collection: input.collection,
      tags: input.tags,
      changed_by: input.changed_by,
      var_schema: input.var_schema,
      labels: input.labels,
    }
    // Only an explicit extends value (or null to clear) touches the parent dependency.
    if (input.extends_prompt !== undefined) update.extends_prompt = input.extends_prompt
    const prompt = updatePrompt(existing.id, update)
    return { prompt, created: false }
  }

  // Check for near-duplicates unless force=true
  let duplicate_warning: string | undefined
  if (!force && input.body) {
    const dupes = findDuplicates(input.body, 0.8, slug)
    if (dupes.length > 0) {
      const top = dupes[0]!
      duplicate_warning = `Similar prompt already exists: "${top.prompt.slug}" (${Math.round(top.score * 100)}% match). Use --force to save anyway.`
    }
  }

  const prompt = createPrompt({ ...input, slug })
  return { prompt, created: true, duplicate_warning }
}

export function getPromptStats() {
  const db = getDatabase()
  const total = (db.query("SELECT COUNT(*) as n FROM prompts").get() as { n: number }).n
  const templates = (db.query("SELECT COUNT(*) as n FROM prompts WHERE is_template = 1").get() as { n: number }).n
  const collections = (db.query("SELECT COUNT(DISTINCT collection) as n FROM prompts").get() as { n: number }).n
  const mostUsed = db
    .query("SELECT id, name, slug, title, use_count FROM prompts WHERE use_count > 0 ORDER BY use_count DESC LIMIT 10")
    .all() as Array<{ id: string; name: string; slug: string; title: string; use_count: number }>
  const recentlyUsed = db
    .query("SELECT id, name, slug, title, last_used_at FROM prompts WHERE last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 10")
    .all() as Array<{ id: string; name: string; slug: string; title: string; last_used_at: string }>
  const byCollection = db
    .query("SELECT collection, COUNT(*) as count FROM prompts GROUP BY collection ORDER BY count DESC")
    .all() as Array<{ collection: string; count: number }>
  const bySource = db
    .query("SELECT source, COUNT(*) as count FROM prompts GROUP BY source ORDER BY count DESC")
    .all() as Array<{ source: string; count: number }>

  return { total_prompts: total, total_templates: templates, total_collections: collections, most_used: mostUsed, recently_used: recentlyUsed, by_collection: byCollection, by_source: bySource }
}
