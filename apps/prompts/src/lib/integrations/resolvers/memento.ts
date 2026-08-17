/**
 * Mementos resolver — {{memento:id=<uuid>|key=<key>|search=<term>}}.
 *
 * Reads through the owning @hasna/mementos ROOT reads (`getMemory`,
 * `getMemoryByKey`, `searchMemories`) — side-effect-free at the resolver
 * boundary. The `show`/`recall`/`context` CLI verbs touch memory and are never
 * used here.
 *
 * Exact UUID/key is deterministic. An explicit bounded search returns several
 * scored results and never silently chooses one.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { PROJECTION_BOUNDS, redactText, truncateText } from "../redact.js"
import { loadOwningPackage } from "../load.js"

export const MEMENTO_PROJECTION = "memento.v1"
export const MEMENTO_SEARCH_PROJECTION = "memento.search.v1"

export interface MementoLike {
  id: string
  key: string
  value: string
  category: string
  scope: string
  summary: string | null
  tags: string[]
  importance: number | null
  when_to_use?: string | null
  version: number | null
  updated_at: string | null
}

export interface MementoSearchResultLike {
  memory: MementoLike
  score: number
  match_type: "exact" | "fuzzy" | "tag"
}

export interface MementoProjectionData {
  id: string
  key: string
  value: string
  summary: string | null
  category: string
  scope: string
  tags: string[]
  importance: number | null
  when_to_use: string | null
  version: number | null
  updated_at: string | null
  value_truncated: boolean
  redacted: boolean
}

export interface MementoSearchProjectionData {
  term: string
  results: Array<{
    id: string
    key: string
    summary: string | null
    score: number
    match_type: string
  }>
  count: number
  limit: number
  redacted: boolean
}

/** Injectable read surface so tests never touch a live mementos store. */
export interface MementoReadSurface {
  getById(id: string): Promise<MementoLike | null>
  getByKey(key: string): Promise<MementoLike | null>
  search(term: string, limit: number): Promise<MementoSearchResultLike[]>
}

export function projectMemento(m: MementoLike): MementoProjectionData {
  const value = truncateText(redactText(m.value), PROJECTION_BOUNDS.mementoValueChars)
  const summaryRaw = m.summary ?? ""
  const summary = truncateText(redactText(summaryRaw), PROJECTION_BOUNDS.mementoSummaryChars)
  const whenToUse = m.when_to_use
    ? truncateText(redactText(m.when_to_use), PROJECTION_BOUNDS.mementoSummaryChars).text
    : null

  return {
    id: m.id,
    key: m.key,
    value: value.text,
    summary: summary.text || null,
    category: m.category,
    scope: m.scope,
    tags: (m.tags ?? []).slice(0, 20),
    importance: typeof m.importance === "number" ? m.importance : null,
    when_to_use: whenToUse,
    version: typeof m.version === "number" ? m.version : null,
    updated_at: m.updated_at ?? null,
    value_truncated: value.truncated,
    redacted: value.text !== m.value || summary.text !== summaryRaw,
  }
}

function projectSearch(m: MementoLike, score: number, matchType: string): MementoSearchProjectionData["results"][number] {
  const summary = m.summary ? truncateText(redactText(m.summary), PROJECTION_BOUNDS.mementoSummaryChars).text : null
  return {
    id: m.id,
    key: m.key,
    summary,
    score: typeof score === "number" ? score : 0,
    match_type: matchType,
  }
}

export function serializeMementoProjection(data: MementoProjectionData): string {
  return JSON.stringify(data)
}

export function serializeMementoSearchProjection(data: MementoSearchProjectionData): string {
  return JSON.stringify(data)
}

const AUTH_FAILURE_HINTS = ["unauthorized", "401", "api key", "forbidden", "403"]
const TIMEOUT_HINTS = ["timeout", "timed out", "connection", "fetch failed", "abort"]

