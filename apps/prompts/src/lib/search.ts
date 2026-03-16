import { getDatabase, hasFts } from "../db/database.js"
import type { SlimSearchResult, SearchResult, ListPromptsFilter } from "../types/index.js"
import { listPrompts, listPromptsSlim } from "../db/prompts.js"

function rowToSlimSearchResult(row: Record<string, unknown>, snippet?: string): SlimSearchResult {
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
    use_count: row["use_count"] as number,
    score: (row["score"] as number) ?? 1,
    snippet,
  }
}

// Keep full search result for internal use (CLI, server)
function rowToSearchResult(row: Record<string, unknown>, snippet?: string): SearchResult {
  return {
    prompt: {
      id: row["id"] as string,
      name: row["name"] as string,
      slug: row["slug"] as string,
      title: row["title"] as string,
      body: row["body"] as string,
      description: (row["description"] as string | null) ?? null,
      collection: row["collection"] as string,
      tags: JSON.parse((row["tags"] as string) || "[]") as string[],
      variables: JSON.parse((row["variables"] as string) || "[]") as [],
      pinned: Boolean(row["pinned"]),
      next_prompt: (row["next_prompt"] as string | null) ?? null,
      expires_at: (row["expires_at"] as string | null) ?? null,
      project_id: (row["project_id"] as string | null) ?? null,
      is_template: Boolean(row["is_template"]),
      source: row["source"] as "manual" | "ai-session" | "imported",
      version: row["version"] as number,
      use_count: row["use_count"] as number,
      last_used_at: (row["last_used_at"] as string | null) ?? null,
      created_at: row["created_at"] as string,
      updated_at: row["updated_at"] as string,
    },
    score: (row["score"] as number) ?? 1,
    snippet,
  }
}

function escapeFtsQuery(q: string): string {
  // Wrap each word in prefix match
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`)
    .join(" ")
}

export function searchPrompts(
  query: string,
  filter: Omit<ListPromptsFilter, "q"> = {}
): SearchResult[] {
  const db = getDatabase()

  if (!query.trim()) {
    const prompts = listPrompts(filter)
    return prompts.map((p) => ({ prompt: p, score: 1 }))
  }

  if (hasFts(db)) {
    const ftsQuery = escapeFtsQuery(query)

    const conditions: string[] = []
    const params: (string | number)[] = []

    if (filter.collection) {
      conditions.push("p.collection = ?")
      params.push(filter.collection)
    }
    if (filter.is_template !== undefined) {
      conditions.push("p.is_template = ?")
      params.push(filter.is_template ? 1 : 0)
    }
    if (filter.source) {
      conditions.push("p.source = ?")
      params.push(filter.source)
    }
    if (filter.tags && filter.tags.length > 0) {
      const tagConds = filter.tags.map(() => "p.tags LIKE ?")
      conditions.push(`(${tagConds.join(" OR ")})`)
      for (const tag of filter.tags) params.push(`%"${tag}"%`)
    }
    if (filter.project_id !== undefined && filter.project_id !== null) {
      conditions.push("(p.project_id = ? OR p.project_id IS NULL)")
      params.push(filter.project_id)
    }

    const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""
    const limit = filter.limit ?? 50
    const offset = filter.offset ?? 0

    try {
      const rows = db
        .query(
          `SELECT p.*, bm25(prompts_fts) as score,
            snippet(prompts_fts, 2, '[', ']', '...', 10) as snippet
           FROM prompts p
           INNER JOIN prompts_fts ON prompts_fts.rowid = p.rowid
           WHERE prompts_fts MATCH ?
           ${where}
           ORDER BY bm25(prompts_fts)
           LIMIT ? OFFSET ?`
        )
        .all(ftsQuery, ...params, limit, offset) as Array<Record<string, unknown>>

      return rows.map((r) => rowToSearchResult(r, r["snippet"] as string | undefined))
    } catch {
      // FTS query syntax error — fall through to LIKE
    }
  }

  // Fallback: LIKE search
  const like = `%${query}%`
  const rows = db
    .query(
      `SELECT *, 1 as score FROM prompts
       WHERE (name LIKE ? OR slug LIKE ? OR title LIKE ? OR body LIKE ? OR description LIKE ? OR tags LIKE ?)
       ORDER BY use_count DESC, updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(like, like, like, like, like, like, filter.limit ?? 10, filter.offset ?? 0) as Array<Record<string, unknown>>

  return rows.map((r) => rowToSearchResult(r))
}

