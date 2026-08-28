// Regression for finding code-prompts-1 (P1): prompts-serve exposed a fully
// unauthenticated state-changing HTTP API under /api/* with
// Access-Control-Allow-Origin: *. Every /api/* data request — reads and writes
// alike — must require `Authorization: Bearer <PROMPTS_API_TOKEN>`, and the
// server must fail closed when no token is configured. Wildcard CORS must not
// be emitted. The one carve-out is the browser preflight: an OPTIONS request
// from an allowed origin (loopback, or an exact origin in
// PROMPTS_API_CORS_ORIGIN) receives restricted CORS headers without a bearer
// because preflights carry no data and browsers cannot attach Authorization to
// them; the actual data request that follows still requires the token.
import { afterEach, describe, expect, test } from "bun:test"
import server from "./index.js"

process.env["PROMPTS_DB_PATH"] = ":memory:"

const TEST_BEARER = "unit-test-v9f2"

function clearTokenEnv(): void {
  delete process.env["PROMPTS_API_TOKEN"]
  delete process.env["HASNA_PROMPTS_API_TOKEN"]
  delete process.env["PROMPTS_API_CORS_ORIGIN"]
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

  test("requires the bearer token on OPTIONS preflight without an allowed origin", async () => {
    setTokenEnv()
    // No Origin header (server-to-server client): preflight still needs the token.
    const res = await server.fetch(api("/api/prompts", { method: "OPTIONS" }))
    expect(res.status).toBe(401)
    const ok = await server.fetch(api("/api/prompts", { method: "OPTIONS", headers: { Authorization: `Bearer ${TEST_BEARER}` } }))
    expect(ok.status).toBe(204)
    // Non-loopback browser origin: denied, no CORS headers.
    const foreign = await server.fetch(
      api("/api/prompts", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }),
    )
    expect(foreign.status).toBe(401)
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull()
  })

  test("answers OPTIONS preflight from a loopback origin with CORS headers and no bearer", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization")
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*")
  })

  test("answers OPTIONS preflight from an explicitly configured PROMPTS_API_CORS_ORIGIN", async () => {
    setTokenEnv()
    process.env["PROMPTS_API_CORS_ORIGIN"] = "https://prompts.example"
    const res = await server.fetch(
      api("/api/prompts", { method: "OPTIONS", headers: { Origin: "https://prompts.example" } }),
    )
    expect(res.status).toBe(204)
    expect(res.headers.get("access-control-allow-origin")).toBe("https://prompts.example")
  })

  test("loopback preflight allowance does not bypass auth on actual requests", async () => {
    setTokenEnv()
    const read = await server.fetch(
      api("/api/prompts", { headers: { Origin: "http://localhost:5173" } }),
    )
    expect(read.status).toBe(401)
    const write = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Origin: "http://localhost:5173" },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(write.status).toBe(401)
    const authed = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${TEST_BEARER}` },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(authed.status).toBe(201)
  })

  test("authenticated data responses from an allowed origin carry Access-Control-Allow-Origin", async () => {
    setTokenEnv()
    const read = await server.fetch(
      api("/api/prompts", { headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${TEST_BEARER}` } }),
    )
    expect(read.status).toBe(200)
    expect(read.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
    const write = await server.fetch(
      api("/api/prompts", {
        method: "POST",
        headers: { Origin: "http://localhost:5173", Authorization: `Bearer ${TEST_BEARER}` },
        body: createPayload(uniqueTitle()),
      }),
    )
    expect(write.status).toBe(201)
    expect(write.headers.get("access-control-allow-origin")).toBe("http://localhost:5173")
  })

  test("data responses from a non-allowed origin carry no CORS headers", async () => {
    setTokenEnv()
    const res = await server.fetch(
      api("/api/prompts", { headers: { Origin: "https://evil.example", Authorization: `Bearer ${TEST_BEARER}` } }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("access-control-allow-origin")).toBeNull()
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
