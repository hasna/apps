import { getDatabase } from "./database.js"
import { generateId } from "../lib/ids.js"
import { getPrompt } from "./prompts.js"
import { loadPromptVariables } from "./variables.js"
import { renderTemplate, definitionsFromVariables } from "../lib/template.js"
import type { RenderOptions } from "../lib/template.js"
import { TemplateRenderError, PromptNotFoundError } from "../types/index.js"
import type {
  Prompt,
  PromptDependency,
  PromptDependencyRelation,
  RenderResult,
  ResolvedSource,
} from "../types/index.js"

interface DependencyRow {
  id: string
  prompt_id: string
  dependency_prompt_id: string
  dependency_slug: string
  relation: PromptDependencyRelation
  slot: string | null
  pinned_version: number | null
  ordering: number
  created_at: string
}

function rowToDependency(row: DependencyRow): PromptDependency {
  return { ...row }
}

const MAX_PARENT_DEPTH = 10

/**
 * Set a dependency (one parent or one partial). The dependency resolves at set time,
 * so a missing prompt fails loudly here. The current version is pinned for
 * reproducible dispatch.
 */
export function setDependency(
  promptId: string,
  dependencyRef: string,
  relation: PromptDependencyRelation,
  options: { slot?: string | null } = {}
): PromptDependency {
  const db = getDatabase()
  const dependency = getPrompt(dependencyRef)
  if (!dependency) throw new PromptNotFoundError(dependencyRef)

  if (relation === "parent") {
    // No multiple inheritance: replace any existing parent.
    db.run("DELETE FROM prompt_dependencies WHERE prompt_id = ? AND relation = 'parent'", [promptId])
  }

  const id = generateId("PDEP")
  const ordering = (db.query(
    "SELECT COUNT(*) as n FROM prompt_dependencies WHERE prompt_id = ? AND relation = ?"
  ).get(promptId, relation) as { n: number }).n

  db.run(
    `INSERT OR REPLACE INTO prompt_dependencies
       (id, prompt_id, dependency_prompt_id, dependency_slug, relation, slot, pinned_version, ordering)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      promptId,
      dependency.id,
      dependency.slug,
      relation,
      options.slot ?? null,
      dependency.version,
      ordering,
    ]
  )

  const row = db
    .query(
      "SELECT * FROM prompt_dependencies WHERE prompt_id = ? AND relation = ? AND dependency_prompt_id = ? AND COALESCE(slot, '') = ?"
    )
    .get(promptId, relation, dependency.id, options.slot ?? "") as DependencyRow
  return rowToDependency(row)
}

export function setParent(promptId: string, dependencyRef: string): PromptDependency {
  return setDependency(promptId, dependencyRef, "parent")
}

export function setPartial(promptId: string, dependencyRef: string, slot?: string | null): PromptDependency {
  return setDependency(promptId, dependencyRef, "partial", { slot })
}

export function removeDependency(promptId: string, relation: PromptDependencyRelation, dependencyRef?: string): void {
  const db = getDatabase()
  if (dependencyRef) {
    const dependency = getPrompt(dependencyRef)
    db.run("DELETE FROM prompt_dependencies WHERE prompt_id = ? AND relation = ? AND dependency_prompt_id = ?", [
      promptId,
      relation,
      dependency?.id ?? null,
    ])
  } else {
    db.run("DELETE FROM prompt_dependencies WHERE prompt_id = ? AND relation = ?", [promptId, relation])
  }
}

export function listDependencies(promptId: string): PromptDependency[] {
  const db = getDatabase()
  const rows = db
    .query("SELECT * FROM prompt_dependencies WHERE prompt_id = ? ORDER BY ordering ASC, created_at ASC")
    .all(promptId) as DependencyRow[]
  return rows.map(rowToDependency)
}

export function getParent(promptId: string): PromptDependency | null {
  const db = getDatabase()
  const row = db
    .query("SELECT * FROM prompt_dependencies WHERE prompt_id = ? AND relation = 'parent'")
    .get(promptId) as DependencyRow | null
  return row ? rowToDependency(row) : null
}

/**
 * Walk the parent chain (depth-bounded, cycle-checked) and produce the composed
 * body: outermost parent first, the child last. No multiple inheritance is
 * possible — a prompt has at most one parent.
 */
export function composeBodyWithParent(prompt: Prompt): { body: string; sources: ResolvedSource[] } {
  const chain: Array<{ body: string; source: ResolvedSource }> = []
  const seen = new Set<string>()
  let current = prompt
  let hops = 0

  for (;;) {
    if (seen.has(current.id)) {
      throw new TemplateRenderError(
        `TEMPLATE_CYCLE: parent chain references ${current.id} more than once`,
        "TEMPLATE_CYCLE"
      )
    }
    seen.add(current.id)

    const parent = getParent(current.id)
    if (!parent) break

    if (hops >= MAX_PARENT_DEPTH) {
      throw new TemplateRenderError(
        `PARENT_DEPTH_EXCEEDED: parent chain exceeds max depth ${MAX_PARENT_DEPTH}`,
        "PARENT_DEPTH_EXCEEDED"
      )
    }
    hops += 1

    const parentPrompt = getPrompt(parent.dependency_prompt_id)
    if (!parentPrompt) {
      throw new TemplateRenderError(
        `PARENT_NOT_FOUND: ${parent.dependency_slug} (${parent.dependency_prompt_id})`,
        "PARENT_NOT_FOUND"
      )
    }
    chain.unshift({
      body: parentPrompt.body,
      source: {
        id: parentPrompt.id,
        version: parent.pinned_version ?? parentPrompt.version,
        relation: "parent",
        slot: null,
      },
    })
    current = parentPrompt
  }

  const bodies = chain.map((entry) => entry.body)
  bodies.push(prompt.body)
  return {
    body: bodies.join("\n\n"),
    sources: chain.map((entry) => entry.source),
  }
}

/**
 * Dependency-aware render: compose the parent chain, resolve partials through the
 * store, apply persisted variable definitions, and honor strict/preview bounds.
 * Resolved sources are collected in receipt order: self, parents, partials.
 */
export function renderPromptTemplate(
  prompt: Prompt,
  vars: Record<string, unknown>,
  options: Omit<RenderOptions, "resolvePartial" | "definitions"> = {}
): RenderResult {
  const composed = composeBodyWithParent(prompt)
  const partialSources: ResolvedSource[] = []

  const definitions = definitionsFromVariables(loadPromptVariables(prompt.id))

  const result = renderTemplate(composed.body, vars, {
    ...options,
    definitions,
    resolvePartial: (slug) => {
      const dep = getPrompt(slug)
      if (!dep) return null
      partialSources.push({ id: dep.id, version: dep.version, relation: "partial", slot: null })
      return { body: dep.body, id: dep.id, version: dep.version }
    },
  })

  const resolved = result.resolved_sources ?? []
  const all: ResolvedSource[] = [
    { id: prompt.id, version: prompt.version, relation: "self", slot: null },
    ...composed.sources,
    ...partialSources,
  ]
  // Only renders that resolved dependencies carry a receipt-worthy source list;
  // a plain render keeps an explicit empty list.
  const hasDependencies = resolved.length > 0 || composed.sources.length > 0
  result.resolved_sources = hasDependencies ? all : []
  return result
}
