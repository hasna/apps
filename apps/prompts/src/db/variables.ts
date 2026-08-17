import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import { extractVariableInfo } from "../lib/template.js"
import type { TemplateVariable, VariableSchemaEntry, TemplateValueType, TemplateRenderFormat } from "../types/index.js"

interface VariableRow {
  id: string
  prompt_id: string
  name: string
  type: TemplateValueType
  required: number
  default_value: string | null
  description: string | null
  validation: string | null
  render_format: TemplateRenderFormat
  position: number
}

function rowToVariable(row: VariableRow): TemplateVariable {
  const variable: TemplateVariable = {
    name: row.name,
    type: row.type,
    required: Boolean(row.required),
    render_format: row.render_format,
  }
  if (row.description !== null) variable.description = row.description
  if (row.validation !== null) variable.validation = row.validation
  if (row.default_value !== null) {
    try {
      variable.typed_default = JSON.parse(row.default_value) as unknown
    } catch {
      variable.typed_default = row.default_value
    }
  }
  return variable
}

/**
 * Keep prompt_variables in sync with the body's re-extraction.
 *
 * - Names come from the body (extractVariableInfo), which is the source of truth
 *   for existence and inline (string) defaults.
 * - Typed metadata (type, typed default, description, validation, render format,
 *   required override) is overlaid from `overrides` and from rows that already
 *   exist (so an update that touches the body preserves hand-authored metadata).
 * - Rows for names no longer in the body are deleted.
 *
 * Returns the merged variable list. The caller mirrors it into the legacy
 * `prompts.variables` JSON column.
 */
export function syncPromptVariables(
  promptId: string,
  body: string,
  overrides: VariableSchemaEntry[] = []
): TemplateVariable[] {
  const db = getDatabase()
  const infos = extractVariableInfo(body)
  const overrideByName = new Map(overrides.map((o) => [o.name, o]))

  const existingRows = db
    .query("SELECT * FROM prompt_variables WHERE prompt_id = ?")
    .all(promptId) as VariableRow[]
  const existingByName = new Map(existingRows.map((r) => [r.name, r]))

  const merged: TemplateVariable[] = []
  infos.forEach((info, position) => {
    const override = overrideByName.get(info.name)
    const existing = existingByName.get(info.name)

    const type: TemplateValueType = override?.type ?? existing?.type ?? "string"
    const finalRequired = override?.required !== undefined
      ? override.required
      : existing !== undefined
        ? Boolean(existing.required)
        : info.required
    const typedDefault =
      override?.default !== undefined
        ? override.default
        : existing?.default_value !== null && existing?.default_value !== undefined
          ? parseJson(existing.default_value)
          : undefined
    const description = override?.description ?? existing?.description ?? undefined
    const validation = override?.validation ?? existing?.validation ?? undefined
    const renderFormat: TemplateRenderFormat = override?.render_format ?? existing?.render_format ?? "json"

    db
      .query(
        `INSERT INTO prompt_variables (id, prompt_id, name, type, required, default_value, description, validation, render_format, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(prompt_id, name) DO UPDATE SET
           type = excluded.type,
           required = excluded.required,
           default_value = excluded.default_value,
           description = excluded.description,
           validation = excluded.validation,
           render_format = excluded.render_format,
           position = excluded.position,
           updated_at = datetime('now')`
      )
      .run(
        generateId("PVAR"),
        promptId,
        info.name,
        type,
        finalRequired ? 1 : 0,
        typedDefault !== undefined ? JSON.stringify(typedDefault) : null,
        description ?? null,
        validation ?? null,
        renderFormat,
        position
      )

    const variable: TemplateVariable = {
      name: info.name,
      type,
      required: finalRequired,
      render_format: renderFormat,
    }
    if (info.default !== null) variable.default = info.default
    if (typedDefault !== undefined) variable.typed_default = typedDefault
    if (description !== undefined) variable.description = description
    if (validation !== undefined) variable.validation = validation
    merged.push(variable)
  })

  // Delete rows for names no longer in the body.
  const liveNames = new Set(infos.map((i) => i.name))
  for (const existing of existingRows) {
    if (!liveNames.has(existing.name)) {
      db.run("DELETE FROM prompt_variables WHERE id = ?", [existing.id])
    }
  }

  return merged
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

export function loadPromptVariables(promptId: string): TemplateVariable[] {
  const db = getDatabase()
  const rows = db
    .query("SELECT * FROM prompt_variables WHERE prompt_id = ? ORDER BY position ASC, name ASC")
    .all(promptId) as VariableRow[]
  return rows.map(rowToVariable)
}

/** Batch load for list operations. */
export function loadPromptVariablesForPrompts(promptIds: string[]): Map<string, TemplateVariable[]> {
  const db = getDatabase()
  const map = new Map<string, TemplateVariable[]>()
  if (promptIds.length === 0) return map
  const placeholders = promptIds.map(() => "?").join(",")
  const rows = db
    .query(`SELECT * FROM prompt_variables WHERE prompt_id IN (${placeholders}) ORDER BY position ASC, name ASC`)
    .all(...promptIds) as VariableRow[]
  for (const row of rows) {
    const list = map.get(row.prompt_id) ?? []
    list.push(rowToVariable(row))
    map.set(row.prompt_id, list)
  }
  return map
}
