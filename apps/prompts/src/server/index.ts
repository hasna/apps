#!/usr/bin/env bun
/**
 * @hasna/prompts — prompts-serve.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Route map:
 *   GET  /health          liveness — { status, version, backend }   (public)
 *   GET  /ready           readiness — pings the metadata DB          (public)
 *   GET  /version         { status, version, backend }               (public)
 *   GET  /openapi.json    OpenAPI 3 document (source for the SDK)    (public)
 *   GET  /v1/prompts      list (tenant-scoped)                       (auth: prompts:read)
 *   POST /v1/prompts      create                                     (auth: prompts:write)
 *   GET/PUT/DELETE /v1/prompts/{id}                                  (auth: prompts:read|write)
 *   POST /v1/prompts/{id}/render                                     (auth: prompts:read)
 *   POST /v1/prompts/{id}/use                                        (auth: prompts:read)
 *   GET  /v1/search                                                  (auth: prompts:read)
 *   GET  /v1/collections                                             (auth: prompts:read)
 *   GET  /v1/storage/status                                          (auth: prompts:read)
 *   /api/*  legacy unversioned surface, LOCAL-ONLY (no auth, explicit
 *           localhost CORS only; never exposed as hosted infrastructure)
 *   /mcp    MCP Streamable HTTP
 *
 * The server NEVER executes local binaries from HTTP requests. No route
 * shells out; body objects are read and rendered in-process.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { verifyApiKey, ApiKeyStore, type ApiKeyVerifier, type ApiKeyPrincipal, type AuthQueryClient } from "@hasna/contracts/auth"
import { getPrompt, listPrompts, listPromptsSlim, deletePrompt, usePrompt, getPromptStats } from "../db/prompts.js"
import { listVersions } from "../db/versions.js"
import { listCollections, ensureCollection, movePrompt } from "../db/collections.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject, getDatabase, closeDatabase } from "../db/database.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "../lib/search.js"
import { renderTemplate, extractVariableInfo } from "../lib/template.js"
import { importFromJson, exportToJson } from "../lib/importer.js"
import { getPackageVersion } from "../lib/package-info.js"
import { buildServer } from "../mcp/index.js"
import { handleMcpRequest } from "../mcp/http.js"
import { SqliteV1Store, PostgresV1Store, type V1Store, type V1PromptRow, type V1CreateInput } from "./v1-store.js"
import { createServerPoolFromEnv } from "../generated/storage-kit/pool.js"
import type { PoolQueryClient } from "../generated/storage-kit/query.js"
import { resolveServerBackend } from "../db/database.js"
import { getResolvedBodyStore, writePromptBodyObject, registerBodyObject } from "../storage/bodies.js"

function parsePortArg(args: string[]): number | undefined {
  const portIndex = args.indexOf("--port")
  if (portIndex < 0) return undefined
  const raw = args[portIndex + 1]
  const port = Number(raw)
  if (!raw || !Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("Invalid --port value")
    process.exit(1)
  }
  return port
}

const ARGS = process.argv.slice(2)
const PACKAGE_VERSION = getPackageVersion()

if (import.meta.main) {
  if (ARGS.includes("--version") || ARGS.includes("-V")) {
    console.log(PACKAGE_VERSION)
    process.exit(0)
  }
  if (ARGS.includes("--help") || ARGS.includes("-h")) {
    console.log(`Usage: prompts-serve [--port <port>]\n\nOptions:\n  --port <port> Set HTTP port with PROMPTS_PORT or PORT\n  -V, --version Print package version\n  -h, --help    Show help`)
    process.exit(0)
  }
}

const PORT = parsePortArg(ARGS) ?? Number(process.env["PORT"] ?? process.env["PROMPTS_PORT"] ?? 19430)

/** Resolve the serve backend: HASNA_PROMPTS_DATABASE_URL -> postgresql, else sqlite. */
const BACKEND = resolveServerBackend(process.env)

/**
 * CORS is never a wildcard. The /v1 surface is API-key-authenticated and
 * carries no CORS headers; the legacy /api surface is explicitly local-only
 * and reflects only localhost origins.
 */
function isLocalhostOrigin(origin: string | null): boolean {
  if (!origin) return false
  try {
    const url = new URL(origin)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  } catch {
    return false
  }
}

