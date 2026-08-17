/**
 * Parser for integration references in prompt bodies.
 *
 * Integration syntax is disjoint from the variable syntax (`{{name}}`,
 * `{{name|default}}`): integration refs carry a colon after the kind, and the
 * existing variable pattern's name class is `[a-zA-Z0-9_]*`, so a `:` after
 * the name class breaks the variable match. `{{todo:...}}` is therefore never
 * treated as a variable.
 *
 * Supported forms (report D table):
 *   {{todo:<full-uuid>}}
 *   {{channel:<chn-id>}}
 *   {{knowledge:<full-id>}}
 *   {{memento:id=<uuid>|key=<key>|search=<term>}}
 *   {{file:open-files://file/<id>/revision/<revision-id>}}
 */

import type { IntegrationKind, ParsedIntegrationRef } from "./types.js"

const INTEGRATION_PATTERN = /\{\{\s*(todo|channel|knowledge|memento|file):([^}]*?)\s*\}\}/g

/** True when the body contains at least one integration reference. */
export function hasIntegrationRefs(body: string): boolean {
  INTEGRATION_PATTERN.lastIndex = 0
  return INTEGRATION_PATTERN.test(body)
}

/** Extract raw `{{kind:...}}` refs without validating payloads. */
export function extractIntegrationRefs(body: string): Array<{ kind: IntegrationKind; raw: string; payload: string }> {
  const refs: Array<{ kind: IntegrationKind; raw: string; payload: string }> = []
  const pattern = new RegExp(INTEGRATION_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    refs.push({ kind: match[1] as IntegrationKind, raw: match[0], payload: (match[2] ?? "").trim() })
  }
  return refs
}

/** Full UUID shape for todo/memento id selectors. */
const FULL_UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function isFullUuid(value: string): boolean {
  return FULL_UUID_PATTERN.test(value)
}

/**
 * Parse one integration ref into its per-kind payload.
 * Returns null when the payload is malformed for the kind; the caller maps
 * malformed payloads to the app's INVALID code.
 */
export function parseIntegrationRef(kind: IntegrationKind, raw: string, payload: string): ParsedIntegrationRef | null {
  switch (kind) {
    case "todo": {
      if (!isFullUuid(payload)) return null
      return { kind, raw, id: payload }
    }
    case "channel": {
      // Channel ids are opaque `chn_...` strings; a non-empty payload is the
      // minimum validity bar (the owning SDK performs the authoritative
      // existence lookup).
      if (!payload || payload.includes(" ")) return null
      return { kind, raw, channelId: payload }
    }
    case "knowledge": {
      if (!payload || payload.includes(" ")) return null
      return { kind, raw, id: payload }
    }
    case "memento": {
      // Exactly one selector: id=<uuid> | key=<key> | search=<term>.
      const selector = payload.trim()
      if (selector.startsWith("id=")) {
        const value = selector.slice(3).trim()
        if (!isFullUuid(value)) return null
        return { kind, raw, mode: "id", value }
      }
      if (selector.startsWith("key=")) {
        const value = selector.slice(4).trim()
        if (!value) return null
        return { kind, raw, mode: "key", value }
      }
      if (selector.startsWith("search=")) {
        const value = selector.slice(7).trim()
        if (!value) return null
        return { kind, raw, mode: "search", value }
      }
      return null
    }
    case "file": {
      const uri = payload.trim()
      // The owning files package owns URI grammar (open-files://file/...); here
      // we only require the scheme prefix — deep validation happens in the
      // files resolver via parseOpenFilesSourceRef.
      if (!uri.startsWith("open-files://")) return null
      return { kind, raw, uri }
    }
  }
}

/** Parse all integration refs in a body, keeping malformed ones out. */
export function parseIntegrationRefs(body: string): ParsedIntegrationRef[] {
  const parsed: ParsedIntegrationRef[] = []
  for (const { kind, raw, payload } of extractIntegrationRefs(body)) {
    const ref = parseIntegrationRef(kind, raw, payload)
    if (ref) parsed.push(ref)
  }
  return parsed
}
