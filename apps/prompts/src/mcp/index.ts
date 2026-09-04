#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { isStdioMode, startMcpHttpServer, resolveMcpHttpPort } from "./http.js"
import { z } from "zod"
import { getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt, setExpiry, getTrending, promptToSaveResult } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { registerAgent, listAgents, heartbeatAgent, setAgentFocus } from "../db/agents.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject } from "../db/database.js"
import { getDatabase, getPromptRegistryDiagnostics } from "../db/database.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "../lib/search.js"
import { extractVariableInfo, validateVars, definitionsFromVariables } from "../lib/template.js"
import { renderTemplateWithIntegrations } from "../lib/integrations/render.js"
import { extractIntegrationRefs, parseRefOrThrow, resolveIntegrationRef, buildSurfaceMap } from "../lib/integrations/index.js"
import { renderPromptTemplate, setParent, setPartial, listDependencies } from "../db/dependencies.js"
import { recordRenderReceipt } from "../db/receipts.js"
import { setLabel, removeLabel, listLabels } from "../db/labels.js"
import { importFromJson, exportToJson, scanAndImportSlashCommands } from "../lib/importer.js"
import { maybeSaveMemento } from "../lib/mementos.js"
import { createSchedule, listSchedules, getSchedule, deleteSchedule, getDueSchedules } from "../db/schedules.js"
import { validateCron, getNextRunTime } from "../lib/cron.js"
import { diffTexts, formatDiff } from "../lib/diff.js"
import { lintAll } from "../lib/lint.js"
import { runAudit } from "../lib/audit.js"
import { getPackageVersion } from "../lib/package-info.js"
import { pageItems, toPromptSummary, toScheduleSummary, toSearchSummary, toVersionSummary } from "../lib/compact.js"
import { homedir } from "os"
import { existsSync as fsExists, readFileSync as fsRead, writeFileSync as fsWrite, mkdirSync as fsMkdir, readdirSync as fsReaddir, statSync as fsStat } from "fs"
import { join as pathJoin, resolve as pathResolve, dirname as pathDirname } from "path"

const AGENT_CONFIGS_MCP: Record<string, { global: string; local: string; label: string }> = {
  claude:  { global: ".claude/CLAUDE.md",         local: "CLAUDE.md",                  label: "Claude Code" },
  agents:  { global: ".agents/AGENTS.md",          local: "AGENTS.md",                  label: "OpenAI Agents SDK" },
  gemini:  { global: ".gemini/GEMINI.md",           local: ".gemini/GEMINI.md",           label: "Gemini CLI" },
  codex:   { global: ".codex/CODEX.md",             local: "CODEX.md",                   label: "OpenAI Codex CLI" },
  cursor:  { global: ".cursor/rules",               local: ".cursorrules",               label: "Cursor" },
  aider:   { global: ".aider/CONVENTIONS.md",       local: ".aider.conventions.md",      label: "Aider" },
}

const PACKAGE_VERSION = getPackageVersion()

function cfgPath(agent: string, global_: boolean): string | null {
  const cfg = AGENT_CONFIGS_MCP[agent.toLowerCase()]
  if (!cfg) return null
  return global_ ? pathJoin(homedir(), cfg.global) : pathResolve(process.cwd(), cfg.local)
}

