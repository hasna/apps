#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { getPrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { registerAgent } from "../db/agents.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject } from "../db/database.js"
import { getDatabase } from "../db/database.js"
import { searchPrompts, findSimilar } from "../lib/search.js"
import { renderTemplate, extractVariableInfo, validateVars } from "../lib/template.js"
import { importFromJson, exportToJson } from "../lib/importer.js"
import { maybeSaveMemento } from "../lib/mementos.js"
import { lintAll } from "../lib/lint.js"

const server = new McpServer({ name: "open-prompts", version: "0.1.0" })

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true }
}

// ── prompts_save ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_save",
  {
    description: "Save (create or update) a reusable prompt. Upserts by slug. Auto-detects template variables ({{var}}).",
    inputSchema: {
      title: z.string().describe("Human-readable title"),
      body: z.string().describe("Prompt content. Use {{var}} or {{var|default}} for template variables."),
      slug: z.string().optional().describe("Unique slug (auto-generated from title if omitted)"),
      description: z.string().optional().describe("Short description of what this prompt does"),
      collection: z.string().optional().describe("Collection/namespace (default: 'default')"),
      tags: z.array(z.string()).optional().describe("Tags for filtering and search"),
      source: z.enum(["manual", "ai-session", "imported"]).optional().describe("Where this prompt came from"),
      changed_by: z.string().optional().describe("Agent name making this change"),
      force: z.boolean().optional().describe("Save even if a similar prompt already exists"),
      project: z.string().optional().describe("Project name, slug, or ID to scope this prompt to"),
    },
  },
  async (args) => {
    try {
      const { force, project, ...input } = args
      if (project) {
        const db = getDatabase()
        const pid = resolveProject(db, project)
        if (!pid) return err(`Project not found: ${project}`)
        ;(input as typeof input & { project_id?: string }).project_id = pid
      }
      const { prompt, created, duplicate_warning } = upsertPrompt(input, force ?? false)
      return ok({ ...prompt, _created: created, _duplicate_warning: duplicate_warning ?? null })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_get ───────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_get",
  {
    description: "Get a prompt by ID, slug, or partial ID.",
    inputSchema: { id: z.string().describe("Prompt ID (PRMT-00001), slug, or partial ID") },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(prompt)
  }
)

// ── prompts_list ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_list",
  {
    description: "List prompts with optional filters.",
    inputSchema: {
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_template: z.boolean().optional(),
      source: z.enum(["manual", "ai-session", "imported"]).optional(),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
      project: z.string().optional().describe("Project name, slug, or ID — shows project prompts first, then globals"),
    },
  },
  async ({ project, ...args }) => {
    if (project) {
      const db = getDatabase()
      const pid = resolveProject(db, project)
      if (!pid) return err(`Project not found: ${project}`)
      return ok(listPrompts({ ...args, project_id: pid }))
    }
    return ok(listPrompts(args))
  }
)

