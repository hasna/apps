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
  test("maps read helpers to their REST endpoints", async () => {
    await api.getSummary("week")
    await api.getDaily()
    await api.getDaily(7)
    await api.getHourly()
    await api.getHourly("apple06")
    await api.getTop()
    await api.getTop(3)
    await api.getModels()
    await api.getProjects()
    await api.getProjects("month")
    await api.getAccounts()
    await api.getAccounts("month")
    await api.getBreakdown("project")
    await api.getBreakdown("agent", "week")
    await api.getBreakdown("account")
    await api.getBudgets()
    await api.getPricing()
    await api.getBilling()
    await api.getBilling("year")
    await api.getSubscriptions()
    await api.getGoals()

    expect(requestPaths()).toEqual([
      "/api/summary?period=week",
      "/api/daily?days=30",
      "/api/daily?days=7",
      "/api/hourly",
      "/api/hourly?machine=apple06",
      "/api/top?n=10",
      "/api/top?n=3",
      "/api/models",
      "/api/projects?period=all",
      "/api/projects?period=month",
      "/api/accounts?period=all",
      "/api/accounts?period=month",
      "/api/breakdown?by=project",
      "/api/breakdown?by=agent&period=week",
      "/api/breakdown?by=account",
      "/api/budgets",
      "/api/pricing",
      "/api/billing?period=month",
      "/api/billing?period=year",
      "/api/subscriptions",
      "/api/goals",
    ])
  })

  test("builds session query filters without dropping machine-readable fields", async () => {
    await api.getSessions({
      agent: "codex",
      search: "open economy",
      account: "work@example.com",
      limit: 25,
      offset: 5,
      since: "2026-05-09T00:00:00Z",
    })

    const url = new URL(requests[0].url)
    expect(url.origin).toBe("http://dashboard.test")
    expect(url.pathname).toBe("/api/sessions")
    expect(url.searchParams.get("agent")).toBe("codex")
    expect(url.searchParams.get("search")).toBe("open economy")
    expect(url.searchParams.get("account")).toBe("work@example.com")
    expect(url.searchParams.get("limit")).toBe("25")
    expect(url.searchParams.get("offset")).toBe("5")
    expect(url.searchParams.get("since")).toBe("2026-05-09T00:00:00Z")
  })

  test("encodes path parameters for detail and delete endpoints", async () => {
    fetchHandler = (input, init) => {
      if (init?.method === "DELETE") return jsonResponse({ data: { ok: true } })
      return jsonResponse({ data: [] })
    }

    await api.getSessionRequests("session/with spaces")
    const budgetDelete = await api.deleteBudget("budget/with spaces")
    const pricingDelete = await api.deletePricing("openai/gpt 5.5")
    const subscriptionDelete = await api.deleteSubscription("subscription/with spaces")
    const goalDelete = await api.deleteGoalApi("goal/with spaces")

    expect(new URL(requests[0].url).pathname).toBe("/api/sessions/session%2Fwith%20spaces/requests")
    expect(new URL(requests[1].url).pathname).toBe("/api/budgets/budget%2Fwith%20spaces")
    expect(requests[1].init?.method).toBe("DELETE")
    expect(new URL(requests[2].url).pathname).toBe("/api/pricing/openai%2Fgpt%205.5")
    expect(requests[2].init?.method).toBe("DELETE")
    expect(new URL(requests[3].url).pathname).toBe("/api/subscriptions/subscription%2Fwith%20spaces")
    expect(requests[3].init?.method).toBe("DELETE")
    expect(new URL(requests[4].url).pathname).toBe("/api/goals/goal%2Fwith%20spaces")
    expect(requests[4].init?.method).toBe("DELETE")
    expect(budgetDelete.data.ok).toBe(true)
    expect(pricingDelete.data.ok).toBe(true)
    expect(subscriptionDelete.data.ok).toBe(true)
    expect(goalDelete.data.ok).toBe(true)
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

  test("posts budget, pricing, source sync, and goal payloads", async () => {
    fetchHandler = (input) => {
      const path = new URL(String(input)).pathname
      if (path === "/api/sync") return jsonResponse({ data: { gemini: { sessions: 1 } } })
      if (path === "/api/budgets") return jsonResponse({ data: { id: "budget-1" } })
      if (path === "/api/pricing") return jsonResponse({ data: { model: "custom-model" } })
      if (path === "/api/goals") return jsonResponse({ data: { id: "goal-1" } })
      if (path === "/api/subscriptions") return jsonResponse({ data: { id: "sub-1" } })
      return jsonResponse({ data: {} })
    }

    await api.createBudget({ project_path: "/workspace/open-economy", agent: "takumi", period: "weekly", limit_usd: 25, alert_at_percent: 70 })
    await api.createPricing({
      model: "custom-model",
      input_per_1m: 1,
      output_per_1m: 2,
      cache_read_per_1m: 0.1,
      cache_write_per_1m: 1.25,
      cache_write_1h_per_1m: 2,
      cache_storage_per_1m_hour: 4.5,
    })
    const geminiSync = await api.syncSources("gemini")
    const allSync = await api.syncSources()
    await api.createGoal({ period: "week", limit_usd: 50, project_path: "/workspace/open-economy", agent: "codex" })
    await api.createSubscription({ provider: "cursor", plan: "pro", agent: "cursor", monthly_fee_usd: 20, included_usage_usd: 20 })

    expect(requestPaths()).toEqual([
      "/api/budgets",
      "/api/pricing",
      "/api/sync",
      "/api/sync",
      "/api/goals",
      "/api/subscriptions",
    ])
    expect(requests.map((request) => request.init?.method)).toEqual(["POST", "POST", "POST", "POST", "POST", "POST"])
    expect(JSON.parse(String(requests[0].init?.body))).toEqual({
      project_path: "/workspace/open-economy",
      agent: "takumi",
      period: "weekly",
      limit_usd: 25,
      alert_at_percent: 70,
    })
    expect(JSON.parse(String(requests[1].init?.body))).toEqual({
      model: "custom-model",
      input_per_1m: 1,
      output_per_1m: 2,
      cache_read_per_1m: 0.1,
      cache_write_per_1m: 1.25,
      cache_write_1h_per_1m: 2,
      cache_storage_per_1m_hour: 4.5,
    })
    expect(JSON.parse(String(requests[2].init?.body))).toEqual({ sources: "gemini" })
    expect(JSON.parse(String(requests[3].init?.body))).toEqual({ sources: "all" })
    expect(geminiSync.data).toEqual({ gemini: { sessions: 1 } })
    expect(allSync.data).toEqual({ gemini: { sessions: 1 } })
    expect(JSON.parse(String(requests[4].init?.body))).toEqual({
      period: "week",
      limit_usd: 50,
      project_path: "/workspace/open-economy",
      agent: "codex",
    })
    expect(JSON.parse(String(requests[5].init?.body))).toEqual({
      provider: "cursor",
      plan: "pro",
      agent: "cursor",
      monthly_fee_usd: 20,
      included_usage_usd: 20,
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

function requestPaths(): string[] {
  return requests.map((request) => {
    const url = new URL(request.url)
    return `${url.pathname}${url.search}`
  })
}
