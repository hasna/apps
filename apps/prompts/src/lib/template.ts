import type { RenderResult, ResolvedSource } from "../types/index.js"
import { TemplateRenderError } from "../types/index.js"
import type { TemplateValueType, TemplateRenderFormat, VariableSchemaEntry } from "../types/index.js"

// Backward-compatible template parser.
//
// Supported syntax (byte-compatible with the legacy {{name}} / {{name|default}} parser):
//   {{name}}                  simple variable (required)
//   {{name|default}}          inline string default
//   {{ name | default }}      whitespace tolerated
//   {{request.owner.name}}    dot paths into nested values
//   {{>partial-slug}}         partial reference (resolved through resolvePartial)
//   \{{name}}                 literal escaping — renders {{name}} without interpolation
//
// Values may be typed (string | number | boolean | object | array). Objects and arrays
// render as canonical JSON unless the variable definition selects another safe formatter.
// Inline defaults remain strings; typed defaults live in prompt_variables.

export type { TemplateValueType, TemplateRenderFormat }

const NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_.]*$/
const PARTIAL_PATTERN = /^[a-zA-Z0-9_-]+$/

const DEFAULT_MAX_DEPTH = 10
const DEFAULT_MAX_BYTES = 1_000_000

export interface VariableInfo {
  name: string
  default: string | null
  required: boolean
}

export interface PartialSource {
  body: string
  id?: string
  version?: number
}

export interface RenderOptions {
  /** Fail on missing required values with a named TemplateRenderError. */
  strict?: boolean
  /** Render visible [UNRESOLVED kind=... name=...] markers instead of leaving placeholders. */
  preview?: boolean
  /** Maximum partial-expansion depth. Default 10. */
  maxDepth?: number
  /** Maximum rendered byte budget. Default 1_000_000. */
  maxBytes?: number
  /** Variable definitions (typed defaults, types, validation, render formats). */
  definitions?: Record<string, VariableDefinition>
  /** Resolver for {{>slug}} partial references. */
  resolvePartial?: (slug: string) => PartialSource | null
}

export interface VariableDefinition {
  name: string
  type?: TemplateValueType
  required?: boolean
  default?: string | null
  typed_default?: unknown
  description?: string
  validation?: string
  render_format?: TemplateRenderFormat
}

interface Token {
  kind: "text" | "var" | "partial"
  text?: string
  raw?: string
  name?: string
  default?: string | null
}

export function definitionsFromVariables(vars: Array<{ name: string; required?: boolean; typed_default?: unknown; type?: TemplateValueType; validation?: string; render_format?: TemplateRenderFormat }>): Record<string, VariableDefinition> {
  const defs: Record<string, VariableDefinition> = {}
  for (const v of vars) {
    defs[v.name] = {
      name: v.name,
      type: v.type ?? "string",
      required: v.required,
      typed_default: v.typed_default,
      validation: v.validation,
      render_format: v.render_format,
    }
  }
  return defs
}

function tokenize(body: string): Token[] {
  const tokens: Token[] = []
  const n = body.length
  let i = 0
  let textStart = 0

  const pushText = (end: number) => {
    if (textStart < end) tokens.push({ kind: "text", text: body.slice(textStart, end) })
  }

  while (i < n) {
    const c = body[i]!
    if (c === "\\" && body[i + 1] === "{" && body[i + 2] === "{") {
      // Escaped literal: flush preceding text without the backslash, emit literal braces.
      pushText(i)
      tokens.push({ kind: "text", text: "{{" })
      i += 3
      textStart = i
      continue
    }
    if (c === "{" && body[i + 1] === "{") {
      const close = body.indexOf("}}", i + 2)
      if (close === -1) {
        // Unclosed braces are literal text.
        i += 1
        continue
      }
      const inner = body.slice(i + 2, close)
      const raw = body.slice(i, close + 2)
      const trimmed = inner.trim()
      if (trimmed.startsWith(">")) {
        const slug = trimmed.slice(1).trim()
        if (PARTIAL_PATTERN.test(slug)) {
          pushText(i)
          tokens.push({ kind: "partial", raw, name: slug })
          i = close + 2
          textStart = i
          continue
        }
        // Malformed partial: literal text.
        i += 1
        continue
      }
      const pipe = trimmed.indexOf("|")
      const name = pipe === -1 ? trimmed : trimmed.slice(0, pipe).trim()
      const defaultVal = pipe === -1 ? null : trimmed.slice(pipe + 1).trim()
      if (!NAME_PATTERN.test(name)) {
        // Invalid variable name: literal text (matches legacy regex behavior).
        i += 1
        continue
      }
      pushText(i)
      tokens.push({ kind: "var", raw, name, default: defaultVal })
      i = close + 2
      textStart = i
      continue
    }
    i += 1
  }
  pushText(n)
  return tokens
}

export function extractVariables(body: string): string[] {
  const vars = new Set<string>()
  for (const token of tokenize(body)) {
    if (token.kind === "var" && token.name) vars.add(token.name)
  }
  return Array.from(vars)
}

