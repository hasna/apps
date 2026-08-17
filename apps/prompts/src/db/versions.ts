import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import { writePromptBodyObject, registerBodyObject, getBodyStore } from "../storage/bodies.js"
import { feedContentlessFts } from "./prompts.js"
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

export async function restoreVersion(promptId: string, version: number, changedBy?: string): Promise<void> {
  const db = getDatabase()
  const ver = getVersion(promptId, version)
  if (!ver) throw new PromptNotFoundError(`${promptId}@v${version}`)

  const current = db.query("SELECT version FROM prompts WHERE id = ?").get(promptId) as { version: number } | null
  if (!current) throw new PromptNotFoundError(promptId)

  const newVersion = current.version + 1

  // Object-first: restore writes a new immutable object for the next version.
  const bodyRecord = await writePromptBodyObject(getBodyStore(), promptId, newVersion, ver.body)

  db.run(
    `UPDATE prompts SET body = ?, version = ?, body_uri = ?, body_sha256 = ?, body_bytes = ?, body_media_type = ?,
     updated_at = datetime('now'),
     is_template = (CASE WHEN body LIKE '%{{%' THEN 1 ELSE 0 END)
     WHERE id = ?`,
    [ver.body, newVersion, bodyRecord.uri, bodyRecord.sha256, bodyRecord.bytes, bodyRecord.mediaType, promptId]
  )

  db.run(
    `INSERT INTO prompt_versions (id, prompt_id, body, version, changed_by, body_uri, body_sha256, body_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [generateId("VER"), promptId, ver.body, newVersion, changedBy ?? null,
      bodyRecord.uri, bodyRecord.sha256, bodyRecord.bytes]
  )
  registerBodyObject(bodyRecord.uri, bodyRecord.sha256, bodyRecord.bytes, bodyRecord.mediaType)

  const updated = db
    .query("SELECT name, slug, title, body, description, tags FROM prompts WHERE id = ?")
    .get(promptId) as { name: string; slug: string; title: string; body: string; description: string | null; tags: string } | null
  if (updated) {
    feedContentlessFts(promptId, {
      name: updated.name,
      slug: updated.slug,
      title: updated.title,
      body: updated.body,
      description: updated.description ?? "",
      tags: updated.tags,
    })
  }
}
