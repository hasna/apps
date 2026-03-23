#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt, setExpiry, getTrending, promptToSaveResult } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { registerAgent, listAgents, heartbeatAgent, setAgentFocus } from "../db/agents.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject } from "../db/database.js"
import { getDatabase } from "../db/database.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "../lib/search.js"
import { renderTemplate, extractVariableInfo, validateVars } from "../lib/template.js"
import { importFromJson, exportToJson, scanAndImportSlashCommands } from "../lib/importer.js"
import { maybeSaveMemento } from "../lib/mementos.js"
import { createSchedule, listSchedules, getSchedule, deleteSchedule, getDueSchedules } from "../db/schedules.js"
import { validateCron, getNextRunTime } from "../lib/cron.js"
import { diffTexts, formatDiff } from "../lib/diff.js"
import { lintAll } from "../lib/lint.js"
import { runAudit } from "../lib/audit.js"

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
      return ok(promptToSaveResult(prompt, created, duplicate_warning))
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
    description: "List prompts (slim by default — no body). Use prompts_use or prompts_body to get the actual body. Pass include_body:true only if you need body text for all results. summary_only:true returns just id+slug+title for maximum token savings.",
    inputSchema: {
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_template: z.boolean().optional(),
      source: z.enum(["manual", "ai-session", "imported"]).optional(),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
      project: z.string().optional().describe("Project name, slug, or ID"),
      include_body: z.boolean().optional().describe("Include full body text (expensive — avoid unless needed)"),
      summary_only: z.boolean().optional().describe("Return only id+slug+title — maximum token savings"),
    },
  },
  async ({ project, include_body, summary_only, ...args }) => {
    let project_id: string | undefined
    if (project) {
      const db = getDatabase()
      const pid = resolveProject(db, project)
      if (!pid) return err(`Project not found: ${project}`)
      project_id = pid
    }
    const filter = { ...args, ...(project_id ? { project_id } : {}) }
    if (summary_only) {
      const items = listPromptsSlim(filter)
      return ok(items.map((p) => ({ id: p.id, slug: p.slug, title: p.title })))
    }
    if (include_body) return ok(listPrompts(filter))
    return ok(listPromptsSlim(filter))
  }
)