export function buildServer(): McpServer {
const server = new McpServer({ name: "prompts", version: PACKAGE_VERSION })

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
      var_schema: z.string().optional().describe("JSON string array of typed variable definitions (name, type, required, default, description, validation, render_format)"),
    },
  },
  async (args) => {
    try {
      const { force, project, var_schema, ...input } = args
      if (project) {
        const db = getDatabase()
        const pid = resolveProject(db, project)
        if (!pid) return err(`Project not found: ${project}`)
        ;(input as typeof input & { project_id?: string }).project_id = pid
      }
      if (var_schema) {
        try {
          const parsed: unknown = JSON.parse(var_schema)
          if (!Array.isArray(parsed)) return err(`var_schema must be a JSON array`)
          ;(input as typeof input & { var_schema?: unknown[] }).var_schema = parsed
        } catch (e) {
          return err(`Invalid var_schema: ${e instanceof Error ? e.message : String(e)}`)
        }
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
    description: "Get compact prompt metadata by ID, slug, or partial ID. Body is omitted by default; use include_body:true or prompts_body when you need the text.",
    inputSchema: {
      id: z.string().describe("Prompt ID (PRMT-00001), slug, or partial ID"),
      include_body: z.boolean().optional().describe("Include full body text. Prefer prompts_body when you only need the body."),
    },
  },
  async ({ id, include_body }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    if (include_body) return ok(prompt)
    return ok({
      ...toPromptSummary(prompt, { bodyPreviewChars: 160 }),
      _hint: "Use prompts_body for body only, prompts_use to consume/increment usage, or include_body:true for the full record.",
    })
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
      return ok({
        body: prompt.body,
        prompt: toPromptSummary(prompt),
        _hint: "Body is included because prompts_use is the explicit body retrieval path.",
      })
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_render ────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_render",
  {
    description: "Render a template prompt by filling in {{variables}} and resolving {{todo:...}}/{{channel:...}}/{{knowledge:...}}/{{memento:...}}/{{file:...}} integrations. Returns rendered body plus info on missing/defaulted vars and integration receipts. Pass strict:true to fail on missing required values, preview:true for visible [UNRESOLVED ...] markers, and vars_json for typed values.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      vars: z.record(z.string()).describe("Variable values as key-value pairs"),
      vars_json: z.string().optional().describe("Typed variable values as a JSON object string (merged over vars)"),
      strict: z.boolean().optional().describe("Fail with a named error when required variables are missing"),
      preview: z.boolean().optional().describe("Emit visible [UNRESOLVED kind:var name=...] markers instead of placeholders"),
      agent: z.string().optional().describe("Agent ID for mementos integration"),
      allow_unresolved_integrations: z.boolean().optional().describe("Permissive preview: emit [UNRESOLVED ...] markers instead of failing on unresolvable integrations"),
    },
  },
  async ({ id, vars, vars_json, strict, preview, agent, allow_unresolved_integrations }) => {
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

      const typedVars: Record<string, unknown> = {}
      if (vars_json) {
        try {
          const parsed: unknown = JSON.parse(vars_json)
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return err(`vars_json must be a JSON object`)
          }
          Object.assign(typedVars, parsed as Record<string, unknown>)
        } catch (e) {
          return err(`Invalid vars_json: ${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const mergedVars = { ...autoFilled, ...vars, ...typedVars }
      // Template engine first (typed vars, strict/preview, partials), then
      // integration refs resolved against the rendered output.
      const engineResult = renderPromptTemplate(prompt, mergedVars, { strict, preview })
      const result = await renderTemplateWithIntegrations(engineResult.rendered, mergedVars, {
        allowUnresolvedIntegrations: allow_unresolved_integrations,
        base: engineResult,
      })
      if (Object.keys(autoFilled).length > 0) {
        (result as unknown as Record<string, unknown>).auto_filled = autoFilled
      }
      if (result.resolved_sources && result.resolved_sources.length > 0) {
        recordRenderReceipt(prompt.id, prompt.version, {
          resolvedSources: result.resolved_sources,
          rendered: result.rendered,
          missingVars: result.missing_vars,
          usedDefaults: result.used_defaults,
        })
      }
      await maybeSaveMemento({ slug: prompt.slug, body: prompt.body, rendered: result.rendered, agentId: agent })
      return ok(result)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_resolve ───────────────────────────────────────────────────────────
server.registerTool(
  "prompts_resolve",
  {
    description: "Resolve integration references ({{todo:...}}, {{channel:...}}, {{knowledge:...}}, {{memento:...}}, {{file:...}}) in a text body against the owning apps, WITHOUT rendering. Returns resolved projections and unresolved named codes. Default fails on the first unresolved ref; pass allow_unresolved=true for a permissive preview.",
    inputSchema: {
      body: z.string().describe("Text containing integration references"),
      allow_unresolved: z.boolean().optional().describe("Permissive preview: return unresolved refs with named codes instead of failing"),
    },
  },
  async ({ body, allow_unresolved }) => {
    try {
      const surfaceMap = buildSurfaceMap({})
      const refs = extractIntegrationRefs(body)
      const resolved: Array<Record<string, unknown>> = []
      const unresolved: Array<Record<string, unknown>> = []
      for (const ref of refs) {
        try {
          const parsed = parseRefOrThrow(ref.raw, ref.kind, ref.payload)
          const result = await resolveIntegrationRef(parsed, surfaceMap)
          resolved.push({
            kind: result.kind,
            ref: result.ref,
            source_id: result.source_id,
            source_version: result.source_version,
            projection: result.projection,
            text: result.text,
          })
        } catch (e) {
          if (e instanceof Error && "code" in e) {
            const code = String((e as { code: unknown }).code)
            unresolved.push({ kind: ref.kind, ref: ref.raw, code })
          } else {
            unresolved.push({ kind: ref.kind, ref: ref.raw, code: "UNKNOWN", message: e instanceof Error ? e.message : String(e) })
          }
        }
      }
      if (unresolved.length > 0 && !allow_unresolved) {
        const first = unresolved[0]!
        return err(`Unresolved integration ${first["kind"]}:${first["ref"]} code=${first["code"]}`)
      }
      return ok({ refs: refs.length, resolved, unresolved })
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
    return ok(findSimilar(prompt.id, limit).map((r) => toSearchSummary(r)))
  }
)

// ── prompts_collections ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_collections",
  {
    description: "List all prompt collections with prompt counts.",
    inputSchema: {
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ limit = 20, offset = 0 }) => {
    const collections = listCollections()
    const page = pageItems(collections, limit, offset)
    return ok({
      collections: page.items,
      count: collections.length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
    })
  }
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
    description: "Get compact version history for a prompt. Bodies are omitted by default; pass include_body:true to retrieve version bodies.",
    inputSchema: {
      id: z.string(),
      include_body: z.boolean().optional().describe("Include full body text for every version."),
    },
  },
  async ({ id, include_body }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    const versions = listVersions(prompt.id)
    return ok({
      prompt: toPromptSummary(prompt),
      versions: versions.map((v) => toVersionSummary(v, { includeBody: include_body ?? false })),
      count: versions.length,
      _hint: include_body ? undefined : "Pass include_body:true only when you need historical body text.",
    })
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
    description: "Update an existing prompt's fields. var_schema is a JSON string array of typed variable definitions.",
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      body: z.string().optional(),
      description: z.string().optional(),
      collection: z.string().optional(),
      tags: z.array(z.string()).optional(),
      changed_by: z.string().optional(),
      var_schema: z.string().optional().describe("JSON string array of variable definitions (name, type, required, default, description, validation, render_format)"),
    },
  },
  async ({ id, var_schema, ...updates }) => {
    try {
      const input: Record<string, unknown> = { ...updates }
      if (var_schema) {
        try {
          const parsed: unknown = JSON.parse(var_schema)
          if (!Array.isArray(parsed)) return err(`var_schema must be a JSON array`)
          input["var_schema"] = parsed
        } catch (e) {
          return err(`Invalid var_schema: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      const prompt = updatePrompt(id, input as Parameters<typeof updatePrompt>[1])
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
    description: "Validate which variables are required, optional, or extra for a template. Reads persisted variable metadata (typed defaults make variables optional).",
    inputSchema: {
      id: z.string(),
      vars: z.record(z.string()).optional().describe("Variables you plan to provide"),
    },
  },
  async ({ id, vars = {} }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(validateVars(prompt.body, vars, definitionsFromVariables(prompt.variables)))
  }
)

// ── prompts_set_label ─────────────────────────────────────────────────────────
server.registerTool(
  "prompts_set_label",
  {
    description: "Set an exact label (key=value) on a prompt. Keys and values are normalized to lowercase; setting the same pair twice is a no-op.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      key: z.string(),
      value: z.string(),
    },
  },
  async ({ id, key, value }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(setLabel(prompt.id, key, value))
  }
)

// ── prompts_remove_label ──────────────────────────────────────────────────────
server.registerTool(
  "prompts_remove_label",
  {
    description: "Remove all values for a label key on a prompt.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      key: z.string(),
    },
  },
  async ({ id, key }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    removeLabel(prompt.id, key)
    return ok({ removed: true, prompt_id: prompt.id, key })
  }
)

// ── prompts_list_labels ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_list_labels",
  {
    description: "List exact labels for a prompt.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
    },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(listLabels(prompt.id))
  }
)

