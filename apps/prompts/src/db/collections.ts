import { getDatabase } from "./database.js"
import type { Collection } from "../types/index.js"
import { generateId } from "../lib/ids.js"

function rowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    description: (row["description"] as string | null) ?? null,
    prompt_count: (row["prompt_count"] as number) ?? 0,
    created_at: row["created_at"] as string,
  }
}

export function listCollections(): Collection[] {
  const db = getDatabase()
  const rows = db
    .query(
      `SELECT c.*, COUNT(p.id) as prompt_count
       FROM collections c
       LEFT JOIN prompts p ON p.collection = c.name
       GROUP BY c.id
       ORDER BY c.name`
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(rowToCollection)
}

export function getCollection(name: string): Collection | null {
  const db = getDatabase()
  const row = db
    .query(
      `SELECT c.*, COUNT(p.id) as prompt_count
       FROM collections c
       LEFT JOIN prompts p ON p.collection = c.name
       WHERE c.name = ?
       GROUP BY c.id`
    )
    .get(name) as Record<string, unknown> | null
  if (!row) return null
  return rowToCollection(row)
}

export function ensureCollection(name: string, description?: string): Collection {
  const db = getDatabase()
  const existing = db.query("SELECT id FROM collections WHERE name = ?").get(name)
  if (!existing) {
    const id = generateId("COL")
    db.run("INSERT INTO collections (id, name, description) VALUES (?, ?, ?)", [
      id,
      name,
      description ?? null,
    ])
  }
  return getCollection(name)!
}

export function movePrompt(promptIdOrSlug: string, targetCollection: string): void {
  const db = getDatabase()
  ensureCollection(targetCollection)

  // Resolve by id or slug
  const row = db
    .query("SELECT id FROM prompts WHERE id = ? OR slug = ?")
    .get(promptIdOrSlug, promptIdOrSlug) as { id: string } | null
  if (!row) throw new Error(`Prompt not found: ${promptIdOrSlug}`)

  db.run("UPDATE prompts SET collection = ?, updated_at = datetime('now') WHERE id = ?", [
    targetCollection,
    row.id,
  ])
}
