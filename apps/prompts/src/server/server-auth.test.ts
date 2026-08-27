// Regression for finding code-prompts-1 (P1): prompts-serve exposed a fully
// unauthenticated state-changing HTTP API under /api/* with
// Access-Control-Allow-Origin: *. Every /api/* route — including OPTIONS
// preflight — must require `Authorization: Bearer <PROMPTS_API_TOKEN>`, and the
// server must fail closed when no token is configured. Wildcard CORS must not
// be emitted.
import { afterEach, describe, expect, test } from "bun:test"
import server from "./index.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

const TEST_BEARER = "unit-test-v9f2"

function clearTokenEnv(): void {
  delete process.env["PROMPTS_API_TOKEN"]
  delete process.env["HASNA_PROMPTS_API_TOKEN"]
}

function setTokenEnv(): void {
  clearTokenEnv()
  process.env["PROMPTS_API_TOKEN"] = TEST_BEARER
}

function api(path: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost:19430${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
  })
}

function createPayload(title: string): string {
  return JSON.stringify({ title, body: `Hello {{name}}` })
}

let seq = 0

/** Unique title per call so upsert never collides with an earlier test run. */
function uniqueTitle(): string {
  seq += 1
  return `auth-regression-${seq}`
}

afterEach(() => {
  clearTokenEnv()
})

describe("prompts-serve API authentication (code-prompts-1)", () => {
  test("refuses /api/* requests when no API token is configured (fail closed)", async () => {
    clearTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", { method: "POST", body: createPayload(uniqueTitle()) }),
    )
    expect(res.status).toBe(503)
  })

  test("rejects an unauthenticated state-changing POST", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", { method: "POST", body: createPayload(uniqueTitle()) }),
    )
    expect(res.status).toBe(401)
  })

  test("rejects a wrong bearer token", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-token" },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(res.status).toBe(403)
  })

  test("accepts a state-changing POST with the correct bearer token", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_BEARER}` },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(res.status).toBe(201)
  })

  test("requires the bearer token on GET reads too", async () => {
    setTokenEnv()
    const res = await server.fetch(api("/api/prompts"))
    expect(res.status).toBe(401)
    const ok = await server.fetch(api("/api/prompts", { headers: { Authorization: `Bearer ${TEST_BEARER}` } }))
    expect(ok.status).toBe(200)
  })

  test("requires the bearer token on OPTIONS preflight", async () => {
    setTokenEnv()
    const res = await server.fetch(api("/api/prompts", { method: "OPTIONS" }))
    expect(res.status).toBe(401)
    const ok = await server.fetch(api("/api/prompts", { method: "OPTIONS", headers: { Authorization: `Bearer ${TEST_BEARER}` } }))
    expect(ok.status).toBe(204)
  })

  test("never emits Access-Control-Allow-Origin: *", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_BEARER}` },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*")
  })

  test("keeps /health public", async () => {
    clearTokenEnv()
    const res = await server.fetch(api("/health"))
    expect(res.status).toBe(200)
  })
})