function classifyMementoError(e: unknown, _mode: "id" | "key" | "search", _ref: string, raw: string): IntegrationResolutionError {
  if (e instanceof IntegrationResolutionError) return e
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (AUTH_FAILURE_HINTS.some((h) => lower.includes(h))) {
    return new IntegrationResolutionError("MEMENTO_AUTH_FAILED", "memento", raw, msg)
  }
  if (TIMEOUT_HINTS.some((h) => lower.includes(h))) {
    return new IntegrationResolutionError("MEMENTO_TIMEOUT", "memento", raw, msg)
  }
  return new IntegrationResolutionError("MEMENTO_RESPONSE_INVALID", "memento", raw, msg)
}

/**
 * Resolve one {{memento:...}} ref. `surface` is injectable for tests; the
 * default reads through the owning package's root exports.
 */
export async function resolveMemento(
  ref: Extract<ParsedIntegrationRef, { kind: "memento" }>,
  surface?: MementoReadSurface,
): Promise<ResolvedIntegration> {
  const read: MementoReadSurface =
    surface ??
    {
      getById: async (id) => {
        const mod = await loadOwningPackage("memento", "@hasna/mementos")
        const getMemory = mod["getMemory"] as (id: string) => unknown
        const m = getMemory(id)
        return m ? (m as unknown as MementoLike) : null
      },
      getByKey: async (key) => {
        const mod = await loadOwningPackage("memento", "@hasna/mementos")
        const getMemoryByKey = mod["getMemoryByKey"] as (key: string) => unknown
        const m = getMemoryByKey(key)
        return m ? (m as unknown as MementoLike) : null
      },
      search: async (term, limit) => {
        const mod = await loadOwningPackage("memento", "@hasna/mementos")
        const searchMemories = mod["searchMemories"] as (term: string, filter: { limit?: number }) => unknown
        const results = searchMemories(term, { limit })
        return results as unknown as MementoSearchResultLike[]
      },
    }

  if (ref.mode === "id") {
    let m: MementoLike | null
    try {
      m = await read.getById(ref.value)
    } catch (e) {
      throw classifyMementoError(e, "id", ref.raw, ref.raw)
    }
    if (!m) {
      throw new IntegrationResolutionError("MEMENTO_NOT_FOUND", "memento", ref.raw, `memento not found: ${ref.value}`)
    }
    const data = projectMemento(m)
    return {
      kind: "memento",
      ref: ref.raw,
      source_id: data.id,
      source_version: data.version,
      projection: MEMENTO_PROJECTION,
      text: serializeMementoProjection(data),
    }
  }

  if (ref.mode === "key") {
    let m: MementoLike | null
    try {
      m = await read.getByKey(ref.value)
    } catch (e) {
      throw classifyMementoError(e, "key", ref.raw, ref.raw)
    }
    if (!m) {
      throw new IntegrationResolutionError("MEMENTO_NOT_FOUND", "memento", ref.raw, `memento key not found: ${ref.value}`)
    }
    const data = projectMemento(m)
    return {
      kind: "memento",
      ref: ref.raw,
      source_id: data.id,
      source_version: data.version,
      projection: MEMENTO_PROJECTION,
      text: serializeMementoProjection(data),
    }
  }

  // mode === "search": bounded scored results, never silently choose one.
  let results: MementoSearchResultLike[]
  try {
    results = await read.search(ref.value, PROJECTION_BOUNDS.mementoSearchLimit)
  } catch (e) {
    throw classifyMementoError(e, "search", ref.raw, ref.raw)
  }
  if (!results || results.length === 0) {
    throw new IntegrationResolutionError("MEMENTO_NOT_FOUND", "memento", ref.raw, `no mementos matched: ${ref.value}`)
  }
  const bounded = results.slice(0, PROJECTION_BOUNDS.mementoSearchLimit)
  const data: MementoSearchProjectionData = {
    term: ref.value,
    results: bounded.map((r) => projectSearch(r.memory, r.score, r.match_type)),
    count: results.length,
    limit: PROJECTION_BOUNDS.mementoSearchLimit,
    redacted: false,
  }
  return {
    kind: "memento",
    ref: ref.raw,
    source_id: "",
    source_version: null,
    projection: MEMENTO_SEARCH_PROJECTION,
    text: serializeMementoSearchProjection(data),
  }
}
