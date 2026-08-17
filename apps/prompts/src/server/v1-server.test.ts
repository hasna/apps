import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mintApiKey, ApiKeyStore } from "@hasna/contracts/auth"
import { Database } from "bun:sqlite"
import { startPromptsServe, SqliteAuthClient } from "./index.js"
import { getDatabase, closeDatabase, resetDatabase, runMigrations } from "../db/database.js"

let server: Awaited<ReturnType<typeof startPromptsServe>>
let baseUrl: string
let tempHome: string
let readToken: string
let writeToken: string
let tenantToken: string

beforeAll(async () => {
  closeDatabase()
  resetDatabase()
  tempHome = mkdtempSync(join(tmpdir(), "prompts-serve-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    HASNA_PROMPTS_DB_PATH: join(tempHome, "t.db"),
    PROMPTS_DB_PATH: join(tempHome, "t.db"),
    HASNA_PROMPTS_API_SIGNING_KEY: "test-signing-secret",
    PORT: "0",
  }
  // An explicit, isolated database: the module singleton is shared by every
  // test file in this process, and two servers must never share it.
  const db = new Database(join(tempHome, "t.db"))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  runMigrations(db)
  server = await startPromptsServe({ port: 0, env, db })
  baseUrl = `http://127.0.0.1:${server.port}`

  const store = new ApiKeyStore(new SqliteAuthClient(db))
  const read = mintApiKey({ app: "prompts", scopes: ["prompts:read"], signingSecret: "test-signing-secret" })
  const write = mintApiKey({ app: "prompts", scopes: ["prompts:read", "prompts:write"], signingSecret: "test-signing-secret" })
  const tenant = mintApiKey({ app: "prompts", scopes: ["prompts:read", "prompts:write"], tid: "org-acme", signingSecret: "test-signing-secret" })
  await store.insertMinted(read)
  await store.insertMinted(write)
  await store.insertMinted(tenant)
  readToken = read.token
  writeToken = write.token
  tenantToken = tenant.token
})

afterAll(async () => {
  await server.stop()
  rmSync(tempHome, { recursive: true, force: true })
})

describe("public probes", () => {
  test("GET /health reports ok with name, version, and backend", async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string; name: string; backend: string }
    expect(body.status).toBe("ok")
    expect(body.name).toBe("prompts")
    expect(body.backend).toBe("sqlite")
  })

  test("GET /ready pings the metadata database", async () => {
    const res = await fetch(`${baseUrl}/ready`)
    expect(res.status).toBe(200)
    const body = await res.json() as { status: string }
    expect(body.status).toBe("ready")
  })

  test("GET /version returns the package version", async () => {
    const res = await fetch(`${baseUrl}/version`)
    expect(res.status).toBe(200)
    const body = await res.json() as { version: string }
    expect(body.version).toBeTruthy()
  })

  test("GET /openapi.json serves the OpenAPI document", async () => {
    const res = await fetch(`${baseUrl}/openapi.json`)
    expect(res.status).toBe(200)
    const body = await res.json() as { openapi: string }
    expect(body.openapi).toMatch(/^3\./)
  })
})

describe("/v1 auth", () => {
  test("requests without a key are denied with 401", async () => {
    const res = await fetch(`${baseUrl}/v1/prompts`)
    expect(res.status).toBe(401)
  })

  test("a read key cannot write (scope enforcement)", async () => {
    const res = await fetch(`${baseUrl}/v1/prompts`, {
      method: "POST",
      headers: { "x-api-key": readToken, "content-type": "application/json" },
      body: JSON.stringify({ title: "Nope", body: "no" }),
    })
    expect(res.status).toBe(403)
  })

  test("a write key creates and reads a prompt", async () => {
    const create = await fetch(`${baseUrl}/v1/prompts`, {
      method: "POST",
      headers: { "x-api-key": writeToken, "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello", body: "world", slug: "v1-hello" }),
    })
    expect(create.status).toBe(201)
    const created = await create.json() as { id: string; body: string; body_sha256: string }
    expect(created.body).toBe("world")
    expect(created.body_sha256).toMatch(/^[0-9a-f]{64}$/)

    const get = await fetch(`${baseUrl}/v1/prompts/${created.id}`, {
      headers: { "x-api-key": writeToken },
    })
    expect(get.status).toBe(200)
    const got = await get.json() as { id: string; title: string }
    expect(got.id).toBe(created.id)
    expect(got.title).toBe("Hello")
  })

  test("render fills variables", async () => {
    const create = await fetch(`${baseUrl}/v1/prompts`, {
      method: "POST",
      headers: { "x-api-key": writeToken, "content-type": "application/json" },
      body: JSON.stringify({ title: "Render", body: "Hello {{name}}", slug: "v1-render" }),
    })
    const created = await create.json() as { id: string }
    const render = await fetch(`${baseUrl}/v1/prompts/${created.id}/render`, {
      method: "POST",
      headers: { "x-api-key": writeToken, "content-type": "application/json" },
      body: JSON.stringify({ vars: { name: "Ada" } }),
    })
    expect(render.status).toBe(200)
    const result = await render.json() as { body: string }
    expect(result.body).toBe("Hello Ada")
  })

  test("tenant keys see exactly their own rows", async () => {
    const acme = await fetch(`${baseUrl}/v1/prompts`, {
      method: "POST",
      headers: { "x-api-key": tenantToken, "content-type": "application/json" },
      body: JSON.stringify({ title: "Acme secret", body: "internal", slug: "v1-acme-secret" }),
    })
    expect(acme.status).toBe(201)

    const acmeList = await fetch(`${baseUrl}/v1/prompts`, {
      headers: { "x-api-key": tenantToken },
    })
    const acmeBody = await acmeList.json() as { items: Array<{ title: string }>; total: number }
    // Only the org-acme row is visible; the untenanted rows are not.
    expect(acmeBody.items.every((i) => i.title === "Acme secret")).toBe(true)

    const untenanted = await fetch(`${baseUrl}/v1/prompts`, {
      headers: { "x-api-key": readToken },
    })
    const nullTenant = await untenanted.json() as { items: Array<{ title: string }> }
    expect(nullTenant.items.some((i) => i.title === "Acme secret")).toBe(false)
  })

  test("/v1 responses carry no wildcard CORS header", async () => {
    const res = await fetch(`${baseUrl}/v1/prompts`, { headers: { "x-api-key": readToken } })
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })
})

describe("legacy /api remains local-only", () => {
  test("legacy routes work with no auth and reflect only localhost origins", async () => {
    const res = await fetch(`${baseUrl}/api/collections`, {
      headers: { origin: "http://localhost:3000" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000")
  })

  test("legacy routes do not reflect non-localhost origins", async () => {
    const res = await fetch(`${baseUrl}/api/collections`, {
      headers: { origin: "https://evil.example.com" },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
  })
})