// ── prompts_delete ────────────────────────────────────────────────────────────
// ── prompts_body ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_body",
  {
    description: "Get just the body text of a prompt without incrementing the use counter. Use prompts_use when you want to actually use a prompt (increments counter). Use this just to read/inspect the body.",
    inputSchema: { id: z.string().describe("Prompt ID or slug") },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok({ id: prompt.id, slug: prompt.slug, body: prompt.body, is_template: prompt.is_template, variable_names: prompt.variables.map((v) => v.name) })
  }
)

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

      // Auto-fill known agent context variables if agent ID is provided
      const autoFilled: Record<string, string> = {}
      if (agent) {
        // Known variables that can be auto-filled from agent context
        const CONTEXT_VARS: Record<string, () => string | undefined> = {
          agent_name: () => agent,
          agent_id: () => agent,
          project_id: () => process.env.TODOS_PROJECT_ID || process.env.PROJECT_ID,
          org_id: () => process.env.ORG_ID,
          session_id: () => process.env.SESSION_ID,
          cwd: () => process.cwd(),
          date: () => new Date().toISOString().split('T')[0],
          datetime: () => new Date().toISOString(),
        }
        for (const [key, getter] of Object.entries(CONTEXT_VARS)) {
          if (!(key in vars)) {
            const val = getter()
            if (val) autoFilled[key] = val
          }
        }
      }

      const mergedVars = { ...autoFilled, ...vars }
      const result = renderTemplate(prompt.body, mergedVars)
      if (Object.keys(autoFilled).length > 0) {
        (result as unknown as Record<string, unknown>).auto_filled = autoFilled
      }
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
  async (args) => ok(listPromptsSlim({ ...args, is_template: true }))
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
    description: "Search prompts by text (FTS5 BM25). Returns slim results with snippet — no body. Use prompts_use/prompts_body to get the body of a result.",
    inputSchema: {
      q: z.string().describe("Search query"),
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      is_template: z.boolean().optional(),
      source: z.enum(["manual", "ai-session", "imported"]).optional(),
      limit: z.number().optional().default(10),
      project: z.string().optional(),
      include_body: z.boolean().optional().describe("Include full body in results (expensive)"),
    },
  },
  async ({ q, project, include_body, ...filter }) => {
    let project_id: string | undefined
    if (project) {
      const db = getDatabase()
      const pid = resolveProject(db, project)
      if (!pid) return err(`Project not found: ${project}`)
      project_id = pid
    }
    const f = { ...filter, ...(project_id ? { project_id } : {}) }
    if (include_body) return ok(searchPrompts(q, f))
    return ok(searchPromptsSlim(q, f))
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

// ── prompts_export_as_skills ──────────────────────────────────────────────────
server.registerTool(
  "prompts_export_as_skills",
  {
    description: "Export prompts as Claude Code SKILL.md files in ~/.claude/skills/ so they become /slug slash commands. Each prompt slug becomes an invocable skill.",
    inputSchema: {
      collection: z.string().optional().describe("Only export prompts from this collection"),
      slugs: z.array(z.string()).optional().describe("Specific prompt slugs to export"),
      target_dir: z.string().optional().describe("Target skills directory (default: ~/.claude/skills)"),
      overwrite: z.boolean().optional().describe("Overwrite existing skill files (default: false)"),
    },
  },
  async ({ collection, slugs, target_dir, overwrite }) => {
    try {
      const { mkdirSync, writeFileSync, existsSync } = await import("fs")
      const { join } = await import("path")
      const { homedir } = await import("os")

      const skillsDir = target_dir ?? join(homedir(), ".claude", "skills")
      mkdirSync(skillsDir, { recursive: true })

      const filter = collection ? { collection } : {}
      const allPrompts = listPrompts(filter)
      const toExport = slugs ? allPrompts.filter(p => slugs.includes(p.slug)) : allPrompts

      const exported: string[] = []
      const skipped: string[] = []

      for (const prompt of toExport) {
        const skillDir = join(skillsDir, `skill-${prompt.slug}`)
        const skillFile = join(skillDir, "SKILL.md")

        if (!overwrite && existsSync(skillFile)) {
          skipped.push(prompt.slug)
          continue
        }

        mkdirSync(skillDir, { recursive: true })
        const skillContent = [
          "---",
          `name: skill-${prompt.slug}`,
          `description: ${prompt.description || prompt.title}`,
          "user_invocable: true",
          "---",
          "",
          prompt.body,
        ].join("\n")

        writeFileSync(skillFile, skillContent, "utf-8")
        exported.push(prompt.slug)
      }

      return ok({
        exported: exported.length,
        skipped: skipped.length,
        skills_dir: skillsDir,
        exported_slugs: exported,
        message: `Exported ${exported.length} prompt(s) as skills. Use /skill-{slug} to invoke them.`,
      })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_import_slash_commands ─────────────────────────────────────────────
server.registerTool(
  "prompts_import_slash_commands",
  {
    description: "Auto-scan .claude/commands, .codex/skills, .gemini/extensions (both project and home dir) and import all .md files as prompts.",
    inputSchema: {
      dir: z.string().optional().describe("Root directory to scan (default: cwd)"),
      changed_by: z.string().optional(),
    },
  },
  async ({ dir, changed_by }) => {
    const rootDir = dir ?? process.cwd()
    const result = scanAndImportSlashCommands(rootDir, changed_by)
    return ok(result)
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
      return ok(promptToSaveResult(prompt, false))
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

// ── register_agent ───────────────────────────────────────────────────────────
server.registerTool(
  "register_agent",
  {
    description: "Register an agent (idempotent). Auto-updates last_seen_at on re-register.",
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
      pin: z.boolean().optional().describe("Pin the prompt immediately so it surfaces first in all lists"),
    },
  },
  async ({ title, body, slug, tags, collection, description, agent, project, pin }) => {
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
      if (pin) pinPrompt(prompt.id, true)
      const result = promptToSaveResult(prompt, created)
      return ok({ ...result, pinned: pin ?? false, _tip: created ? `Saved as "${prompt.slug}". Use prompts_use("${prompt.slug}") to retrieve it.` : `Updated "${prompt.slug}".` })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_audit ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_audit",
  {
    description: "Run a full audit: orphaned project refs, empty collections, missing version history, near-duplicate slugs, expired prompts.",
    inputSchema: {},
  },
  async () => ok(runAudit())
)

// ── prompts_unused ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_unused",
  {
    description: "List prompts with use_count = 0 — never used. Good for library cleanup.",
    inputSchema: { collection: z.string().optional(), limit: z.number().optional().default(50) },
  },
  async ({ collection, limit }) => {
    const all = listPromptsSlim({ collection, limit: 10000 })
    const unused = all.filter((p) => p.use_count === 0)
      .slice(0, limit)
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title, collection: p.collection, created_at: p.created_at }))
    return ok({ unused, count: unused.length })
  }
)

// ── prompts_trending ──────────────────────────────────────────────────────────
server.registerTool(
  "prompts_trending",
  {
    description: "Get most-used prompts in the last N days based on per-use log.",
    inputSchema: {
      days: z.number().optional().default(7),
      limit: z.number().optional().default(10),
    },
  },
  async ({ days, limit }) => ok(getTrending(days, limit))
)

// ── prompts_set_expiry ────────────────────────────────────────────────────────
server.registerTool(
  "prompts_set_expiry",
  {
    description: "Set or clear an expiry date on a prompt. Pass expires_at=null to clear.",
    inputSchema: {
      id: z.string(),
      expires_at: z.string().nullable().describe("ISO date string (e.g. 2026-12-31) or null to clear"),
    },
  },
  async ({ id, expires_at }) => {
    try { return ok(setExpiry(id, expires_at)) }
    catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  }
)

// ── prompts_duplicate ─────────────────────────────────────────────────────────
server.registerTool(
  "prompts_duplicate",
  {
    description: "Clone a prompt with a new slug. Copies body, tags, collection, description. Version resets to 1.",
    inputSchema: {
      id: z.string(),
      slug: z.string().optional().describe("New slug (auto-generated if omitted)"),
      title: z.string().optional().describe("New title (defaults to 'Copy of <original>')"),
    },
  },
  async ({ id, slug, title }) => {
    try {
      const source = getPrompt(id)
      if (!source) return err(`Prompt not found: ${id}`)
      const { prompt } = upsertPrompt({
        title: title ?? `Copy of ${source.title}`,
        slug,
        body: source.body,
        description: source.description ?? undefined,
        collection: source.collection,
        tags: source.tags,
        source: "manual",
      })
      return ok(prompt)
    } catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  }
)

// ── prompts_diff ──────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_diff",
  {
    description: "Show a line diff between two versions of a prompt body. v2 defaults to current version.",
    inputSchema: {
      id: z.string(),
      v1: z.number().describe("First version number"),
      v2: z.number().optional().describe("Second version (default: current)"),
    },
  },
  async ({ id, v1, v2 }) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) return err(`Prompt not found: ${id}`)
      const versions = listVersions(prompt.id)
      const versionA = versions.find((v) => v.version === v1)
      if (!versionA) return err(`Version ${v1} not found`)
      const bodyB = v2 ? (versions.find((v) => v.version === v2)?.body ?? null) : prompt.body
      if (bodyB === null) return err(`Version ${v2} not found`)
      const lines = diffTexts(versionA.body, bodyB)
      return ok({ lines, formatted: formatDiff(lines), v1, v2: v2 ?? prompt.version })
    } catch (e) { return err(e instanceof Error ? e.message : String(e)) }
  }
)

