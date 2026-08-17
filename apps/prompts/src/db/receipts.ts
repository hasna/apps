import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import { createHash } from "node:crypto"
import type { RenderReceipt, ResolvedSource } from "../types/index.js"

interface ReceiptRow {
  id: string
  prompt_id: string
  prompt_version: number
  resolved_sources: string
  render_hash: string
  missing_vars: string
  used_defaults: string
  created_at: string
}

function rowToReceipt(row: ReceiptRow): RenderReceipt {
  return {
    id: row.id,
    prompt_id: row.prompt_id,
    prompt_version: row.prompt_version,
    resolved_sources: JSON.parse(row.resolved_sources) as ResolvedSource[],
    render_hash: row.render_hash,
    missing_vars: JSON.parse(row.missing_vars) as string[],
    used_defaults: JSON.parse(row.used_defaults) as string[],
    created_at: row.created_at,
  }
}

export function renderHash(rendered: string): string {
  return createHash("sha256").update(rendered, "utf-8").digest("hex")
}

/**
 * Record one render receipt. Called by render call sites when a render resolved
 * dependencies (self + parent + partial sources) so dispatch runs stay reproducible.
 */
export function recordRenderReceipt(
  promptId: string,
  promptVersion: number,
  data: {
    resolvedSources: ResolvedSource[]
    rendered: string
    missingVars: string[]
    usedDefaults: string[]
  }
): RenderReceipt {
  const db = getDatabase()
  const id = generateId("RRCP")
  db.run(
    `INSERT INTO render_receipts (id, prompt_id, prompt_version, resolved_sources, render_hash, missing_vars, used_defaults)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      promptId,
      promptVersion,
      JSON.stringify(data.resolvedSources),
      renderHash(data.rendered),
      JSON.stringify(data.missingVars),
      JSON.stringify(data.usedDefaults),
    ]
  )
  const row = db.query("SELECT * FROM render_receipts WHERE id = ?").get(id) as ReceiptRow
  return rowToReceipt(row)
}

export function getRenderReceipts(promptId: string, limit = 20): RenderReceipt[] {
  const db = getDatabase()
  const rows = db
    .query("SELECT * FROM render_receipts WHERE prompt_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(promptId, limit) as ReceiptRow[]
  return rows.map(rowToReceipt)
}