export function extractVariableInfo(body: string): VariableInfo[] {
  const seen = new Map<string, VariableInfo>()
  for (const token of tokenize(body)) {
    if (token.kind !== "var" || !token.name) continue
    if (!seen.has(token.name)) {
      seen.set(token.name, {
        name: token.name,
        default: token.default ?? null,
        required: token.default === null || token.default === undefined,
      })
    }
  }
  return Array.from(seen.values())
}

/** Resolve a possibly dotted path against a values map. Flat keys win. */
export function getPath(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path]
  const parts = path.split(".")
  if (parts.length === 1) return undefined
  let cur: unknown = values
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined
    if (typeof cur !== "object") return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function isProvided(values: Record<string, unknown>, name: string): boolean {
  return getPath(values, name) !== undefined
}

function formatValue(value: unknown, def: VariableDefinition | undefined): string {
  const fmt = def?.render_format ?? "json"

  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)

  // object / array
  if (fmt === "string") {
    // "string" formatter is only safe for primitives; objects/arrays fall back to JSON.
    return JSON.stringify(value)
  }
  if (fmt === "json-pretty") return JSON.stringify(value, null, 2)
  return JSON.stringify(value)
}

export interface ValidationConstraints {
  pattern?: string
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  enum?: unknown[]
}

function validateValue(value: unknown, validation: string | undefined): string | null {
  if (!validation) return null
  let constraints: ValidationConstraints
  try {
    constraints = JSON.parse(validation) as ValidationConstraints
  } catch {
    return null // malformed persisted constraints never block rendering
  }
  if (constraints.pattern !== undefined) {
    const re = new RegExp(constraints.pattern)
    if (!re.test(String(value))) return `value does not match pattern ${constraints.pattern}`
  }
  if (constraints.min !== undefined && typeof value === "number" && value < constraints.min) {
    return `value ${value} is below min ${constraints.min}`
  }
  if (constraints.max !== undefined && typeof value === "number" && value > constraints.max) {
    return `value ${value} is above max ${constraints.max}`
  }
  if (constraints.minLength !== undefined && String(value).length < constraints.minLength) {
    return `value is shorter than minLength ${constraints.minLength}`
  }
  if (constraints.maxLength !== undefined && String(value).length > constraints.maxLength) {
    return `value is longer than maxLength ${constraints.maxLength}`
  }
  if (constraints.enum !== undefined) {
    const ok = constraints.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))
    if (!ok) return `value is not in the allowed enum`
  }
  return null
}