// ── prompts_delete ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_delete",
  {
    description: "Delete a prompt by ID or slug.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try {
      deletePrompt(id)
      return ok({ deleted: true, id })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_use ───────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_use",
  {
    description: "Get a prompt's body and increment its use counter. This is the primary way to retrieve a prompt for actual use.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      agent: z.string().optional().describe("Agent ID for mementos integration"),
    },
  },
  async ({ id, agent }) => {
    try {
      const prompt = usePrompt(id)
      await maybeSaveMemento({ slug: prompt.slug, body: prompt.body, agentId: agent })
      return ok({ body: prompt.body, prompt })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_render ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_render",
  {
    description: "Render a template prompt by filling in {{variables}}. Returns rendered body plus info on missing/defaulted vars.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      vars: z.record(z.string()).describe("Variable values as key-value pairs"),
      agent: z.string().optional().describe("Agent ID for mementos integration"),
    },
  },
  async ({ id, vars, agent }) => {
    try {
      const prompt = usePrompt(id)
      const result = renderTemplate(prompt.body, vars)
      await maybeSaveMemento({ slug: prompt.slug, body: prompt.body, rendered: result.rendered, agentId: agent })
      return ok(result)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_list_templates ────────────────────────────────────────────────────
server.registerTool(
  "prompts_list_templates",
  {
    description: "List only template prompts (those with {{variables}}).",
    inputSchema: {
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional().default(50),
    },
  },
  async (args) => ok(listPrompts({ ...args, is_template: true }))
)

// ── prompts_variables ─────────────────────────────────────────────────────────
server.registerTool(
  "prompts_variables",
  {
    description: "Inspect what variables a template needs, including defaults and required status.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    const vars = extractVariableInfo(prompt.body)
    return ok({ prompt_id: prompt.id, slug: prompt.slug, variables: vars })
  }
)

// ── prompts_search ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_search",
  {
    description: "Full-text search across prompt name, slug, title, body, description, and tags. Uses FTS5 BM25 ranking.",
    inputSchema: {
      q: z.string().describe("Search query"),
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_template: z.boolean().optional(),
      source: z.enum(["manual", "ai-session", "imported"]).optional(),
      limit: z.number().optional().default(20),
      project: z.string().optional().describe("Project name, slug, or ID to scope search"),
    },
  },
  async ({ q, project, ...filter }) => {
    if (project) {
      const db = getDatabase()
      const pid = resolveProject(db, project)
      if (!pid) return err(`Project not found: ${project}`)
      return ok(searchPrompts(q, { ...filter, project_id: pid }))
    }
    return ok(searchPrompts(q, filter))
  }
)

// ── prompts_similar ───────────────────────────────────────────────────────────
server.registerTool(
  "prompts_similar",
  {
    description: "Find prompts similar to a given prompt (by tag overlap and collection).",
    inputSchema: {
      id: z.string(),
      limit: z.number().optional().default(5),
    },
  },
  async ({ id, limit }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(findSimilar(prompt.id, limit))
  }
)

// ── prompts_collections ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_collections",
  {
    description: "List all prompt collections with prompt counts.",
    inputSchema: {},
  },
  async () => ok(listCollections())
)

// ── prompts_move ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_move",
  {
    description: "Move a prompt to a different collection.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      collection: z.string().describe("Target collection name"),
    },
  },
  async ({ id, collection }) => {
    try {
      movePrompt(id, collection)
      return ok({ moved: true, id, collection })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_history ───────────────────────────────────────────────────────────
server.registerTool(
  "prompts_history",
  {
    description: "Get version history for a prompt.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(listVersions(prompt.id))
  }
)

// ── prompts_restore ───────────────────────────────────────────────────────────
server.registerTool(
  "prompts_restore",
  {
    description: "Restore a prompt to a previous version.",
    inputSchema: {
      id: z.string(),
      version: z.number().describe("Version number to restore"),
      changed_by: z.string().optional(),
    },
  },
  async ({ id, version, changed_by }) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) return err(`Prompt not found: ${id}`)
      restoreVersion(prompt.id, version, changed_by)
      return ok({ restored: true, id: prompt.id, version })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_export ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_export",
  {
    description: "Export prompts as JSON.",
    inputSchema: {
      collection: z.string().optional().describe("Export only this collection"),
    },
  },
  async ({ collection }) => {
    const data = exportToJson(collection)
    return ok(data)
  }
)

// ── prompts_import ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_import",
  {
    description: "Import prompts from a JSON array (as produced by prompts_export).",
    inputSchema: {
      prompts: z.array(z.object({
        title: z.string(),
        body: z.string(),
        slug: z.string().optional(),
        description: z.string().optional(),
        collection: z.string().optional(),
        tags: z.array(z.string()).optional(),
      })).describe("Array of prompt objects to import"),
      changed_by: z.string().optional(),
    },
  },
  async ({ prompts, changed_by }) => {
    const results = importFromJson(prompts, changed_by)
    return ok(results)
  }
)

