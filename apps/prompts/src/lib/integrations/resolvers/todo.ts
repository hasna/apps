/**
 * Todos resolver — {{todo:<full-uuid>}}.
 *
 * Reads through the owning @hasna/todos SDK client with FIELD PROJECTION
 * (`client.tasks.get(id, { fields })`) — never the over-fetching `show --json`
 * surface. The todos server applies the projection server-side.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { PROJECTION_BOUNDS, redactText, truncateText } from "../redact.js"
import { loadOwningPackage } from "../load.js"

export const TODO_PROJECTION = "todo.v1"

/** Fields the todos server accepts for projection (server-side taskToSummary). */
export const TODO_PROJECTION_FIELDS = [
  "id",
  "short_id",
  "title",
  "description",
  "status",
  "priority",
  "project_id",
  "plan_id",
  "task_list_id",
  "agent_id",
  "assigned_to",
  "tags",
  "version",
  "created_at",
  "updated_at",
  "completed_at",
  "due_at",
] as const

export interface TodoProjectionData {
  id: string
  short_id: string | null
  title: string
  description: string | null
  status: string
  priority: string
  project_id: string | null
  assigned_to: string | null
  tags: string[]
  version: number | null
  updated_at: string | null
  redacted: boolean
  title_truncated: boolean
  description_truncated: boolean
}

/** Injectable read surface so tests never touch a live todos server. */
export interface TodoReadSurface {
  getProjected(id: string, fields: readonly string[]): Promise<Record<string, unknown>>
}

const FIELD_SCHEMA: TodoProjectionData = {
  id: "",
  short_id: null,
  title: "",
  description: null,
  status: "",
  priority: "",
  project_id: null,
  assigned_to: null,
  tags: [],
  version: null,
  updated_at: null,
  redacted: false,
  title_truncated: false,
  description_truncated: false,
}

function normalizeScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return null
}

export function projectTodoRecord(record: Record<string, unknown>): TodoProjectionData {
  const title = normalizeScalar(record["title"]) ?? ""
  const description = normalizeScalar(record["description"]) ?? ""
  const tags = Array.isArray(record["tags"])
    ? (record["tags"] as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 20)
    : []

  const titleT = truncateText(redactText(title), PROJECTION_BOUNDS.todoTitleChars)
  const descT = truncateText(redactText(description), PROJECTION_BOUNDS.todoDescriptionChars)

  return {
    id: normalizeScalar(record["id"]) ?? "",
    short_id: normalizeScalar(record["short_id"]),
    title: titleT.text,
    description: descT.text || null,
    status: normalizeScalar(record["status"]) ?? "unknown",
    priority: normalizeScalar(record["priority"]) ?? "unknown",
    project_id: normalizeScalar(record["project_id"]),
    assigned_to: normalizeScalar(record["assigned_to"]),
    tags,
    version: typeof record["version"] === "number" ? (record["version"] as number) : null,
    updated_at: normalizeScalar(record["updated_at"]),
    redacted: titleT.text !== title || descT.text !== description,
    title_truncated: titleT.truncated,
    description_truncated: descT.truncated,
  }
}

/** Serialize the projection deterministically (stable key order). */
export function serializeTodoProjection(data: TodoProjectionData): string {
  return JSON.stringify(data)
}

/**
 * Resolve one {{todo:<uuid>}} ref. `surface` is injectable for tests; the
 * default reads through the owning package's SDK client.
 */
export async function resolveTodo(
  ref: Extract<ParsedIntegrationRef, { kind: "todo" }>,
  surface?: TodoReadSurface,
): Promise<ResolvedIntegration> {
  const read: TodoReadSurface =
    surface ?? {
      getProjected: async (id, fields) => {
        const mod = await loadOwningPackage("todo", "@hasna/todos")
        const client = mod["createClient"] as (options?: unknown) => { tasks: { get: (id: string, options: { fields: string[] }) => Promise<unknown> } }
        const task = await client().tasks.get(id, { fields: [...fields] })
        return task as unknown as Record<string, unknown>
      },
    }

  let record: Record<string, unknown>
  try {
    record = await read.getProjected(ref.id, TODO_PROJECTION_FIELDS)
  } catch (e) {
    // Propagate named failures from the owning-package loader unchanged.
    if (e instanceof IntegrationResolutionError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("404")) {
      throw new IntegrationResolutionError("TODO_NOT_FOUND", "todo", ref.raw, msg)
    }
    if (msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("401")) {
      throw new IntegrationResolutionError("TODO_AUTH_FAILED", "todo", ref.raw, msg)
    }
    if (
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("abort")
    ) {
      throw new IntegrationResolutionError("TODO_TIMEOUT", "todo", ref.raw, msg)
    }
    if (msg.toLowerCase().includes("connection") || msg.toLowerCase().includes("fetch failed")) {
      throw new IntegrationResolutionError("TODO_TIMEOUT", "todo", ref.raw, msg)
    }
    throw new IntegrationResolutionError("TODO_RESPONSE_INVALID", "todo", ref.raw, msg)
  }

  const data = projectTodoRecord(record)
  if (!data.id && !data.short_id) {
    throw new IntegrationResolutionError("TODO_RESPONSE_INVALID", "todo", ref.raw, "projection produced no task identity")
  }
  if (data.title.length === 0 && data.status === "unknown") {
    throw new IntegrationResolutionError("TODO_RESPONSE_INVALID", "todo", ref.raw, "projection produced no task content")
  }

  const text = serializeTodoProjection(data)
  return {
    kind: "todo",
    ref: ref.raw,
    source_id: data.id,
    source_version: data.version,
    projection: TODO_PROJECTION,
    text,
  }
}

export const todoProjectionFieldSchema = FIELD_SCHEMA
