import { getDatabase, resolvePrompt } from "./database.js"
import { generatePromptId, generateSlug, uniqueSlug } from "../lib/ids.js"
import { ensureCollection } from "./collections.js"
import { extractVariables } from "../lib/template.js"
import type {
  Prompt,
  CreatePromptInput,
  UpdatePromptInput,
  ListPromptsFilter,
  PromptSource,
  TemplateVariable,
} from "../types/index.js"
import { PromptNotFoundError, VersionConflictError, DuplicateSlugError } from "../types/index.js"
import { generateId } from "../lib/ids.js"

function rowToPrompt(row: Record<string, unknown>): Prompt {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    title: row["title"] as string,
    body: row["body"] as string,
    description: (row["description"] as string | null) ?? null,
    collection: row["collection"] as string,
    tags: JSON.parse((row["tags"] as string) || "[]") as string[],
    variables: JSON.parse((row["variables"] as string) || "[]") as TemplateVariable[],
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

  // Auto-detect template variables
  const vars = extractVariables(input.body)
  const variables = JSON.stringify(
    vars.map((v) => ({ name: v, required: true }))
  )
  const is_template = vars.length > 0 ? 1 : 0

  db.run(
    `INSERT INTO prompts (id, name, slug, title, body, description, collection, tags, variables, is_template, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, name, slug, input.title, input.body, input.description ?? null, collection, tags, variables, is_template, source]
  )

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
  return rowToPrompt(row)
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ?? 100
  const offset = filter.offset ?? 0

  const rows = db
    .query(`SELECT * FROM prompts ${where} ORDER BY use_count DESC, updated_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<Record<string, unknown>>

  return rows.map(rowToPrompt)
}

export function updatePrompt(idOrSlug: string, input: UpdatePromptInput): Prompt {
  const db = getDatabase()
  const prompt = requirePrompt(idOrSlug)

  const newBody = input.body ?? prompt.body
  const vars = extractVariables(newBody)
  const variables = JSON.stringify(vars.map((v) => ({ name: v, required: true })))
  const is_template = vars.length > 0 ? 1 : 0

  const updated = db.run(
    `UPDATE prompts SET
      title = COALESCE(?, title),
      body = COALESCE(?, body),
      description = COALESCE(?, description),
      collection = COALESCE(?, collection),
      tags = COALESCE(?, tags),
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
      variables,
      is_template,
      prompt.id,
      prompt.version,
    ]
  )

  if (updated.changes === 0) throw new VersionConflictError(prompt.id)

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
  return requirePrompt(prompt.id)
}

export function upsertPrompt(input: CreatePromptInput): { prompt: Prompt; created: boolean } {
  const db = getDatabase()
  const slug = input.slug || generateSlug(input.title)
  const existing = db.query("SELECT id FROM prompts WHERE slug = ?").get(slug) as { id: string } | null

  if (existing) {
    const prompt = updatePrompt(existing.id, {
      title: input.title,
      body: input.body,
      description: input.description,
      collection: input.collection,
      tags: input.tags,
      changed_by: input.changed_by,
    })
    return { prompt, created: false }
  }

  const prompt = createPrompt({ ...input, slug })
  return { prompt, created: true }
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