/** Coerce a provided value toward the declared type. Returns { ok, value } */
function coerceValue(name: string, value: unknown, def: VariableDefinition, strict: boolean): { ok: boolean; value: unknown } {
  const type = def.type
  if (!type || type === "string") return { ok: true, value }
  if (type === "number") {
    if (typeof value === "number") return { ok: true, value }
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return { ok: true, value: Number(value) }
    }
    if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected number)`, "VARIABLE_TYPE_MISMATCH")
    return { ok: false, value }
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return { ok: true, value }
    if (value === "true") return { ok: true, value: true }
    if (value === "false") return { ok: true, value: false }
    if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected boolean)`, "VARIABLE_TYPE_MISMATCH")
    return { ok: false, value }
  }
  // object / array
  if (typeof value === "object" && value !== null) {
    if (type === "array" && !Array.isArray(value)) {
      if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected array)`, "VARIABLE_TYPE_MISMATCH")
      return { ok: false, value }
    }
    if (type === "object" && Array.isArray(value)) {
      if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected object)`, "VARIABLE_TYPE_MISMATCH")
      return { ok: false, value }
    }
    return { ok: true, value }
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value)
      if (type === "array" && !Array.isArray(parsed)) throw new Error("not array")
      if (type === "object" && (Array.isArray(parsed) || parsed === null)) throw new Error("not object")
      return { ok: true, value: parsed }
    } catch {
      if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected ${type})`, "VARIABLE_TYPE_MISMATCH")
      return { ok: false, value }
    }
  }
  if (strict) throw new TemplateRenderError(`VARIABLE_TYPE_MISMATCH: ${name} (expected ${type})`, "VARIABLE_TYPE_MISMATCH")
  return { ok: false, value }
}

export function renderTemplate(
  body: string,
  vars: Record<string, unknown>,
  options: RenderOptions = {}
): RenderResult {
  const strict = options.strict ?? false
  const preview = options.preview ?? false
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const definitions = options.definitions ?? {}
  const resolvePartial = options.resolvePartial

  const missing: string[] = []
  const usedDefaults: string[] = []
  const unresolved: string[] = []
  const resolvedSources: ResolvedSource[] = []
  const activePartials = new Set<string>()

  const renderTokens = (tokens: Token[], depth: number, out: string[]): void => {
    for (const token of tokens) {
      if (token.kind === "text") {
        out.push(token.text ?? "")
        continue
      }
      if (token.kind === "partial") {
        const slug = token.name!
        if (!resolvePartial) {
          if (strict) throw new TemplateRenderError(`PARTIAL_NOT_FOUND: ${slug}`, "PARTIAL_NOT_FOUND")
          if (preview) {
            const marker = `[UNRESOLVED kind:partial slug=${slug}]`
            unresolved.push(slug)
            out.push(marker)
          } else {
            out.push(token.raw ?? "")
          }
          continue
        }
        if (activePartials.has(slug)) {
          throw new TemplateRenderError(`TEMPLATE_CYCLE: partial ${slug} references itself`, "TEMPLATE_CYCLE")
        }
        if (depth >= maxDepth) {
          throw new TemplateRenderError(
            `TEMPLATE_DEPTH_EXCEEDED: partial expansion exceeds max depth ${maxDepth}`,
            "TEMPLATE_DEPTH_EXCEEDED"
          )
        }
        const source = resolvePartial(slug)
        if (!source) {
          if (strict) throw new TemplateRenderError(`PARTIAL_NOT_FOUND: ${slug}`, "PARTIAL_NOT_FOUND")
          if (preview) {
            const marker = `[UNRESOLVED kind:partial slug=${slug}]`
            unresolved.push(slug)
            out.push(marker)
          } else {
            out.push(token.raw ?? "")
          }
          continue
        }
        if (source.id !== undefined && source.version !== undefined) {
          resolvedSources.push({ id: source.id, version: source.version, relation: "partial", slot: null })
        }
        activePartials.add(slug)
        try {
          renderTokens(tokenize(source.body), depth + 1, out)
        } finally {
          activePartials.delete(slug)
        }
        continue
      }
      // variable token
      const name = token.name!
      const def = definitions[name]
      let value: unknown = getPath(vars, name)
      if (value !== undefined) {
        if (def) {
          const coerced = coerceValue(name, value, def, strict)
          if (coerced.ok) value = coerced.value
        }
        const validationError = validateValue(value, def?.validation)
        if (validationError) {
          if (strict) {
            throw new TemplateRenderError(`VARIABLE_VALIDATION_FAILED: ${name} — ${validationError}`, "VARIABLE_VALIDATION_FAILED")
          }
          out.push(formatValue(value, def))
          continue
        }
        out.push(formatValue(value, def))
        continue
      }
      // Not provided: inline default?
      if (token.default !== null && token.default !== undefined) {
        usedDefaults.push(name)
        out.push(token.default)
        continue
      }
      // Typed default from definition?
      if (def && def.typed_default !== undefined) {
        usedDefaults.push(name)
        out.push(formatValue(def.typed_default, def))
        continue
      }
      // Missing required.
      missing.push(name)
      if (strict) continue // collect all missing; throw after the pass
      if (preview) {
        const marker = `[UNRESOLVED kind:var name=${name}]`
        unresolved.push(name)
        out.push(marker)
      } else {
        out.push(token.raw ?? "")
      }
    }
  }

  const out: string[] = []
  renderTokens(tokenize(body), 0, out)

  const rendered = out.join("")

  if (rendered.length > maxBytes) {
    throw new TemplateRenderError(
      `TEMPLATE_BYTE_BUDGET_EXCEEDED: rendered output ${rendered.length} bytes exceeds max ${maxBytes}`,
      "TEMPLATE_BYTE_BUDGET_EXCEEDED"
    )
  }

  if (strict && missing.length > 0) {
    throw new TemplateRenderError(
      `MISSING_VARIABLE: ${missing.join(", ")}`,
      "MISSING_VARIABLE",
      missing
    )
  }

  const result: RenderResult = { rendered, missing_vars: missing, used_defaults: usedDefaults }
  if (unresolved.length > 0) result.unresolved = unresolved
  if (resolvedSources.length > 0) result.resolved_sources = resolvedSources
  return result
}

export function validateVars(
  body: string,
  provided: Record<string, unknown>,
  definitions?: Record<string, VariableDefinition>
): { missing: string[]; extra: string[]; optional: string[] } {
  const infos = extractVariableInfo(body)
  const all = infos.map((v) => v.name)

  const required: string[] = []
  const optional: string[] = []
  for (const info of infos) {
    const def = definitions?.[info.name]
    const hasTypedDefault = def?.typed_default !== undefined
    if (hasTypedDefault || !info.required) optional.push(info.name)
    else required.push(info.name)
  }

  const missing = required.filter((v) => !isProvided(provided, v))
  const extra = Object.keys(provided).filter((v) => {
    if (all.includes(v)) return false
    // Skip ancestor keys of declared dot paths (e.g. "request" for "request.owner.name")
    if (all.some((declared) => declared.startsWith(`${v}.`))) return false
    return true
  })

  return { missing, extra, optional }
}

export function isDeclarationShape(input: unknown): input is VariableSchemaEntry {
  if (!input || typeof input !== "object") return false
  const candidate = input as Record<string, unknown>
  return typeof candidate["name"] === "string"
}
