#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { getPrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { registerAgent } from "../db/agents.js"
import { searchPrompts, findSimilar } from "../lib/search.js"
import { renderTemplate, extractVariableInfo, validateVars } from "../lib/template.js"
import { importFromJson, exportToJson } from "../lib/importer.js"

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
    },
  },
  async (args) => {
    try {
      const { prompt, created } = await upsertPrompt(args)
      return ok({ ...prompt, _created: created })
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
    },
  },
  async (args) => ok(listPrompts(args))
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
    inputSchema: { id: z.string().describe("Prompt ID or slug") },
  },
  async ({ id }) => {
    try {
      const prompt = usePrompt(id)
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
    },
  },
  async ({ id, vars }) => {
    try {
      const prompt = usePrompt(id)
      const result = renderTemplate(prompt.body, vars)
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
    },
  },
  async ({ q, ...filter }) => ok(searchPrompts(q, filter))
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

// ── prompts_stats ─────────────────────────────────────────────────────────────
server.registerTool(
  "prompts_stats",
  {
    description: "Get usage statistics: most used prompts, recently used, counts by collection and source.",
    inputSchema: {},
  },
  async () => ok(getPromptStats())
)

// ── Start ─────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport()
await server.connect(transport)