/** Slim search — returns only metadata + snippet, no body. Default for MCP. */
export function searchPromptsSlim(
  query: string,
  filter: Omit<ListPromptsFilter, "q"> = {}
): SlimSearchResult[] {
  const db = getDatabase()

  if (!query.trim()) {
    return listPromptsSlim(filter).map((p) => ({
      id: p.id, slug: p.slug, title: p.title, description: p.description,
      collection: p.collection, tags: p.tags, variable_names: p.variable_names,
      is_template: p.is_template, use_count: p.use_count, score: 1,
    }))
  }

  if (hasFts(db)) {
    const ftsQuery = escapeFtsQuery(query)
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (filter.collection) { conditions.push("p.collection = ?"); params.push(filter.collection) }
    if (filter.is_template !== undefined) { conditions.push("p.is_template = ?"); params.push(filter.is_template ? 1 : 0) }
    if (filter.source) { conditions.push("p.source = ?"); params.push(filter.source) }
    if (filter.tags && filter.tags.length > 0) {
      const tagConds = filter.tags.map(() => "p.tags LIKE ?")
      conditions.push(`(${tagConds.join(" OR ")})`)
      for (const tag of filter.tags) params.push(`%"${tag}"%`)
    }
    if (filter.project_id) { conditions.push("(p.project_id = ? OR p.project_id IS NULL)"); params.push(filter.project_id) }

    const where = conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : ""
    const limit = filter.limit ?? 10
    const offset = filter.offset ?? 0

    try {
      // Select without body
      const rows = db.query(
        `SELECT p.id, p.slug, p.name, p.title, p.description, p.collection, p.tags, p.variables,
                p.is_template, p.use_count, bm25(prompts_fts) as score,
                snippet(prompts_fts, 2, '[', ']', '...', 10) as snippet
         FROM prompts p
         INNER JOIN prompts_fts ON prompts_fts.rowid = p.rowid
         WHERE prompts_fts MATCH ?
         ${where}
         ORDER BY bm25(prompts_fts)
         LIMIT ? OFFSET ?`
      ).all(ftsQuery, ...params, limit, offset) as Array<Record<string, unknown>>

      return rows.map((r) => rowToSlimSearchResult(r, r["snippet"] as string | undefined))
    } catch { /* fall through */ }
  }

  // Fallback LIKE
  const like = `%${query}%`
  const rows = db.query(
    `SELECT id, slug, name, title, description, collection, tags, variables, is_template, use_count, 1 as score
     FROM prompts
     WHERE (name LIKE ? OR slug LIKE ? OR title LIKE ? OR body LIKE ? OR description LIKE ? OR tags LIKE ?)
     ORDER BY use_count DESC, updated_at DESC
     LIMIT ? OFFSET ?`
  ).all(like, like, like, like, like, like, filter.limit ?? 10, filter.offset ?? 0) as Array<Record<string, unknown>>

  return rows.map((r) => rowToSlimSearchResult(r))
}

export function findSimilar(promptId: string, limit = 5): SearchResult[] {
  const db = getDatabase()
  const prompt = db.query("SELECT * FROM prompts WHERE id = ?").get(promptId) as Record<string, unknown> | null
  if (!prompt) return []

  const tags = JSON.parse((prompt["tags"] as string) || "[]") as string[]
  const collection = prompt["collection"] as string

  if (tags.length === 0) {
    // Fall back to same collection
    const rows = db
      .query(
        "SELECT *, 1 as score FROM prompts WHERE collection = ? AND id != ? ORDER BY use_count DESC LIMIT ?"
      )
      .all(collection, promptId, limit) as Array<Record<string, unknown>>
    return rows.map((r) => rowToSearchResult(r))
  }

  // Score by tag overlap
  const allRows = db
    .query("SELECT * FROM prompts WHERE id != ?")
    .all(promptId) as Array<Record<string, unknown>>

  const scored = allRows.map((row) => {
    const rowTags = JSON.parse((row["tags"] as string) || "[]") as string[]
    const overlap = rowTags.filter((t) => tags.includes(t)).length
    const sameCollection = row["collection"] === collection ? 1 : 0
    return { row, score: overlap * 2 + sameCollection }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => rowToSearchResult(s.row, undefined))
}
