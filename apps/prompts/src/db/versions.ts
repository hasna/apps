import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import type { PromptVersion } from "../types/index.js"
import { PromptNotFoundError } from "../types/index.js"

function rowToVersion(row: Record<string, unknown>): PromptVersion {
  return {
    id: row["id"] as string,
    prompt_id: row["prompt_id"] as string,
    body: row["body"] as string,
    version: row["version"] as number,
    changed_by: (row["changed_by"] as string | null) ?? null,
    created_at: row["created_at"] as string,
  }
}

export function listVersions(promptId: string): PromptVersion[] {
  const db = getDatabase()
  const rows = db
    .query("SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY version DESC")
    .all(promptId) as Array<Record<string, unknown>>
  return rows.map(rowToVersion)
}

export function getVersion(promptId: string, version: number): PromptVersion | null {
  const db = getDatabase()
  const row = db
    .query("SELECT * FROM prompt_versions WHERE prompt_id = ? AND version = ?")
    .get(promptId, version) as Record<string, unknown> | null
  if (!row) return null
  return rowToVersion(row)
}

export function restoreVersion(promptId: string, version: number, changedBy?: string): void {
  const db = getDatabase()
  const ver = getVersion(promptId, version)
  if (!ver) throw new PromptNotFoundError(`${promptId}@v${version}`)

  const current = db.query("SELECT version FROM prompts WHERE id = ?").get(promptId) as { version: number } | null
  if (!current) throw new PromptNotFoundError(promptId)

  const newVersion = current.version + 1

  db.run(
    `UPDATE prompts SET body = ?, version = ?, updated_at = datetime('now'),
     is_template = (CASE WHEN body LIKE '%{{%' THEN 1 ELSE 0 END)
     WHERE id = ?`,
    [ver.body, newVersion, promptId]
  )

  db.run(
    `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [generateId("VER"), promptId, ver.body, newVersion, changedBy ?? null]
  )
}