// ── prompts_add_dependency ────────────────────────────────────────────────────
server.registerTool(
  "prompts_add_dependency",
  {
    description: "Add a template dependency: one parent (--extends, no multiple inheritance) or a partial. The dependency version is pinned at set time.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      dependency: z.string().describe("Dependency prompt ID or slug"),
      relation: z.enum(["parent", "partial"]).describe("'parent' composes this prompt's body after the parent; 'partial' makes the body available to {{>slug}} references"),
      slot: z.string().optional().describe("Optional slot name for partials"),
    },
  },
  async ({ id, dependency, relation, slot }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    try {
      const dep = relation === "parent"
        ? setParent(prompt.id, dependency)
        : setPartial(prompt.id, dependency, slot)
      return ok(dep)
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e))
    }
  }
)

// ── prompts_list_dependencies ─────────────────────────────────────────────────
server.registerTool(
  "prompts_list_dependencies",
  {
    description: "List a prompt's template dependencies (parent and partials) with pinned versions.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
    },
  },
  async ({ id }) => {
    const prompt = getPrompt(id)
    if (!prompt) return err(`Prompt not found: ${id}`)
    return ok(listDependencies(prompt.id))
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
    inputSchema: {
      collection: z.string().optional(),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ collection, limit, offset = 0 }) => {
    const all = listPromptsSlim({ collection, limit: 10000 })
    const unused = all.filter((p) => p.use_count === 0)
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title, collection: p.collection, created_at: p.created_at }))
    const page = pageItems(unused, limit, offset)
    return ok({
      unused: page.items,
      count: unused.length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
    })
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
    try { return ok(toPromptSummary(setExpiry(id, expires_at))) }
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
      return ok(promptToSaveResult(prompt, true))
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
        return ok(toPromptSummary(p))
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
    try { return ok(toPromptSummary(pinPrompt(id, true))) }
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
    try { return ok(toPromptSummary(pinPrompt(id, false))) }
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
    description: "Check prompt quality: missing descriptions, undocumented template vars, short bodies, no tags. Returns compact prompt metadata by default.",
    inputSchema: {
      collection: z.string().optional(),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ collection, limit = 20, offset = 0 }) => {
    const prompts = listPrompts({ collection, limit: 10000 })
    const results = lintAll(prompts)
    const page = pageItems(results, limit, offset)
    const summary = {
      total_checked: prompts.length,
      prompts_with_issues: results.length,
      errors: results.flatMap((r) => r.issues).filter((i) => i.severity === "error").length,
      warnings: results.flatMap((r) => r.issues).filter((i) => i.severity === "warn").length,
      info: results.flatMap((r) => r.issues).filter((i) => i.severity === "info").length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
      results: page.items.map((r) => ({ prompt: toPromptSummary(r.prompt), issues: r.issues })),
      _hint: page.has_more ? `Call again with offset:${page.next_offset} for more lint results.` : undefined,
    }
    return ok(summary)
  }
)

