import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mintApiKey, ApiKeyStore } from "@hasna/contracts/auth"
import { Database } from "bun:sqlite"
import { startPromptsServe, SqliteAuthClient } from "./server/index.js"
import { getDatabase, closeDatabase, resetDatabase, runMigrations } from "./db/database.js"
import { resolvePromptsHttpStore, createPromptsHttpStore } from "./http-store.js"
import { createPromptsClient, type PromptsSdk } from "./sdk.js"
import { PROMPTS_API_URL_ENV, PROMPTS_API_KEY_ENV } from "./client-transport.js"

let server: Awaited<ReturnType<typeof startPromptsServe>>
let apiUrl: string
let apiKey: string
let tempHome: string
let originals: Record<string, string | undefined> = {}

beforeAll(async () => {
  closeDatabase()
  resetDatabase()
  tempHome = mkdtempSync(join(tmpdir(), "prompts-http-store-"))
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: tempHome,
    HASNA_PROMPTS_DB_PATH: join(tempHome, "t.db"),
    PROMPTS_DB_PATH: join(tempHome, "t.db"),
    HASNA_PROMPTS_API_SIGNING_KEY: "test-signing-secret",
  }
  // An explicit, isolated database: the module singleton is shared by every
  // test file in this process, and two servers must never share it.
  const db = new Database(join(tempHome, "t.db"))
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  runMigrations(db)
  server = await startPromptsServe({ port: 0, env, db })
  apiUrl = `http://127.0.0.1:${server.port}`
  const minted = mintApiKey({
    app: "prompts",
    scopes: ["prompts:read", "prompts:write"],
    signingSecret: "test-signing-secret",
  })
  await new ApiKeyStore(new SqliteAuthClient(db)).insertMinted(minted)
  apiKey = minted.token

  originals[PROMPTS_API_URL_ENV] = process.env[PROMPTS_API_URL_ENV]
  originals[PROMPTS_API_KEY_ENV] = process.env[PROMPTS_API_KEY_ENV]
  process.env[PROMPTS_API_URL_ENV] = apiUrl
  process.env[PROMPTS_API_KEY_ENV] = apiKey
})

afterAll(async () => {
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await server.stop()
  rmSync(tempHome, { recursive: true, force: true })
})

describe("PromptsHttpStore", () => {
  test("create, list, get, update, delete round-trip over /v1", async () => {
    const store = resolvePromptsHttpStore()!
    expect(store).not.toBeNull()
    expect(store.baseUrl).toBe(`${apiUrl}/v1`)

    const created = await store.create({ title: "HTTP store", body: "body one", slug: "hs-http-store" })
    expect(created.id).toBeTruthy()
    expect(created.body_sha256).toMatch(/^[0-9a-f]{64}$/)

    const list = await store.list({ limit: 10 })
    expect(list.total).toBeGreaterThanOrEqual(1)
    expect(list.items.some((i) => i.id === created.id)).toBe(true)

    const got = await store.get(created.id as string)
    expect(got).not.toBeNull()
    expect((got as { body: string }).body).toBe("body one")

    const updated = await store.update(created.id as string, { body: "body two" })
    expect((updated as { body: string }).body).toBe("body two")

    const search = await store.search({ query: "body two" })
    expect(search.items.length).toBeGreaterThanOrEqual(1)

    const rendered = await store.render(created.id as string, {})
    expect(rendered.body).toBe("body two")

    expect(await store.delete(created.id as string)).toBe(true)
    expect(await store.get(created.id as string)).toBeNull()
  })

  test("storageStatus reports the server backend", async () => {
    const store = resolvePromptsHttpStore()!
    const status = await store.storageStatus()
    expect(status.backend).toBe("sqlite")
    expect(status.prompts_total).toBeGreaterThanOrEqual(0)
  })

  test("createPromptsHttpStore builds a client from explicit values", async () => {
    const store = createPromptsHttpStore(apiUrl, apiKey)
    const status = await store.storageStatus()
    expect(status.backend).toBe("sqlite")
  })
})

describe("createPromptsClient (./sdk)", () => {
  test("selects the http client when API URL and key are set", async () => {
    const client = createPromptsClient() as PromptsSdk
    expect(client.transport).toBe("http")
    if (client.transport === "http") {
      const created = await client.client.createPrompt({ title: "SDK prompt", body: "sdk body", slug: "hs-sdk-prompt" })
      expect(created.title).toBe("SDK prompt")
    }
  })

  test("selects the local client when the API URL is absent", async () => {
    delete process.env[PROMPTS_API_URL_ENV]
    delete process.env[PROMPTS_API_KEY_ENV]
    const client = createPromptsClient()
    expect(client.transport).toBe("sqlite")
    if (client.transport === "sqlite") {
      const created = await client.create({ title: "Local SDK", body: "local body" })
      expect(created.title).toBe("Local SDK")
      const rendered = await client.render(created.id as string, {})
      expect(rendered.body).toBe("local body")
      expect(((await client.storageStatus()) as { server: { backend: string } }).server.backend).toBe("sqlite")
    }
    process.env[PROMPTS_API_URL_ENV] = apiUrl
    process.env[PROMPTS_API_KEY_ENV] = apiKey
  })
})
