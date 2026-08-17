/**
 * Mementos resolver — {{memento:id=<uuid>|key=<key>|search=<term>}}.
 *
 * PURITY CONTRACT (report D4: "does not increment access, update timestamps or
 * log a search"). Measured against the owning package at the same repo
 * revision, 2026-08-17:
 *
 * - `getMemoryByKey` is PURE in both modes: local is a SELECT; hosted routes
 *   through `GET /api/memories?key=...` (list route), which neither touches
 *   access metadata nor logs. Used by `key=` mode.
 * - `getMemory` is PURE in local mode but SIDE-EFFECTING in hosted mode: the
 *   server's `GET /api/memories/:id` handler calls `touchMemory(memory.id)`
 *   on every read. It is NEVER called from here.
 * - `searchMemories` is SIDE-EFFECTING in both modes: local executes
 *   `INSERT INTO search_history`; hosted POSTs `/api/memories/search`, whose
 *   handler runs the same `searchMemories` and logs the query. `search=` mode
 *   is therefore REMOVED and fails closed with MEMENTO_SEARCH_UNAVAILABLE
 *   until the owning package ships a pure search read.
 * - `id=` mode resolves through the owning package's no-touch read
 *   (`peekMemory`, the pure resolver report D4 prescribes). If the installed
 *   package does not export it yet, `id=` fails closed with
 *   MEMENTO_READ_MODE_UNAVAILABLE instead of falling back to a
 *   side-effecting read.
 *
 * Exact UUID/key is deterministic. Search never silently substitutes one
 * result for another — there is no search.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { PROJECTION_BOUNDS, redactText, truncateText } from "../redact.js"
import { loadOwningPackage } from "../load.js"

export const MEMENTO_PROJECTION = "memento.v1"

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

/**
 * Injectable read surface so tests never touch a live mementos store. Every
 * verb maps to a PROVABLY PURE owning-package read — there is deliberately no
 * search verb: the owning package has no pure search, and no touch verb.
 */
export interface MementoReadSurface {
  /** No-touch get-by-id. Must route to `peekMemory` on the owning package. */
  getById(id: string): Promise<MementoLike | null>
  /** Pure get-by-exact-key (`getMemoryByKey` on the owning package). */
  getByKey(key: string): Promise<MementoLike | null>
}

/** Injectable owning-package module loader (tests substitute a fake module). */
export type MementoModuleLoader = (kind: "memento", specifier: string) => Promise<Record<string, unknown>>

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

export function serializeMementoProjection(data: MementoProjectionData): string {
  return JSON.stringify(data)
}

const AUTH_FAILURE_HINTS = ["unauthorized", "401", "api key", "forbidden", "403"]
const TIMEOUT_HINTS = ["timeout", "timed out", "connection", "fetch failed", "abort"]

function classifyMementoError(e: unknown, raw: string): IntegrationResolutionError {
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
 * Default pure read surface over the owning @hasna/mementos package.
 *
 * `getById` requires the package's no-touch read (`peekMemory`); when the
 * installed package does not export it, id lookup fails closed with
 * MEMENTO_READ_MODE_UNAVAILABLE rather than falling back to `getMemory`,
 * whose hosted `GET /api/memories/:id` touches access metadata.
 */
export function defaultMementoReadSurface(loader: MementoModuleLoader = loadOwningPackage): MementoReadSurface {
  return {
    getById: async (id) => {
      const mod = await loader("memento", "@hasna/mementos")
      const peekMemory = mod["peekMemory"] as ((id: string) => unknown) | undefined
      if (typeof peekMemory !== "function") {
        throw new IntegrationResolutionError(
          "MEMENTO_READ_MODE_UNAVAILABLE",
          "memento",
          "",
          "@hasna/mementos does not export the no-touch read peekMemory (report D4); getMemory touches access metadata in hosted mode and is never called here",
        )
      }
      const m = peekMemory(id)
      return m ? (m as unknown as MementoLike) : null
    },
    getByKey: async (key) => {
      const mod = await loader("memento", "@hasna/mementos")
      const getMemoryByKey = mod["getMemoryByKey"] as ((key: string) => unknown) | undefined
      if (typeof getMemoryByKey !== "function") {
        throw new IntegrationResolutionError(
          "MEMENTO_UNAVAILABLE",
          "memento",
          "",
          "@hasna/mementos does not export getMemoryByKey — installed version mismatch",
        )
      }
      const m = getMemoryByKey(key)
      return m ? (m as unknown as MementoLike) : null
    },
  }
}

/**
 * Resolve one {{memento:...}} ref. `surface` is injectable for tests; the
 * default is `defaultMementoReadSurface()` — pure reads only.
 *
 * `search=` refs never reach any surface: the owning package has no pure
 * search read, so search mode fails closed with MEMENTO_SEARCH_UNAVAILABLE.
 */
export async function resolveMemento(
  ref: Extract<ParsedIntegrationRef, { kind: "memento" }>,
  surface?: MementoReadSurface,
): Promise<ResolvedIntegration> {
  if (ref.mode === "search") {
    throw new IntegrationResolutionError(
      "MEMENTO_SEARCH_UNAVAILABLE",
      "memento",
      ref.raw,
      "memento search mode is unavailable: @hasna/mementos searchMemories writes search_history / logs the query (report D4 requires a pure read); use {{memento:id=<uuid>}} or {{memento:key=<key>}}",
    )
  }

  const read: MementoReadSurface = surface ?? defaultMementoReadSurface()

  if (ref.mode === "id") {
    let m: MementoLike | null
    try {
      m = await read.getById(ref.value)
    } catch (e) {
      throw classifyMementoError(e, ref.raw)
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

  let m: MementoLike | null
  try {
    m = await read.getByKey(ref.value)
  } catch (e) {
    throw classifyMementoError(e, ref.raw)
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