// ── prompts_stale ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_stale",
  {
    description: "List prompts not used in N days. Useful for library hygiene.",
    inputSchema: {
      days: z.number().optional().default(30).describe("Inactivity threshold in days"),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ days, limit = 20, offset = 0 }) => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    const all = listPromptsSlim({ limit: 10000 })
    const stale = all
      .filter((p) => p.last_used_at === null || p.last_used_at < cutoff)
      .sort((a, b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? ""))
      .map((p) => ({ id: p.id, slug: p.slug, title: p.title, last_used_at: p.last_used_at, use_count: p.use_count }))
    const page = pageItems(stale, limit, offset)
    return ok({
      stale: page.items,
      count: stale.length,
      threshold_days: days,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
    })
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

// ── prompts_storage_diagnostics ──────────────────────────────────────────────
server.registerTool(
  "prompts_storage_diagnostics",
  {
    description: "Report prompt registry diagnostics: local SQLite path, remote Postgres/S3/AWS configuration presence, and local fallback behavior without exposing configured values.",
    inputSchema: {},
  },
  async () => ok(getPromptRegistryDiagnostics())
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
    inputSchema: {
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ limit = 20, offset = 0 }) => {
    const projects = listProjects()
    const page = pageItems(projects, limit, offset)
    return ok({
      projects: page.items,
      count: projects.length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
    })
  }
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
        schedule: toScheduleSummary(schedule),
        message: `Prompt "${prompt.title}" scheduled with cron "${cron}". Next run: ${schedule.next_run_at}. Call prompts_get_due to execute due prompts.`,
        _hint: "Schedule variables are summarized. Use prompts_list_schedules include_vars:true to inspect them.",
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
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
      include_vars: z.boolean().optional().describe("Include full schedule variable payloads."),
    },
  },
  async ({ prompt_id, limit = 20, offset = 0, include_vars }) => {
    try {
      let resolvedId: string | undefined
      if (prompt_id) {
        const prompt = getPrompt(prompt_id)
        if (!prompt) return err(`Prompt not found: ${prompt_id}`)
        resolvedId = prompt.id
      }
      const schedules = listSchedules(resolvedId)
      const page = pageItems(schedules, limit, offset)
      return ok({
        schedules: page.items.map((s) => toScheduleSummary(s, { includeVars: include_vars ?? false })),
        count: schedules.length,
        limit: page.limit,
        offset: page.offset,
        has_more: page.has_more,
        next_offset: page.next_offset,
        _hint: include_vars ? undefined : "Pass include_vars:true only when you need schedule variable payloads.",
      })
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
    inputSchema: {
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ limit = 20, offset = 0 }) => {
    const agents = listAgents()
    const page = pageItems(agents, limit, offset)
    return ok({
      agents: page.items,
      count: agents.length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
    })
  }
)

