#!/usr/bin/env bun
import { getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, promptToSaveResult } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject } from "../db/database.js"
import { getDatabase } from "../db/database.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "../lib/search.js"
import { renderTemplate, extractVariableInfo } from "../lib/template.js"
import { importFromJson, exportToJson } from "../lib/importer.js"

const PORT = Number(process.env["PORT"] ?? process.env["PROMPTS_PORT"] ?? 19430)

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  })
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404)
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400)
}

function serverError(e: unknown): Response {
  return json({ error: e instanceof Error ? e.message : String(e) }, 500)
}

async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>
}

export default {
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      })
    }

    try {
      // ── GET /api/prompts ────────────────────────────────────────────────────
      if (path === "/api/prompts" && method === "GET") {
        const collection = url.searchParams.get("collection") ?? undefined
        const tags = url.searchParams.get("tags")?.split(",") ?? undefined
        const is_template = url.searchParams.has("templates") ? true : undefined
        const source = url.searchParams.get("source") as "manual" | "ai-session" | "imported" | undefined ?? undefined
        const limit = parseInt(url.searchParams.get("limit") ?? "20")
        const offset = parseInt(url.searchParams.get("offset") ?? "0")
        const full = url.searchParams.has("full")  // ?full=1 to get body
        const projectParam = url.searchParams.get("project") ?? undefined
        let project_id: string | undefined
        if (projectParam) {
          const pid = resolveProject(getDatabase(), projectParam)
          if (!pid) return notFound(`Project not found: ${projectParam}`)
          project_id = pid
        }
        const filter = { collection, tags, is_template, source, limit, offset, project_id }
        return json(full ? listPrompts(filter) : listPromptsSlim(filter))
      }

      // ── POST /api/prompts ───────────────────────────────────────────────────
      if (path === "/api/prompts" && method === "POST") {
        const body = await parseBody<Parameters<typeof upsertPrompt>[0]>(req)
        const { prompt, created, duplicate_warning } = upsertPrompt(body)
        return json(promptToSaveResult(prompt, created, duplicate_warning), created ? 201 : 200)
      }

      // ── GET /api/prompts/:id ────────────────────────────────────────────────
      const promptMatch = path.match(/^\/api\/prompts\/([^/]+)$/)
      if (promptMatch) {
        const id = promptMatch[1]!

        if (method === "GET") {
          const prompt = getPrompt(id)
          if (!prompt) return notFound(`Prompt not found: ${id}`)
          return json(prompt)
        }

        if (method === "PUT") {
          const body = await parseBody<Parameters<typeof updatePrompt>[1]>(req)
          const prompt = updatePrompt(id, body)
          return json(promptToSaveResult(prompt, false))
        }

        if (method === "DELETE") {
          deletePrompt(id)
          return json({ deleted: true, id })
        }
      }

      // ── POST /api/prompts/:id/use ───────────────────────────────────────────
      const useMatch = path.match(/^\/api\/prompts\/([^/]+)\/use$/)
      if (useMatch && method === "POST") {
        const prompt = usePrompt(useMatch[1]!)
        return json({ body: prompt.body, prompt })
      }

      // ── POST /api/prompts/:id/render ────────────────────────────────────────
      const renderMatch = path.match(/^\/api\/prompts\/([^/]+)\/render$/)
      if (renderMatch && method === "POST") {
        const { vars = {} } = await parseBody<{ vars?: Record<string, string> }>(req)
        const prompt = getPrompt(renderMatch[1]!)
        if (!prompt) return notFound()
        return json(renderTemplate(prompt.body, vars))
      }

      // ── POST /api/prompts/:id/move ──────────────────────────────────────────
      const moveMatch = path.match(/^\/api\/prompts\/([^/]+)\/move$/)
      if (moveMatch && method === "POST") {
        const { collection } = await parseBody<{ collection: string }>(req)
        if (!collection) return badRequest("collection is required")
        movePrompt(moveMatch[1]!, collection)
        return json({ moved: true, id: moveMatch[1], collection })
      }

      // ── GET /api/prompts/:id/history ────────────────────────────────────────
      const historyMatch = path.match(/^\/api\/prompts\/([^/]+)\/history$/)
      if (historyMatch && method === "GET") {
        const prompt = getPrompt(historyMatch[1]!)
        if (!prompt) return notFound()
        return json(listVersions(prompt.id))
      }

      // ── POST /api/prompts/:id/restore ───────────────────────────────────────
      const restoreMatch = path.match(/^\/api\/prompts\/([^/]+)\/restore$/)
      if (restoreMatch && method === "POST") {
        const { version, changed_by } = await parseBody<{ version: number; changed_by?: string }>(req)
        const prompt = getPrompt(restoreMatch[1]!)
        if (!prompt) return notFound()
        restoreVersion(prompt.id, version, changed_by)
        return json({ restored: true, id: prompt.id, version })
      }

      // ── GET /api/prompts/:id/similar ────────────────────────────────────────
      const similarMatch = path.match(/^\/api\/prompts\/([^/]+)\/similar$/)
      if (similarMatch && method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") ?? "5")
        const prompt = getPrompt(similarMatch[1]!)
        if (!prompt) return notFound()
        return json(findSimilar(prompt.id, limit))
      }

      // ── GET /api/prompts/:id/variables ──────────────────────────────────────
      const varsMatch = path.match(/^\/api\/prompts\/([^/]+)\/variables$/)
      if (varsMatch && method === "GET") {
        const prompt = getPrompt(varsMatch[1]!)
        if (!prompt) return notFound()
        return json(extractVariableInfo(prompt.body))
      }

      // ── GET /api/search ─────────────────────────────────────────────────────
      if (path === "/api/search" && method === "GET") {
        const q = url.searchParams.get("q") ?? ""
        const collection = url.searchParams.get("collection") ?? undefined
        const tags = url.searchParams.get("tags")?.split(",") ?? undefined
        const is_template = url.searchParams.has("templates") ? true : undefined
        const limit = parseInt(url.searchParams.get("limit") ?? "20")
        const full = url.searchParams.has("full")
        return json(full
          ? searchPrompts(q, { collection, tags, is_template, limit })
          : searchPromptsSlim(q, { collection, tags, is_template, limit })
        )
      }

      // ── GET /api/templates ──────────────────────────────────────────────────
      if (path === "/api/templates" && method === "GET") {
        return json(listPromptsSlim({ is_template: true, limit: 50 }))
      }

      // ── GET /api/collections ────────────────────────────────────────────────
      if (path === "/api/collections" && method === "GET") {
        return json(listCollections())
      }

      // ── POST /api/collections ───────────────────────────────────────────────
      if (path === "/api/collections" && method === "POST") {
        const { name, description } = await parseBody<{ name: string; description?: string }>(req)
        if (!name) return badRequest("name is required")
        return json(ensureCollection(name, description), 201)
      }

      // ── GET /api/stats ──────────────────────────────────────────────────────
      if (path === "/api/stats" && method === "GET") {
        return json(getPromptStats())
      }

      // ── POST /api/import ────────────────────────────────────────────────────
      if (path === "/api/import" && method === "POST") {
        const { prompts, changed_by } = await parseBody<{ prompts: Parameters<typeof importFromJson>[0]; changed_by?: string }>(req)
        return json(importFromJson(prompts, changed_by))
      }

      // ── GET /api/export ─────────────────────────────────────────────────────
      if (path === "/api/export" && method === "GET") {
        const collection = url.searchParams.get("collection") ?? undefined
        return json(exportToJson(collection))
      }

      // ── GET /api/projects ───────────────────────────────────────────────────
      if (path === "/api/projects" && method === "GET") {
        return json(listProjects())
      }

      // ── POST /api/projects ──────────────────────────────────────────────────
      if (path === "/api/projects" && method === "POST") {
        const { name, description, path: projPath } = await parseBody<{ name: string; description?: string; path?: string }>(req)
        if (!name) return badRequest("name is required")
        return json(createProject({ name, description, path: projPath }), 201)
      }

      // ── GET/DELETE /api/projects/:id ─────────────────────────────────────────
      const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/)
      if (projectMatch) {
        const projId = projectMatch[1]!

        if (method === "GET") {
          const project = getProject(projId)
          if (!project) return notFound(`Project not found: ${projId}`)
          return json(project)
        }

        if (method === "DELETE") {
          try {
            deleteProject(projId)
            return json({ deleted: true, id: projId })
          } catch (e) {
            return notFound(e instanceof Error ? e.message : String(e))
          }
        }
      }

      // ── GET /api/projects/:id/prompts ────────────────────────────────────────
      const projectPromptsMatch = path.match(/^\/api\/projects\/([^/]+)\/prompts$/)
      if (projectPromptsMatch && method === "GET") {
        const projId = projectPromptsMatch[1]!
        const project = getProject(projId)
        if (!project) return notFound(`Project not found: ${projId}`)
        const limit = parseInt(url.searchParams.get("limit") ?? "100")
        const offset = parseInt(url.searchParams.get("offset") ?? "0")
        const full = url.searchParams.has("full")
        return json(full ? listPrompts({ project_id: project.id, limit, offset }) : listPromptsSlim({ project_id: project.id, limit, offset }))
      }

      // ── GET /health ─────────────────────────────────────────────────────────
      if (path === "/health") {
        return json({ status: "ok", port: PORT })
      }

      return notFound()
    } catch (e) {
      return serverError(e)
    }
  },
}

console.log(`open-prompts API running on http://localhost:${PORT}`)