function json(data: unknown, status = 200, corsOrigin?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (corsOrigin) headers["Access-Control-Allow-Origin"] = corsOrigin
  return new Response(JSON.stringify(data, null, 2), { status, headers })
}

function notFound(msg = "Not found"): Response {
  return json({ error: msg }, 404)
}

function badRequest(msg: string): Response {
  return json({ error: msg }, 400)
}

function unauthorized(msg: string, reason?: string): Response {
  return json({ error: msg, reason }, 401)
}

function forbidden(msg: string, reason?: string): Response {
  return json({ error: msg, reason }, 403)
}

function serverError(e: unknown): Response {
  return json({ error: e instanceof Error ? e.message : String(e) }, 500)
}

async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// API-key auth
// ---------------------------------------------------------------------------

const PROMPTS_SERVE_APP = "prompts"

function resolveSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret =
    env.HASNA_PROMPTS_API_SIGNING_KEY ??
    env.API_KEY_SIGNING_SECRET ??
    env.HASNA_API_SIGNING_KEY
  if (!secret) {
    throw new Error(
      "prompts-serve requires an API signing secret: set HASNA_PROMPTS_API_SIGNING_KEY " +
        "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).",
    )
  }
  return secret
}

/**
 * Adapter that lets the contracts ApiKeyStore talk to bun:sqlite: `$n`
 * placeholders become `?`, and the PG-only `::jsonb` cast is stripped (the
 * SQLite api_keys.scopes column is TEXT).
 */
export class SqliteAuthClient {
  constructor(private readonly db: ReturnType<typeof getDatabase>) {}

  private sql(sql: string): string {
    return sql.replace(/\$\d+/g, "?").replace(/::jsonb/g, "")
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<void> {
    this.db.run(this.sql(sql), ...params as never[])
  }

  async get<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    return (this.db.query(this.sql(sql)).get(...params as never[]) as T | null) ?? null
  }

  async many<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    return this.db.query(this.sql(sql)).all(...params as never[]) as T[]
  }
}

export interface ServeDeps {
  port?: number
  hostname?: string
  env?: NodeJS.ProcessEnv
  /** Explicit SQLite database for the sqlite backend (tests). */
  db?: ReturnType<typeof getDatabase>
}

