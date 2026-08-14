import { getDatabase, resolveProject } from "./database.js"
import { generateId, generateSlug } from "../lib/ids.js"
import type { Project } from "../types/index.js"
import { ProjectNotFoundError } from "../types/index.js"

function rowToProject(row: Record<string, unknown>, promptCount: number): Project {
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    slug: row["slug"] as string,
    description: (row["description"] as string | null) ?? null,
    path: (row["path"] as string | null) ?? null,
    prompt_count: promptCount,
    created_at: row["created_at"] as string,
  }
}

export function createProject(input: { name: string; description?: string; path?: string }): Project {
  const db = getDatabase()
  const id = generateId("proj")
  const slug = generateSlug(input.name)

  db.run(
    `INSERT INTO projects (id, name, slug, description, path) VALUES (?, ?, ?, ?, ?)`,
    [id, input.name, slug, input.description ?? null, input.path ?? null]
  )

  return getProject(id)!
}

export function getProject(idOrSlug: string): Project | null {
  const db = getDatabase()
  const id = resolveProject(db, idOrSlug)
  if (!id) return null

  const row = db.query("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | null
  if (!row) return null

  const countRow = db.query("SELECT COUNT(*) as n FROM prompts WHERE project_id = ?").get(id as string) as { n: number }
  return rowToProject(row, countRow.n)
}

export function listProjects(): Project[] {
  const db = getDatabase()
  const rows = db.query("SELECT * FROM projects ORDER BY name ASC").all() as Array<Record<string, unknown>>
  return rows.map((row) => {
    const countRow = db.query("SELECT COUNT(*) as n FROM prompts WHERE project_id = ?").get(row["id"] as string) as { n: number }
    return rowToProject(row, countRow.n)
  })
}

export function deleteProject(idOrSlug: string): void {
  const db = getDatabase()
  const id = resolveProject(db, idOrSlug)
  if (!id) throw new ProjectNotFoundError(idOrSlug)
  db.run("DELETE FROM projects WHERE id = ?", [id])
}