// ── prompts_bulk_tag ──────────────────────────────────────────────────────────
server.registerTool(
  "prompts_bulk_tag",
  {
    description: "Add and/or remove tags on multiple prompts in one call.",
    inputSchema: {
      ids: z.array(z.string()).describe("Prompt IDs or slugs"),
      add: z.array(z.string()).optional().describe("Tags to add"),
      remove: z.array(z.string()).optional().describe("Tags to remove"),
    },
  },
  async ({ ids, add = [], remove = [] }) => {
    const results: Array<{ id: string; slug: string; tags: string[] }> = []
    for (const idOrSlug of ids) {
      try {
        const prompt = getPrompt(idOrSlug)
        if (!prompt) continue
        let tags = [...prompt.tags]
        for (const t of add) { if (!tags.includes(t)) tags.push(t) }
        for (const t of remove) { tags = tags.filter((x) => x !== t) }
        updatePrompt(prompt.id, { tags })
        results.push({ id: prompt.id, slug: prompt.slug, tags })
      } catch { /* skip failed */ }
    }
    return ok({ updated: results.length, results })
  }
)

// ── prompts_bulk_move ─────────────────────────────────────────────────────────
server.registerTool(
  "prompts_bulk_move",
  {
    description: "Move multiple prompts to a different collection.",
    inputSchema: {
      ids: z.array(z.string()).describe("Prompt IDs or slugs"),
      collection: z.string().describe("Target collection name"),
    },
  },
  async ({ ids, collection }) => {
    const results: Array<{ id: string; slug: string; ok: boolean; error?: string }> = []
    for (const idOrSlug of ids) {
      try {
        movePrompt(idOrSlug, collection)
        const p = getPrompt(idOrSlug)
        results.push({ id: p?.id ?? idOrSlug, slug: p?.slug ?? idOrSlug, ok: true })
      } catch (e) {
        results.push({ id: idOrSlug, slug: idOrSlug, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }
    return ok({ moved: results.filter((r) => r.ok).length, results })
  }
)

// ── prompts_config_list ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_config_list",
  {
    description: "List all known AI agent config files (CLAUDE.md, AGENTS.md, GEMINI.md, etc.) showing which exist globally and in the current project directory.",
    inputSchema: {},
  },
  async () => {
    const rows = []
    for (const [key, cfg] of Object.entries(AGENT_CONFIGS_MCP)) {
      const globalPath = pathJoin(homedir(), cfg.global)
      const localPath = pathResolve(process.cwd(), cfg.local)
      rows.push({
        agent: key, label: cfg.label,
        global: { path: globalPath, exists: fsExists(globalPath), size: fsExists(globalPath) ? fsStat(globalPath).size : null },
        local: globalPath === localPath ? null : { path: localPath, exists: fsExists(localPath), size: fsExists(localPath) ? fsStat(localPath).size : null },
      })
    }
    return ok(rows)
  }
)

// ── prompts_config_get ────────────────────────────────────────────────────────
server.registerTool(
  "prompts_config_get",
  {
    description: "Read the contents of an AI agent config file (CLAUDE.md, AGENTS.md, etc.).",
    inputSchema: {
      agent: z.enum(["claude", "agents", "gemini", "codex", "cursor", "aider"]).describe("Which agent's config to read"),
      global: z.boolean().optional().default(false).describe("Read global (~/) config instead of project-local"),
    },
  },
  async ({ agent, global: g }) => {
    const path = cfgPath(agent, g ?? false)
    if (!path) return err(`Unknown agent: ${agent}`)
    if (!fsExists(path)) return err(`Config file not found: ${path}`)
    return ok({ agent, path, content: fsRead(path, "utf-8") })
  }
)

// ── prompts_config_set ────────────────────────────────────────────────────────
server.registerTool(
  "prompts_config_set",
  {
    description: "Write content to an AI agent config file. Creates parent directories if needed.",
    inputSchema: {
      agent: z.enum(["claude", "agents", "gemini", "codex", "cursor", "aider"]).describe("Which agent's config to write"),
      content: z.string().describe("Full content to write"),
      global: z.boolean().optional().default(false).describe("Write to global (~/) config instead of project-local"),
    },
  },
  async ({ agent, content, global: g }) => {
    const path = cfgPath(agent, g ?? false)
    if (!path) return err(`Unknown agent: ${agent}`)
    fsMkdir(pathDirname(path), { recursive: true })
    fsWrite(path, content)
    return ok({ written: true, agent, path, bytes: content.length })
  }
)

// ── prompts_config_inject ─────────────────────────────────────────────────────
server.registerTool(
  "prompts_config_inject",
  {
    description: "Append a saved prompt's body into an AI agent config file. Optionally inject under a specific markdown section heading.",
    inputSchema: {
      slug: z.string().describe("Prompt ID or slug to inject"),
      agent: z.enum(["claude", "agents", "gemini", "codex", "cursor", "aider"]).describe("Target agent config file"),
      global: z.boolean().optional().default(false).describe("Inject into global config instead of project-local"),
      section: z.string().optional().describe("Markdown heading to inject under (## Heading). Creates section if missing."),
      replace: z.boolean().optional().describe("Replace section content instead of appending (requires section)"),
    },
  },
  async ({ slug, agent, global: g, section, replace }) => {
    const prompt = getPrompt(slug)
    if (!prompt) return err(`Prompt not found: ${slug}`)
    const path = cfgPath(agent, g ?? false)
    if (!path) return err(`Unknown agent: ${agent}`)
    fsMkdir(pathDirname(path), { recursive: true })

    let existing = fsExists(path) ? fsRead(path, "utf-8") : ""
    const injection = `\n${prompt.body}\n`

    if (section) {
      const heading = `## ${section}`
      const idx = existing.indexOf(heading)
      if (idx === -1) {
        existing = existing.trimEnd() + `\n\n${heading}\n${injection}`
      } else if (replace) {
        const afterHeading = idx + heading.length
        const nextSection = existing.indexOf("\n## ", afterHeading)
        const sectionEnd = nextSection === -1 ? existing.length : nextSection
        existing = existing.slice(0, afterHeading) + `\n${injection}` + existing.slice(sectionEnd)
      } else {
        const afterHeading = idx + heading.length
        const nextSection = existing.indexOf("\n## ", afterHeading)
        const insertAt = nextSection === -1 ? existing.length : nextSection
        existing = existing.slice(0, insertAt).trimEnd() + `\n${injection}\n` + existing.slice(insertAt)
      }
    } else {
      existing = existing.trimEnd() + `\n${injection}`
    }

    fsWrite(path, existing)
    return ok({ injected: true, slug: prompt.slug, path, section: section ?? null })
  }
)

// ── prompts_config_scan ───────────────────────────────────────────────────────
server.registerTool(
  "prompts_config_scan",
  {
    description: "Scan a workspace directory for git repos and report which AI agent config files are present or missing in each.",
    inputSchema: {
      workspace: z.string().optional().describe("Workspace directory to scan (default: ~/workspace)"),
      agents: z.array(z.string()).optional().describe("Agent names to check (default: all)"),
      depth: z.number().optional().default(3).describe("Max directory depth to scan for git repos"),
      missing_only: z.boolean().optional().describe("Only return repos with missing configs"),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    },
  },
  async ({ workspace, agents, depth = 3, missing_only, limit = 20, offset = 0 }) => {
    const wsDir = workspace ? pathResolve(workspace) : pathResolve(homedir(), "workspace")
    if (!fsExists(wsDir)) return err(`Workspace not found: ${wsDir}`)

    const agentFilter = agents?.map((a) => a.toLowerCase()) ?? Object.keys(AGENT_CONFIGS_MCP)
    const repos: string[] = []

    function scanDir(dir: string, d: number) {
      if (d > depth) return
      try {
        const entries = fsReaddir(dir, { withFileTypes: true })
        if (entries.some((e) => e.name === ".git" && e.isDirectory())) { repos.push(dir); return }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            scanDir(pathJoin(dir, entry.name), d + 1)
          }
        }
      } catch { /* skip */ }
    }
    scanDir(wsDir, 0)

    const reports = []
    for (const repo of repos) {
      const configs: Record<string, { present: boolean; path: string; size: number | null }> = {}
      let missingCount = 0
      let presentCount = 0
      for (const key of agentFilter) {
        const cfg = AGENT_CONFIGS_MCP[key]
        if (!cfg) continue
        const p = pathJoin(repo, cfg.local)
        const exists = fsExists(p)
        configs[key] = { present: exists, path: p, size: exists ? fsStat(p).size : null }
        if (exists) presentCount++; else missingCount++
      }
      if (!missing_only || missingCount > 0) {
        reports.push({ repo, configs, missing_count: missingCount, present_count: presentCount })
      }
    }

    const page = pageItems(reports, limit, offset)
    return ok({
      workspace: wsDir,
      repos_scanned: repos.length,
      reports: page.items,
      total_reports: reports.length,
      limit: page.limit,
      offset: page.offset,
      has_more: page.has_more,
      next_offset: page.next_offset,
      _hint: page.has_more ? `Call again with offset:${page.next_offset} for more repo reports.` : undefined,
    })
  }
)

