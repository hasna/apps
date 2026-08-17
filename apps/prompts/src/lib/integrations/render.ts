/**
 * Integration-aware render for prompt bodies.
 *
 * The existing `renderTemplate` remains byte-compatible for pure variable
 * templates. `renderTemplateWithIntegrations` additionally resolves integration
 * refs (`{{todo:...}}`, `{{channel:...}}`, `{{knowledge:...}}`,
 * `{{memento:...}}`, `{{file:...}}`) through the owning packages' SDKs.
 *
 * Default behavior is FAIL-CLOSED: any integration that cannot be resolved
 * throws IntegrationResolutionError carrying the app's named code. With
 * `allowUnresolvedIntegrations` (permissive preview), unresolved refs are
 * replaced with `[UNRESOLVED kind:ref code=...]` — never an empty string.
 *
 * Order matters: variable substitution runs first (integration syntax is
 * disjoint from `{{name}}`/`{{name|default}}` because of the colon), so the
 * injected projection text is never re-scanned for variables.
 */

import { renderTemplate } from "../template.js"
import type { RenderResult } from "../../types/index.js"
import { extractIntegrationRefs } from "./parse.js"
import { parseRefOrThrow, resolveIntegrationRef, buildSurfaceMap, type IntegrationDeps } from "./registry.js"
import {
  IntegrationResolutionError,
  wrapProjectionText,
  type IntegrationKind,
  type ResolvedIntegration,
  type ResolvedIntegrationReceipt,
  type UnresolvedIntegration,
  type UnresolvedIntegrationReceipt,
} from "./types.js"

export interface IntegrationRenderOptions {
  /** Permissive preview: unresolved refs become [UNRESOLVED ...] markers instead of failing. */
  allowUnresolvedIntegrations?: boolean
  /** Injectable owning-package read surfaces (tests). */
  deps?: IntegrationDeps
}

export interface IntegrationRenderResult extends RenderResult {
  resolved_integrations: ResolvedIntegrationReceipt[]
  unresolved_integrations: UnresolvedIntegrationReceipt[]
}

const UNRESOLVED_MARKER = (kind: IntegrationKind, ref: string, code: string) =>
  `[UNRESOLVED ${kind}:${ref} code=${code}]`

export async function renderTemplateWithIntegrations(
  body: string,
  vars: Record<string, string>,
  options: IntegrationRenderOptions = {},
): Promise<IntegrationRenderResult> {
  const surfaceMap = buildSurfaceMap(options.deps)
  const base = renderTemplate(body, vars)

  const refs = extractIntegrationRefs(base.rendered)
  const resolved: ResolvedIntegration[] = []
  const unresolved: UnresolvedIntegration[] = []

  // Resolve every ref (parallel is fine: each goes through its own owning SDK).
  const results = await Promise.all(
    refs.map(async (ref): Promise<ResolvedIntegration | UnresolvedIntegration> => {
      try {
        const parsed = parseRefOrThrow(ref.raw, ref.kind, ref.payload)
        return await resolveIntegrationRef(parsed, surfaceMap)
      } catch (e) {
        if (e instanceof IntegrationResolutionError) {
          return { kind: ref.kind, ref: ref.raw, code: e.code, message: e.message }
        }
        return { kind: ref.kind, ref: ref.raw, code: "FILE_ERROR" as const, message: e instanceof Error ? e.message : String(e) }
      }
    }),
  )

  for (const item of results) {
    if ("text" in item) resolved.push(item)
    else unresolved.push(item)
  }

  const resolvedReceipts: ResolvedIntegrationReceipt[] = resolved.map((r) => ({
    kind: r.kind,
    ref: r.ref,
    source_id: r.source_id,
    source_version: r.source_version ?? null,
    projection: r.projection,
  }))

  const unresolvedReceipts: UnresolvedIntegrationReceipt[] = unresolved.map((u) => ({
    kind: u.kind,
    ref: u.ref,
    code: u.code,
  }))

  if (unresolved.length > 0 && !options.allowUnresolvedIntegrations) {
    const first = unresolved[0]!
    throw new IntegrationResolutionError(first.code, first.kind, first.ref, first.message)
  }

  // Rebuild the body, replacing every occurrence of each ref (single pass via
  // one regex so repeated refs all resolve identically). Projection text is
  // inserted here, after variable substitution, so it is never re-scanned.
  const replacementByRaw = new Map<string, string>()
  for (const item of results) {
    if ("text" in item) {
      replacementByRaw.set(item.ref, wrapProjectionText(item.kind, item.ref, item.projection, item.text))
    } else {
      replacementByRaw.set(item.ref, UNRESOLVED_MARKER(item.kind, item.ref, item.code))
    }
  }

  const rendered = base.rendered.replace(/\{\{\s*(?:todo|channel|knowledge|memento|file):[^}]*?\}\}/g, (raw) => {
    const replacement = replacementByRaw.get(raw)
    if (replacement !== undefined) return replacement
    // A ref that somehow escaped resolution is surfaced, never dropped.
    return `[UNRESOLVED kind:${raw.slice(2, raw.indexOf(":"))} code=INVALID]`
  })

  return {
    rendered,
    missing_vars: base.missing_vars,
    used_defaults: base.used_defaults,
    resolved_integrations: resolvedReceipts,
    unresolved_integrations: unresolvedReceipts,
  }
}