export async function startPromptsServe(options: ServeDeps = {}): Promise<{ port: number; hostname: string; stop: () => Promise<void> }> {
  const env = options.env ?? process.env
  const port = options.port ?? PORT
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0"

  const version = PACKAGE_VERSION

  let store: V1Store
  let pool: PoolQueryClient | null = null
  let authClient: AuthQueryClient

  if (BACKEND === "postgresql") {
    const resolved = await createServerPoolFromEnv("prompts", { env })
    pool = resolved.client
    store = new PostgresV1Store(pool)
    authClient = pool
  } else {
    const db = options.db ?? getDatabase(env)
    store = new SqliteV1Store(db)
    authClient = new SqliteAuthClient(db)
  }

  const keyStore = new ApiKeyStore(authClient)
  const verifier: ApiKeyVerifier = verifyApiKey({
    app: PROMPTS_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    keyStatus: keyStore.keyStatus,
    audit: (e) => {
      if (e.outcome === "deny") {
        // Never log tokens/keys — kid + reason only.
        console.warn(`[prompts-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`)
      }
    },
  })

  const openApiDoc = JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "openapi.json"), "utf8"))

  const authOrThrow = async (req: Request, scopes: string[]): Promise<ApiKeyPrincipal> => {
    const decision = await verifier.authenticate(req.headers, { method: req.method, path: new URL(req.url).pathname, requiredScopes: scopes })
    if (!decision.ok) {
      if (decision.status === 401) throw new HttpError(401, decision.message, decision.reason)
      throw new HttpError(403, decision.message, decision.reason)
    }
    return decision.principal
  }

  class HttpError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly reason?: string,
    ) {
      super(message)
    }
  }

  const corsOrigin = (req: Request): string | undefined => {
    const origin = req.headers.get("origin")
    return origin && isLocalhostOrigin(origin) ? origin : undefined
  }

  const promptToJson = (row: V1PromptRow) => row

  const v1Handler = async (req: Request, url: URL, path: string, method: string): Promise<Response | null> => {
    // ── GET /v1/storage/status ─────────────────────────────────────────────
    if (path === "/v1/storage/status" && method === "GET") {
      await authOrThrow(req, ["prompts:read"])
      const status = await store.status()
      const bodies = getResolvedBodyStore(env)
      return json({ ...status, body_store: { type: bodies.store.type, root: bodies.root, source: bodies.source } })
    }

    // ── GET/POST /v1/prompts ───────────────────────────────────────────────
    if (path === "/v1/prompts" && method === "GET") {
      const principal = await authOrThrow(req, ["prompts:read"])
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20") || 20, 1), 200)
      const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0") || 0, 0)
      const tags = url.searchParams.get("tags")?.split(",").filter(Boolean) ?? undefined
      const { items, total } = await store.list(
        { collection: url.searchParams.get("collection") ?? undefined, tags, is_template: url.searchParams.has("templates") ? true : undefined, limit, offset },
        principal.tid,
      )
      return json({ items: items.map(promptToJson), total })
    }

    if (path === "/v1/prompts" && method === "POST") {
      const principal = await authOrThrow(req, ["prompts:write"])
      const body = await parseBody<V1CreateInput>(req)
      if (!body.title || !body.body) return badRequest("title and body are required")
      // Object-first: mint the prompt id first, write the immutable body
      // object, then the DB write.
      const id = body.id ?? generatePromptIdV1()
      const bodyRecord = await writePromptBodyObjectV1(id, 1, body.body)
      const created = await store.create(
        { ...body, id, body_uri: bodyRecord.uri, body_sha256: bodyRecord.sha256, body_bytes: bodyRecord.bytes },
        principal.tid,
      )
      registerBodyObject(bodyRecord.uri, bodyRecord.sha256, bodyRecord.bytes, "text/markdown")
      return json(promptToJson(created), 201)
    }

    // ── /v1/prompts/:id ────────────────────────────────────────────────────
    const promptMatch = path.match(/^\/v1\/prompts\/([^/]+)$/)
    if (promptMatch) {
      const id = decodeURIComponent(promptMatch[1]!)

      if (method === "GET") {
        const principal = await authOrThrow(req, ["prompts:read"])
        const prompt = await store.get(id, principal.tid)
        if (!prompt) return notFound(`Prompt not found: ${id}`)
        return json(promptToJson(prompt))
      }

      if (method === "PUT") {
        const principal = await authOrThrow(req, ["prompts:write"])
        const patch = await parseBody<Partial<V1CreateInput>>(req)
        let withBody: Partial<V1CreateInput> = patch
        if (patch.body !== undefined) {
          const existing = await store.get(id, principal.tid)
          if (!existing) return notFound(`Prompt not found: ${id}`)
          const bodyRecord = await writePromptBodyObjectV1(existing.id, existing.version + 1, patch.body)
          withBody = { ...patch, body_uri: bodyRecord.uri, body_sha256: bodyRecord.sha256, body_bytes: bodyRecord.bytes }
          registerBodyObject(bodyRecord.uri, bodyRecord.sha256, bodyRecord.bytes, "text/markdown")
        }
        const updated = await store.update(id, withBody, principal.tid)
        if (!updated) return notFound(`Prompt not found: ${id}`)
        return json(promptToJson(updated))
      }

      if (method === "DELETE") {
        const principal = await authOrThrow(req, ["prompts:write"])
        const removed = await store.remove(id, principal.tid)
        if (!removed) return notFound(`Prompt not found: ${id}`)
        return json({ deleted: true, id })
      }
    }

    // ── POST /v1/prompts/:id/render ────────────────────────────────────────
    const renderMatch = path.match(/^\/v1\/prompts\/([^/]+)\/render$/)
    if (renderMatch && method === "POST") {
      const principal = await authOrThrow(req, ["prompts:read"])
      const prompt = await store.get(decodeURIComponent(renderMatch[1]!), principal.tid)
      if (!prompt) return notFound()
      const { vars = {} } = await parseBody<{ vars?: Record<string, string> }>(req)
      const result = renderTemplate(prompt.body, vars)
      return json({ id: prompt.id, body: result.rendered, missing_vars: result.missing_vars, used_defaults: result.used_defaults, vars })
    }

    // ── POST /v1/prompts/:id/use ───────────────────────────────────────────
    const useMatch = path.match(/^\/v1\/prompts\/([^/]+)\/use$/)
    if (useMatch && method === "POST") {
      const principal = await authOrThrow(req, ["prompts:read"])
      const prompt = await store.get(decodeURIComponent(useMatch[1]!), principal.tid)
      if (!prompt) return notFound()
      const updated = await store.use(prompt.id, principal.tid)
      return json({ body: prompt.body, prompt: updated })
    }

    // ── GET /v1/search ─────────────────────────────────────────────────────
    if (path === "/v1/search" && method === "GET") {
      const principal = await authOrThrow(req, ["prompts:read"])
      const q = url.searchParams.get("q") ?? ""
      if (!q) return badRequest("q is required")
      const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "20") || 20, 1), 200)
      const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0") || 0, 0)
      const { items, total } = await store.search(q, { limit, offset }, principal.tid)
      return json({ items, total })
    }

    // ── GET /v1/collections ────────────────────────────────────────────────
    if (path === "/v1/collections" && method === "GET") {
      const principal = await authOrThrow(req, ["prompts:read"])
      return json({ collections: await store.collections(principal.tid) })
    }

    return null
  }

  const legacyApiHandler = async (req: Request, url: URL, path: string, method: string): Promise<Response> => {
    const origin = corsOrigin(req)

    if (path === "/api/prompts" && method === "GET") {
      const collection = url.searchParams.get("collection") ?? undefined
      const tags = url.searchParams.get("tags")?.split(",") ?? undefined
      const is_template = url.searchParams.has("templates") ? true : undefined
      const source = url.searchParams.get("source") as "manual" | "ai-session" | "imported" | undefined ?? undefined
      const limit = parseInt(url.searchParams.get("limit") ?? "20")
      const offset = parseInt(url.searchParams.get("offset") ?? "0")
      const full = url.searchParams.has("full")
      const projectParam = url.searchParams.get("project") ?? undefined
      let project_id: string | undefined
      if (projectParam) {
        const pid = resolveProject(getDatabase(), projectParam)
        if (!pid) return notFound(`Project not found: ${projectParam}`)
        project_id = pid
      }
      const filter = { collection, tags, is_template, source, limit, offset, project_id }
      return json(full ? listPrompts(filter) : listPromptsSlim(filter), 200, origin)
    }

    if (path === "/api/prompts" && method === "POST") {
      const body = await parseBody<V1CreateInput>(req)
      const { createPrompt } = await import("../db/prompts.js")
      const prompt = await createPrompt({ ...body, description: body.description ?? undefined, source: (body.source as "manual" | "ai-session" | "imported" | undefined) })
      return json({ prompt }, 201, origin)
    }

    const promptMatch = path.match(/^\/api\/prompts\/([^/]+)$/)
    if (promptMatch) {
      const id = promptMatch[1]!

      if (method === "GET") {
        const prompt = getPrompt(id)
        if (!prompt) return notFound(`Prompt not found: ${id}`)
        return json(prompt, 200, origin)
      }

      if (method === "PUT") {
        const body = await parseBody<Partial<V1CreateInput>>(req)
        const { updatePrompt } = await import("../db/prompts.js")
        const prompt = await updatePrompt(id, { ...body, description: body.description ?? undefined })
        return json(prompt, 200, origin)
      }

      if (method === "DELETE") {
        deletePrompt(id)
        return json({ deleted: true, id }, 200, origin)
      }
    }

    const useMatch = path.match(/^\/api\/prompts\/([^/]+)\/use$/)
    if (useMatch && method === "POST") {
      const prompt = usePrompt(useMatch[1]!)
      return json({ body: prompt.body, prompt }, 200, origin)
    }

    const renderMatch = path.match(/^\/api\/prompts\/([^/]+)\/render$/)
    if (renderMatch && method === "POST") {
      const { vars = {} } = await parseBody<{ vars?: Record<string, string> }>(req)
      const prompt = getPrompt(renderMatch[1]!)
      if (!prompt) return notFound()
      const result = renderTemplate(prompt.body, vars)
      return json(result, 200, origin)
    }

    const moveMatch = path.match(/^\/api\/prompts\/([^/]+)\/move$/)
    if (moveMatch && method === "POST") {
      const { collection } = await parseBody<{ collection: string }>(req)
      if (!collection) return badRequest("collection is required")
      movePrompt(moveMatch[1]!, collection)
      return json({ moved: true, id: moveMatch[1], collection }, 200, origin)
    }

    const historyMatch = path.match(/^\/api\/prompts\/([^/]+)\/history$/)
    if (historyMatch && method === "GET") {
      const prompt = getPrompt(historyMatch[1]!)
      if (!prompt) return notFound()
      return json(listVersions(prompt.id), 200, origin)
    }

    const restoreMatch = path.match(/^\/api\/prompts\/([^/]+)\/restore$/)
    if (restoreMatch && method === "POST") {
      const { version, changed_by } = await parseBody<{ version: number; changed_by?: string }>(req)
      const prompt = getPrompt(restoreMatch[1]!)
      if (!prompt) return notFound()
      const { restoreVersion } = await import("../db/versions.js")
      await restoreVersion(prompt.id, version, changed_by)
      return json({ restored: true, id: prompt.id, version }, 200, origin)
    }

    const similarMatch = path.match(/^\/api\/prompts\/([^/]+)\/similar$/)
    if (similarMatch && method === "GET") {
      const limit = parseInt(url.searchParams.get("limit") ?? "5")
      const prompt = getPrompt(similarMatch[1]!)
      if (!prompt) return notFound()
      return json(findSimilar(prompt.id, limit), 200, origin)
    }

    const varsMatch = path.match(/^\/api\/prompts\/([^/]+)\/variables$/)
    if (varsMatch && method === "GET") {
      const prompt = getPrompt(varsMatch[1]!)
      if (!prompt) return notFound()
      return json(extractVariableInfo(prompt.body), 200, origin)
    }

    if (path === "/api/search" && method === "GET") {
      const q = url.searchParams.get("q") ?? ""
      const collection = url.searchParams.get("collection") ?? undefined
      const tags = url.searchParams.get("tags")?.split(",") ?? undefined
      const is_template = url.searchParams.has("templates") ? true : undefined
      const limit = parseInt(url.searchParams.get("limit") ?? "20")
      const full = url.searchParams.has("full")
      return json(full
        ? searchPrompts(q, { collection, tags, is_template, limit })
        : searchPromptsSlim(q, { collection, tags, is_template, limit }), 200, origin)
    }

    if (path === "/api/templates" && method === "GET") {
      return json(listPromptsSlim({ is_template: true, limit: 50 }), 200, origin)
    }

    if (path === "/api/collections" && method === "GET") {
      return json(listCollections(), 200, origin)
    }

    if (path === "/api/collections" && method === "POST") {
      const { name, description } = await parseBody<{ name: string; description?: string }>(req)
      if (!name) return badRequest("name is required")
      return json(ensureCollection(name, description), 201, origin)
    }

    if (path === "/api/stats" && method === "GET") {
      return json(getPromptStats(), 200, origin)
    }

    if (path === "/api/import" && method === "POST") {
      const { prompts, changed_by } = await parseBody<{ prompts: Parameters<typeof importFromJson>[0]; changed_by?: string }>(req)
      return json(await importFromJson(prompts, changed_by), 200, origin)
    }

    if (path === "/api/export" && method === "GET") {
      const collection = url.searchParams.get("collection") ?? undefined
      return json(exportToJson(collection), 200, origin)
    }

    if (path === "/api/projects" && method === "GET") {
      return json(listProjects(), 200, origin)
    }

    if (path === "/api/projects" && method === "POST") {
      const { name, description, path: projPath } = await parseBody<{ name: string; description?: string; path?: string }>(req)
      if (!name) return badRequest("name is required")
      return json(createProject({ name, description, path: projPath }), 201, origin)
    }

    const projectMatch = path.match(/^\/api\/projects\/([^/]+)$/)
    if (projectMatch) {
      const projId = projectMatch[1]!

      if (method === "GET") {
        const project = getProject(projId)
        if (!project) return notFound(`Project not found: ${projId}`)
        return json(project, 200, origin)
      }

      if (method === "DELETE") {
        try {
          deleteProject(projId)
          return json({ deleted: true, id: projId }, 200, origin)
        } catch (e) {
          return notFound(e instanceof Error ? e.message : String(e))
        }
      }
    }

    const projectPromptsMatch = path.match(/^\/api\/projects\/([^/]+)\/prompts$/)
    if (projectPromptsMatch && method === "GET") {
      const projId = projectPromptsMatch[1]!
      const project = getProject(projId)
      if (!project) return notFound(`Project not found: ${projId}`)
      const limit = parseInt(url.searchParams.get("limit") ?? "100")
      const offset = parseInt(url.searchParams.get("offset") ?? "0")
      const full = url.searchParams.has("full")
      return json(full ? listPrompts({ project_id: project.id, limit, offset }) : listPromptsSlim({ project_id: project.id, limit, offset }), 200, origin)
    }

    return notFound()
  }

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method

    // CORS preflight: no wildcard anywhere. /v1 refuses cross-origin preflight
    // (API-key auth is not a browser flow); /api reflects localhost origins only.
    if (method === "OPTIONS") {
      const origin = corsOrigin(req)
      if (origin) {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
      }
      return new Response(null, { status: 204 })
    }

    try {
      // Public probes
      if (path === "/health") {
        return json({ status: "ok", name: "prompts", version: PACKAGE_VERSION, backend: BACKEND })
      }
      if (path === "/ready") {
        const dbOk = await store.ping()
        return dbOk
          ? json({ status: "ready", name: "prompts", version: PACKAGE_VERSION, backend: BACKEND })
          : json({ status: "not_ready", name: "prompts", version: PACKAGE_VERSION, backend: BACKEND }, 503)
      }
      if (path === "/version") {
        return json({ status: "ok", name: "prompts", version: PACKAGE_VERSION, backend: BACKEND })
      }
      if (path === "/openapi.json") {
        return new Response(JSON.stringify(openApiDoc, null, 2), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }

      // Authenticated /v1 surface
      if (path.startsWith("/v1/")) {
        const handled = await v1Handler(req, url, path, method)
        if (handled) return handled
        return notFound()
      }

      // Legacy local-only /api surface
      if (path.startsWith("/api/")) {
        return await legacyApiHandler(req, url, path, method)
      }

      // MCP Streamable HTTP
      if (path === "/mcp") {
        return handleMcpRequest(req, buildServer)
      }

      return notFound()
    } catch (e) {
      if (e instanceof HttpError) {
        return e.status === 401 ? unauthorized(e.message, e.reason) : forbidden(e.message, e.reason)
      }
      return serverError(e)
    }
  }

  const BunGlobal = (globalThis as unknown as { Bun?: { serve: (o: unknown) => { port: number; stop: () => void } } })
    .Bun
  if (!BunGlobal?.serve) {
    throw new Error("prompts-serve requires the Bun runtime (Bun.serve unavailable).")
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler })
  console.log(`[prompts-serve] listening on http://${hostname}:${server.port} (backend=${BACKEND}, version=${version})`)

  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop()
      if (pool) await pool.close()
      if (BACKEND === "sqlite") closeDatabase()
    },
  }
}

/** Object-first body write for /v1 creates and updates. */
async function writePromptBodyObjectV1(id: string, version: number, body: string): Promise<{ uri: string; sha256: string; bytes: number; wrote: boolean }> {
  const bodyStore = getResolvedBodyStore(process.env).store
  const record = await writePromptBodyObject(bodyStore, id, version, body)
  return { uri: record.uri, sha256: record.sha256, bytes: record.bytes, wrote: true }
}

function generatePromptIdV1(): string {
  return `prmt-${Math.random().toString(36).slice(2, 10)}`
}

// Serve when executed directly.
if (import.meta.main) {
  void startPromptsServe().catch((e) => {
    console.error(`[prompts-serve] failed to start: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  })
}

// Main entry: keep the export default fetch-compatible shape the previous
// version exposed and start the server when executed directly.
export default {
  port: PORT,
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname
    const method = req.method
    if (method === "OPTIONS") {
      return new Response(null, { status: 204 })
    }
    if (path === "/health") {
      return json({ status: "ok", name: "prompts", version: PACKAGE_VERSION, backend: BACKEND })
    }
    return notFound()
  },
}