// ── prompts_chain ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_chain",
  {
    description: "Set or get the next prompt in a chain. After using prompt A, the agent is suggested prompt B. Pass next_prompt=null to clear.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      next_prompt: z.string().nullable().optional().describe("Slug of the next prompt in the chain, or null to clear"),
    },
  },
  async ({ id, next_prompt }) => {
    try {
      if (next_prompt !== undefined) {
        const p = setNextPrompt(id, next_prompt ?? null)
        return ok(p)
      }
      // Show full chain
      const chain: Array<{ id: string; slug: string; title: string }> = []
      let cur = getPrompt(id)
      const seen = new Set<string>()
      while (cur && !seen.has(cur.id)) {
        chain.push({ id: cur.id, slug: cur.slug, title: cur.title })
        seen.add(cur.id)
        cur = cur.next_prompt ? getPrompt(cur.next_prompt) : null
      }
      return ok(chain)
    } catch (e) { return err(e instanceof Error ? e.message : String(e)) }
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
    description: "Get recently used prompts (slim — no body). Returns id, slug, title, tags, use_count, last_used_at.",
    inputSchema: { limit: z.number().optional().default(10) },
  },
  async ({ limit }) => {
    const prompts = listPromptsSlim({ limit: 500 })
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
    const all = listPromptsSlim({ limit: 10000 })
    const stale = all
      .filter((p) => p.last_used_at === null || p.last_used_at < cutoff)
      .sort((a, b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? ""))
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title, last_used_at: p.last_used_at, use_count: p.use_count }))
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

