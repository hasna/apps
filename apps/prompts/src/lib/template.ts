import type { RenderResult } from "../types/index.js"

// Matches {{varName}}, {{varName|default value}}, {{ varName | default }}
const VAR_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|\s*(.*?)\s*)?\}\}/g

export function extractVariables(body: string): string[] {
  const vars = new Set<string>()
  const pattern = new RegExp(VAR_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    if (match[1]) vars.add(match[1])
  }
  return Array.from(vars)
}

export interface VariableInfo {
  name: string
  default: string | null
  required: boolean
}

export function extractVariableInfo(body: string): VariableInfo[] {
  const seen = new Map<string, VariableInfo>()
  const pattern = new RegExp(VAR_PATTERN.source, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1]
    if (!name) continue
    const defaultVal = match[2] !== undefined ? match[2] : null
    if (!seen.has(name)) {
      seen.set(name, { name, default: defaultVal, required: defaultVal === null })
    }
  }
  return Array.from(seen.values())
}

export function renderTemplate(body: string, vars: Record<string, string>): RenderResult {
  const missing: string[] = []
  const usedDefaults: string[] = []

  const rendered = body.replace(VAR_PATTERN, (_match, name: string, defaultVal?: string) => {
    if (name in vars) return vars[name] ?? ""
    if (defaultVal !== undefined) {
      usedDefaults.push(name)
      return defaultVal
    }
    missing.push(name)
    return _match // leave unresolved placeholder
  })

  return { rendered, missing_vars: missing, used_defaults: usedDefaults }
}

export function validateVars(
  body: string,
  provided: Record<string, string>
): { missing: string[]; extra: string[]; optional: string[] } {
  const infos = extractVariableInfo(body)
  const required = infos.filter((v) => v.required).map((v) => v.name)
  const optional = infos.filter((v) => !v.required).map((v) => v.name)
  const all = infos.map((v) => v.name)

  const missing = required.filter((v) => !(v in provided))
  const extra = Object.keys(provided).filter((v) => !all.includes(v))

  return { missing, extra, optional }
}