// ── dispatch tools ────────────────────────────────────────────────────────────

async function dispatchToolError(e: unknown) {
  return err(e instanceof Error ? e.message : String(e))
}

server.registerTool(
  "prompts_targets",
  {
    description:
      "Read-only discovery of codewith dispatch targets: safe profile names, provider, plan, and availability. Never returns credentials or raw auth payloads. A target is usable only when the provider reports it healthy now.",
    inputSchema: {},
  },
  async () => {
    try {
      const { discoverTargets, resolveBin } = await import("../lib/dispatch/codewith.js")
      const bin = resolveBin("codewith", process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_BIN"], "CODEMITH")
      const result = await discoverTargets(bin)
      return ok(result)
    } catch (e) {
      return dispatchToolError(e)
    }
  }
)

server.registerTool(
  "prompts_dispatch",
  {
    description:
      "Render a stored prompt strictly and dispatch it. Omitted runtime defaults to emit (rendered prompt only, no process). Codewith runs are read-only, reserve the provider account, and record a run receipt.",
    inputSchema: {
      id: z.string().describe("Prompt ID or slug"),
      runtime: z.enum(["emit", "codewith"]).optional().describe("Dispatch runtime (default: emit)"),
      target: z.string().optional().describe("Codewith target profile name"),
      vars: z.record(z.string(), z.string()).optional().describe("Template variables"),
      vars_json: z.string().optional().describe("JSON object of template variables"),
      cwd: z.string().optional().describe("Working directory for the dispatched runtime"),
      wait: z.boolean().optional().describe("Wait for a codewith run to finish"),
      model: z.string().optional().describe("Codewith model (spark identifiers are rejected)"),
    },
  },
  async (args: {
    id: string
    runtime?: "emit" | "codewith"
    target?: string
    vars?: Record<string, string>
    vars_json?: string
    cwd?: string
    wait?: boolean
    model?: string
  }) => {
    try {
      const { dispatchPrompt, mergeVars } = await import("../lib/dispatch/index.js")
      const receipt = await dispatchPrompt(args.id, {
        runtime: args.runtime ?? "emit",
        target: args.target,
        vars: mergeVars(Object.entries(args.vars ?? {}), args.vars_json),
        cwd: args.cwd,
        wait: args.wait,
        model: args.model,
      })
      return ok(receipt)
    } catch (e) {
      return dispatchToolError(e)
    }
  }
)

server.registerTool(
  "prompts_dispatch_get",
  {
    description:
      "Get a dispatch run receipt: status, target, prompt id/version, render hash, output pointers, exit/error codes, timestamps. Metadata only by default; include_output:true returns the bounded, redacted captures.",
    inputSchema: {
      run_id: z.string().describe("Dispatch run ID"),
      include_output: z.boolean().optional().describe("Include bounded, redacted output captures"),
    },
  },
  async (args: { run_id: string; include_output?: boolean }) => {
    try {
      const { getDispatchRun } = await import("../lib/dispatch/index.js")
      const run = getDispatchRun(args.run_id)
      if (!run) return err(`Dispatch run not found: ${args.run_id}`)
      if (!args.include_output) return ok({ run })
      const { capturePaths } = await import("../lib/dispatch/capture-helper.js")
      const { defaultRunsDir } = await import("../lib/dispatch/index.js")
      const { existsSync, readFileSync } = await import("fs")
      const paths = capturePaths(defaultRunsDir(), args.run_id)
      const read = (path: string): string | null => {
        try {
          return existsSync(path) ? readFileSync(path, "utf8") : null
        } catch {
          return null
        }
      }
      return ok({ run, output: { out: read(paths.out), err: read(paths.err), last: read(paths.last) } })
    } catch (e) {
      return dispatchToolError(e)
    }
  }
)

// ── Start ─────────────────────────────────────────────────────────────────────

server.tool(
  "send_feedback",
  "Send feedback about this service",
  { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
  async (params: { message: string; email?: string; category?: string }) => {
    try {
      const db = getDatabase();
      db.run("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)", [params.message, params.email || null, params.category || "general", PACKAGE_VERSION]);
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  }
);

return server;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-V")) {
    console.log(PACKAGE_VERSION);
    return;
  }
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: prompts-mcp [--stdio|--http] [--port <port>]\n\nOptions:\n  --stdio       Run MCP over stdio\n  --http        Run MCP over Streamable HTTP\n  --port <port> HTTP port (default: 8872)\n  -V, --version Print package version\n  -h, --help    Show help`);
    return;
  }
  if (isStdioMode(args)) {
    const transport = new StdioServerTransport();
    await buildServer().connect(transport);
    return;
  }
  // Default: shared Streamable HTTP server (one process per MCP, many agents).
  startMcpHttpServer({ name: "prompts", port: resolveMcpHttpPort(args), buildServer });
}

if (import.meta.main) {
  await main();
}
