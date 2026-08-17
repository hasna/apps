import { rmSync } from "fs"
import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import type { DispatchRun, DispatchRuntime, DispatchStatus } from "../lib/dispatch/types.js"

function rowToDispatchRun(row: Record<string, unknown>): DispatchRun {
  return {
    id: row["id"] as string,
    runtime: row["runtime"] as DispatchRuntime,
    target: (row["target"] as string | null) ?? null,
    status: row["status"] as DispatchStatus,
    prompt_id: row["prompt_id"] as string,
    prompt_slug: row["prompt_slug"] as string,
    prompt_version: row["prompt_version"] as number,
    render_hash: row["render_hash"] as string,
    vars_hash: (row["vars_hash"] as string | null) ?? null,
    resolved_references: JSON.parse((row["resolved_references"] as string) || "[]") as string[],
    output_pointer: (row["output_pointer"] as string | null) ?? null,
    output_hash: (row["output_hash"] as string | null) ?? null,
    output_bytes: row["output_bytes"] as number,
    exit_code: (row["exit_code"] as number | null) ?? null,
    error_code: (row["error_code"] as string | null) ?? null,
    notes: (row["notes"] as string | null) ?? null,
    started_at: (row["started_at"] as string | null) ?? null,
    finished_at: (row["finished_at"] as string | null) ?? null,
    created_at: row["created_at"] as string,
    updated_at: row["updated_at"] as string,
  }
}

export interface CreateDispatchRunInput {
  runtime: DispatchRuntime
  target?: string | null
  status: DispatchStatus
  prompt_id: string
  prompt_slug: string
  prompt_version: number
  render_hash: string
  vars_hash?: string | null
  resolved_references?: string[]
  output_pointer?: string | null
  output_hash?: string | null
  output_bytes?: number
  exit_code?: number | null
  error_code?: string | null
  notes?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export function createDispatchRun(input: CreateDispatchRunInput): DispatchRun {
  const db = getDatabase()
  const id = generateId("run")
  db.run(
    `INSERT INTO dispatch_runs (
       id, runtime, target, status, prompt_id, prompt_slug, prompt_version,
       render_hash, vars_hash, resolved_references, output_pointer, output_hash,
       output_bytes, exit_code, error_code, notes, started_at, finished_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.runtime,
      input.target ?? null,
      input.status,
      input.prompt_id,
      input.prompt_slug,
      input.prompt_version,
      input.render_hash,
      input.vars_hash ?? null,
      JSON.stringify(input.resolved_references ?? []),
      input.output_pointer ?? null,
      input.output_hash ?? null,
      input.output_bytes ?? 0,
      input.exit_code ?? null,
      input.error_code ?? null,
      input.notes ?? null,
      input.started_at ?? null,
      input.finished_at ?? null,
    ]
  )
  const run = getDispatchRun(id)
  if (!run) throw new Error(`Dispatch run not found after insert: ${id}`)
  return run
}

export type DispatchRunPatch = Partial<
  Pick<
    DispatchRun,
    | "target"
    | "status"
    | "output_pointer"
    | "output_hash"
    | "output_bytes"
    | "exit_code"
    | "error_code"
    | "notes"
    | "started_at"
    | "finished_at"
  >
>

export function updateDispatchRun(id: string, patch: DispatchRunPatch): DispatchRun {
  const db = getDatabase()
  const fields: string[] = []
  const params: Array<string | number | null> = []
  for (const [key, value] of Object.entries(patch)) {
    fields.push(`${key} = ?`)
    params.push((value ?? null) as string | number | null)
  }
  if (fields.length === 0) return requireDispatchRun(id)
  fields.push("updated_at = datetime('now')")
  db.run(`UPDATE dispatch_runs SET ${fields.join(", ")} WHERE id = ?`, [...params, id])
  return requireDispatchRun(id)
}

export function getDispatchRun(id: string): DispatchRun | null {
  const db = getDatabase()
  const row = db.query("SELECT * FROM dispatch_runs WHERE id = ?").get(id) as Record<string, unknown> | null
  if (!row) return null
  return rowToDispatchRun(row)
}

export function requireDispatchRun(id: string): DispatchRun {
  const run = getDispatchRun(id)
  if (!run) throw new Error(`Dispatch run not found: ${id}`)
  return run
}

export interface ListDispatchRunsFilter {
  prompt_id?: string
  status?: DispatchStatus
  limit?: number
  offset?: number
}

export function listDispatchRuns(filter: ListDispatchRunsFilter = {}): DispatchRun[] {
  const db = getDatabase()
  const conditions: string[] = []
  const params: Array<string | number | null> = []
  if (filter.prompt_id) {
    conditions.push("prompt_id = ?")
    params.push(filter.prompt_id)
  }
  if (filter.status) {
    conditions.push("status = ?")
    params.push(filter.status)
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = filter.limit ?? 50
  const offset = filter.offset ?? 0
  const rows = db
    .query(`SELECT * FROM dispatch_runs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<Record<string, unknown>>
  return rows.map(rowToDispatchRun)
}

/**
 * Delete terminal runs older than retentionDays, including their capture
 * files. Non-terminal runs are never pruned. Retention is bounded so run
 * storage cannot grow without limit.
 */
export function pruneDispatchRuns(
  retentionDays: number,
  fileForRun: (run: DispatchRun) => string[]
): { pruned: number } {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19)
  const rows = db
    .query(
      `SELECT * FROM dispatch_runs
       WHERE status IN ('succeeded', 'failed', 'cancelled') AND created_at < ?
       ORDER BY created_at ASC`
    )
    .all(cutoff) as Array<Record<string, unknown>>
  if (rows.length === 0) return { pruned: 0 }
  const ids: string[] = []
  for (const row of rows) {
    const run = rowToDispatchRun(row)
    ids.push(run.id)
    for (const file of fileForRun(run)) {
      try {
        rmSync(file, { force: true })
      } catch {
        // Best effort — a missing capture file must not block pruning.
      }
    }
  }
  const placeholders = ids.map(() => "?").join(", ")
  db.run(`DELETE FROM dispatch_runs WHERE id IN (${placeholders})`, ids)
  return { pruned: ids.length }
}