// ── prompts_update ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_update",
  {
    description: "Update an existing prompt's fields.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      description: z.string().optional(),
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      changed_by: z.string().optional(),
    },
  },
  async ({ id, ...updates }) => {
    try {
      const prompt = updatePrompt(id, updates)
      return ok(prompt)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_validate_vars ─────────────────────────────────────────────────────
server.registerTool(
  "prompts_validate_vars",
  {
    description: "Validate which variables are required, optional, or extra for a template.",
    inputSchema: {
      id: z.string(),
      vars: z.record(z.string()).optional().describe("Variables you plan to provide"),
    },
  },
  async ({ id, vars = {} }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(validateVars(prompt.body, vars))
  }
)

// ── prompts_register_agent ────────────────────────────────────────────────────
server.registerTool(
  "prompts_register_agent",
  {
    description: "Register an agent to track which agent saved/used prompts.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
    },
  },
  async ({ name, description }) => ok(registerAgent(name, description))
)

// ── prompts_ensure_collection ─────────────────────────────────────────────────
server.registerTool(
  "prompts_ensure_collection",
  {
    description: "Create a collection if it doesn't exist.",
    inputSchema: {
      name: z.string(),
      description: z.string().optional(),
    },
  },
  async ({ name, description }) => ok(ensureCollection(name, description))
)

// ── prompts_save_from_session ─────────────────────────────────────────────────
server.registerTool(
  "prompts_save_from_session",
  {
    description:
      "Minimal frictionless save for AI agents mid-conversation. The agent is expected to derive title, slug, and tags from the body before calling this. Automatically sets source=ai-session. Perfect for 'save this as a reusable prompt' moments.",
    inputSchema: {
      title: z.string().describe("A short descriptive title for this prompt"),
      body: z.string().describe("The prompt content to save"),
      slug: z.string().optional().describe("URL-friendly identifier (auto-generated from title if omitted)"),
      tags: z.array(z.string()).optional().describe("Relevant tags extracted from the prompt context"),
      collection: z.string().optional().describe("Collection to save into (default: 'sessions')"),
      description: z.string().optional().describe("One-line description of what this prompt does"),
      agent: z.string().optional().describe("Agent name saving this prompt"),
      project: z.string().optional().describe("Project name, slug, or ID to scope this prompt to"),
    },
  },
  async ({ title, body, slug, tags, collection, description, agent, project }) => {
    try {
      let project_id: string | undefined
      if (project) {
        const db = getDatabase()
        const pid = resolveProject(db, project)
        if (!pid) return err(`Project not found: ${project}`)
        project_id = pid
      }
      const { prompt, created } = upsertPrompt({
        title,
        body,
        slug,
        tags,
        collection: collection ?? "sessions",
        description,
        source: "ai-session",
        changed_by: agent,
        project_id,
      })
      return ok({ ...prompt, _created: created, _tip: created ? `Saved as "${prompt.slug}". Use prompts_use("${prompt.slug}") to retrieve it.` : `Updated existing prompt "${prompt.slug}".` })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_pin ───────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_pin",
  {
    description: "Pin a prompt so it always appears first in lists.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try { return ok(pinPrompt(id, true)) }
    catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  }
)

server.registerTool(
  "prompts_unpin",
  {
    description: "Unpin a previously pinned prompt.",
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    try { return ok(pinPrompt(id, false)) }
    catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  }
)

// ── prompts_recent ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_recent",
  {
    description: "Get recently used prompts, ordered by last_used_at descending.",
    inputSchema: { limit: z.number().optional().default(10) },
  },
  async ({ limit }) => {
    const prompts = listPrompts({ limit: 500 })
      .filter((p) => p.last_used_at !== null)
      .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))
      .slice(0, limit)
    return ok(prompts)
  }
)

// ── prompts_lint ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_lint",
  {
    description: "Check prompt quality: missing descriptions, undocumented template vars, short bodies, no tags.",
    inputSchema: { collection: z.string().optional() },
  },
  async ({ collection }) => {
    const prompts = listPrompts({ collection, limit: 10000 })
    const results = lintAll(prompts)
    const summary = {
      total_checked: prompts.length,
      prompts_with_issues: results.length,
      errors: results.flatMap((r) => r.issues).filter((i) => i.severity === "error").length,
      warnings: results.flatMap((r) => r.issues).filter((i) => i.severity === "warn").length,
      info: results.flatMap((r) => r.issues).filter((i) => i.severity === "info").length,
      results,
    }
    return ok(summary)
  }
)

// ── prompts_stale ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_stale",
  {
    description: "List prompts not used in N days. Useful for library hygiene.",
    inputSchema: { days: z.number().optional().default(30).describe("Inactivity threshold in days") },
  },
  async ({ days }) => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const all = listPrompts({ limit: 10000 })
    const stale = all
      .filter((p) => p.last_used_at === null || p.last_used_at < cutoff)
      .sort((a, b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? ""))
    return ok({ stale, count: stale.length, threshold_days: days })
  }
)

// ── prompts_stats ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_stats",
  {
    description: "Get usage statistics: most used prompts, recently used, counts by collection and source.",
    inputSchema: {},
  },
  async () => ok(getPromptStats())
)

// ── prompts_project_create ────────────────────────────────────────────────────
server.registerTool(
  "prompts_project_create",
  {
    description: "Create a new project to scope prompts.",
    inputSchema: {
      name: z.string().describe("Project name"),
      description: z.string().optional().describe("Short description"),
      path: z.string().optional().describe("Optional filesystem path this project maps to"),
    },
  },
  async ({ name, description, path }) => {
    try {
      return ok(createProject({ name, description, path }))
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_project_list ──────────────────────────────────────────────────────
server.registerTool(
  "prompts_project_list",
  {
    description: "List all projects with prompt counts.",
    inputSchema: {},
  },
  async () => ok(listProjects())
)

// ── prompts_project_get ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_project_get",
  {
    description: "Get a project by ID, slug, or name.",
    inputSchema: { id: z.string().describe("Project ID, slug, or name") },
  },
  async ({ id }) => {
    const project = getProject(id)
    if (!project) return err(`Project not found: ${id}`)
    return ok(project)
  }
)

// ── prompts_project_delete ────────────────────────────────────────────────────
server.registerTool(
  "prompts_project_delete",
  {
    description: "Delete a project. Prompts in the project become global (project_id set to null).",
    inputSchema: { id: z.string().describe("Project ID, slug, or name") },
  },
  async ({ id }) => {
    try {
      deleteProject(id)
      return ok({ deleted: true, id })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)