// ── prompts_schedule ──────────────────────────────────────────────────────────
server.registerTool(
  "prompts_schedule",
  {
    description: "Schedule a prompt to run on a cron. Stores the schedule in the DB. Call prompts_get_due periodically (e.g. via /loop) to retrieve and execute due prompts.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      cron: z.string().describe("Cron expression (5 fields: min hour dom mon dow). Example: '*/5 * * * *' for every 5 minutes"),
      vars: z.record(z.string()).optional().describe("Template variable overrides (key→value)"),
      agent_id: z.string().optional().describe("Agent ID to associate with this schedule"),
    },
  },
  async ({ id, cron, vars, agent_id }) => {
    try {
      const cronError = validateCron(cron)
      if (cronError) return err(`Invalid cron expression: ${cronError}`)

      const prompt = getPrompt(id)
      if (!prompt) return err(`Prompt not found: ${id}`)

      const schedule = createSchedule({
        prompt_id: prompt.id,
        prompt_slug: prompt.slug,
        cron,
        vars: vars as Record<string, string> | undefined,
        agent_id,
      })

      return ok({
        schedule,
        message: `Prompt "${prompt.title}" scheduled with cron "${cron}". Next run: ${schedule.next_run_at}. Call prompts_get_due to execute due prompts.`,
      })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_list_schedules ────────────────────────────────────────────────────
server.registerTool(
  "prompts_list_schedules",
  {
    description: "List all prompt schedules, optionally filtered by prompt.",
    inputSchema: {
      prompt_id: z.string().optional().describe("Filter by prompt ID or slug"),
    },
  },
  async ({ prompt_id }) => {
    try {
      let resolvedId: string | undefined
      if (prompt_id) {
        const prompt = getPrompt(prompt_id)
        if (!prompt) return err(`Prompt not found: ${prompt_id}`)
        resolvedId = prompt.id
      }
      const schedules = listSchedules(resolvedId)
      return ok({ schedules, count: schedules.length })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_unschedule ────────────────────────────────────────────────────────
server.registerTool(
  "prompts_unschedule",
  {
    description: "Delete a prompt schedule by ID.",
    inputSchema: { id: z.string().describe("Schedule ID (e.g. SCH-ABC123)") },
  },
  async ({ id }) => {
    try {
      const schedule = getSchedule(id)
      if (!schedule) return err(`Schedule not found: ${id}`)
      deleteSchedule(id)
      return ok({ deleted: true, id })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_get_due ───────────────────────────────────────────────────────────
server.registerTool(
  "prompts_get_due",
  {
    description: "Get all prompts that are due to run now. Returns the rendered prompt text for each. Automatically advances next_run_at after retrieval. Call this on a loop (e.g. every minute) to drive scheduled prompt execution.",
    inputSchema: {},
  },
  async () => {
    try {
      const due = getDueSchedules()
      if (!due.length) return ok({ due: [], count: 0, message: "No prompts due right now." })
      return ok({
        due: due.map(d => ({
          schedule_id: d.id,
          prompt_id: d.prompt_id,
          prompt_slug: d.prompt_slug,
          cron: d.cron,
          rendered: d.rendered,
          next_run_at: d.next_run_at,
          run_count: d.run_count,
        })),
        count: due.length,
      })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_next_run ──────────────────────────────────────────────────────────
server.registerTool(
  "prompts_next_run",
  {
    description: "Preview when a cron expression will next fire, without creating a schedule.",
    inputSchema: {
      cron: z.string().describe("Cron expression (5 fields)"),
      count: z.number().optional().describe("Number of next runs to preview (default: 5)"),
    },
  },
  async ({ cron, count = 5 }) => {
    try {
      const cronError = validateCron(cron)
      if (cronError) return err(`Invalid cron expression: ${cronError}`)
      const runs: string[] = []
      let from = new Date()
      for (let i = 0; i < count; i++) {
        const next = getNextRunTime(cron, from)
        runs.push(next.toISOString())
        from = next
      }
      return ok({ cron, next_runs: runs })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── heartbeat ────────────────────────────────────────────────────────────────
server.registerTool(
  "heartbeat",
  {
    description: "Update last_seen_at to signal agent is active. Call periodically during long tasks.",
    inputSchema: {
      agent_id: z.string().describe("Agent ID or name"),
    },
  },
  async ({ agent_id }) => {
    const agent = heartbeatAgent(agent_id)
    if (!agent) return err(`Agent not found: ${agent_id}`)
    return ok({ id: agent.id, name: agent.name, last_seen_at: agent.last_seen_at })
  }
)

// ── set_focus ────────────────────────────────────────────────────────────────
server.registerTool(
  "set_focus",
  {
    description: "Set active project context for this agent session.",
    inputSchema: {
      agent_id: z.string().describe("Agent ID or name"),
      project_id: z.string().nullable().optional().describe("Project ID to focus on, or null to clear"),
    },
  },
  async ({ agent_id, project_id }) => {
    const agent = setAgentFocus(agent_id, project_id ?? null)
    if (!agent) return err(`Agent not found: ${agent_id}`)
    return ok({ id: agent.id, name: agent.name, active_project_id: project_id ?? null })
  }
)

// ── list_agents ──────────────────────────────────────────────────────────────
server.registerTool(
  "list_agents",
  {
    description: "List all registered agents.",
    inputSchema: {},
  },
  async () => ok(listAgents())
)

// ── Start ─────────────────────────────────────────────────────────────────────

server.tool(
  "send_feedback",
  "Send feedback about this service",
  { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
  async (params: { message: string; email?: string; category?: string }) => {
    try {
      const db = getDatabase();
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [params.message, params.email || null, params.category || "general", "0.3.7"]);
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  }
);

const transport = new StdioServerTransport()
await server.connect(transport)
