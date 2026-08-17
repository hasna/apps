import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import type { PromptLabel } from "../types/index.js"

interface LabelRow {
  id: string
  prompt_id: string
  key: string
  value: string
  created_at: string
}

function rowToLabel(row: LabelRow): PromptLabel {
  return { ...row }
}

/** Labels are normalized to trimmed lowercase keys and values for exact, indexed matching. */
export function normalizeLabelKey(key: string): string {
  return key.trim().toLowerCase()
}

export function normalizeLabelValue(value: string): string {
  return value.trim().toLowerCase()
}

/** Idempotent set: repeated key/value is a no-op (UNIQUE(prompt_id, key, value)). */
export function setLabel(promptId: string, key: string, value: string): PromptLabel {
  const db = getDatabase()
  const normalizedKey = normalizeLabelKey(key)
  const normalizedValue = normalizeLabelValue(value)
  const id = generateId("PLBL")

  db.run(
    `INSERT OR IGNORE INTO prompt_labels (id, prompt_id, key, value) VALUES (?, ?, ?, ?)`,
    [id, promptId, normalizedKey, normalizedValue]
  )

  const row = db
    .query("SELECT * FROM prompt_labels WHERE prompt_id = ? AND key = ? AND value = ?")
    .get(promptId, normalizedKey, normalizedValue) as LabelRow
  return rowToLabel(row)
}

/** Removes all values for a key. */
export function removeLabel(promptId: string, key: string): void {
  const db = getDatabase()
  db.run("DELETE FROM prompt_labels WHERE prompt_id = ? AND key = ?", [promptId, normalizeLabelKey(key)])
}

export function listLabels(promptId: string): PromptLabel[] {
  const db = getDatabase()
  const rows = db
    .query("SELECT * FROM prompt_labels WHERE prompt_id = ? ORDER BY key ASC, value ASC")
    .all(promptId) as LabelRow[]
  return rows.map(rowToLabel)
}
