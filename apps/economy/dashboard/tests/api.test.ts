import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"

process.env.VITE_API_URL = "http://dashboard.test"

type DashboardApi = typeof import("../src/api")

let api: DashboardApi
let requests: Array<{ url: string; init?: RequestInit }>
let fetchHandler: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>
const originalFetch = globalThis.fetch

beforeAll(async () => {
  api = await import("../src/api")
})

beforeEach(() => {
  requests = []
  fetchHandler = () => jsonResponse({ data: [] })
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init })
    return fetchHandler(input, init)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("dashboard API client", () => {
  test("builds session query filters without dropping machine-readable fields", async () => {
    await api.getSessions({
      agent: "codex",
      search: "open economy",
      limit: 25,
      offset: 5,
      since: "2026-05-09T00:00:00Z",
    })

    const url = new URL(requests[0].url)
    expect(url.origin).toBe("http://dashboard.test")
    expect(url.pathname).toBe("/api/sessions")
    expect(url.searchParams.get("agent")).toBe("codex")
    expect(url.searchParams.get("search")).toBe("open economy")
    expect(url.searchParams.get("limit")).toBe("25")
    expect(url.searchParams.get("offset")).toBe("5")
    expect(url.searchParams.get("since")).toBe("2026-05-09T00:00:00Z")
  })

  test("encodes path parameters for detail and delete endpoints", async () => {
    await api.getSessionRequests("session/with spaces")
    await api.deletePricing("openai/gpt 5.5")

    expect(new URL(requests[0].url).pathname).toBe("/api/sessions/session%2Fwith%20spaces/requests")
    expect(new URL(requests[1].url).pathname).toBe("/api/pricing/openai%2Fgpt%205.5")
    expect(requests[1].init?.method).toBe("DELETE")
  })

  test("posts billing sync providers including gemini", async () => {
    await api.syncBilling({ days: 14, providers: ["anthropic", "openai", "gemini"] })

    expect(new URL(requests[0].url).pathname).toBe("/api/billing/sync")
    expect(requests[0].init?.method).toBe("POST")
    expect(requests[0].init?.headers).toEqual({ "Content-Type": "application/json" })
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      days: 14,
      providers: ["anthropic", "openai", "gemini"],
    })
  })

  test("includes response text in API errors", async () => {
    fetchHandler = () => new Response("invalid period", { status: 422 })

    await expect(api.createGoal({ period: "forever", limit_usd: 1 })).rejects.toThrow(
      "API error 422: invalid period"
    )
  })
})

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
