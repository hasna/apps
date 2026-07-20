/**
 * Hermetic coverage for the live E2B runtime backend's log + port surfaces.
 *
 * The real `e2b` SDK is never loaded: we register a faked module (no network, no
 * credentials) via `mock.module`, then drive the backend's `getLogs` and
 * `listExposedPorts` exactly as the CLI/MCP would. This proves the request
 * mapping against the documented `GET /v2/sandboxes/{sandboxID}/logs` envelope
 * and that ports are a typed "unsupported" result — not a silent [].
 */
import { afterAll, describe, expect, test, mock } from "bun:test"
import { LiveProviderUnavailableError } from "../../src/runtime/types"

// Recorded by the faked ApiClient so tests can assert the exact request shape.
let lastLogsRequest: { path: string; params: unknown } | undefined
let logsFixture: { logs?: unknown[] } | undefined
let logsFailure: { error?: unknown; response?: { status?: number } } | undefined

// Fake `e2b` module. Only the pieces the log path touches are implemented; every
// method is offline and never inspects the (fake) API key beyond storing it.
mock.module("e2b", () => ({
  Sandbox: {
    async connect() {
      return {}
    },
  },
  ConnectionConfig: class {
    constructor(_opts: { apiKey?: string }) {}
  },
  ApiClient: class {
    readonly api = {
      GET: async (path: string, init: { params: unknown }) => {
        lastLogsRequest = { path, params: init.params }
        if (logsFailure !== undefined) {
          return { error: logsFailure.error ?? {}, response: logsFailure.response }
        }
        return { data: logsFixture, response: { status: 200 } }
      },
    }
    constructor(_config: unknown) {}
  },
}))

// The backend imports "e2b" lazily inside its methods, so a normal static import
// here is safe — the mock above is registered before any method runs.
const { createE2bBackend } = await import("../../src/runtime/e2b-backend")

// `mock.module` is process-global in Bun; restore after this file so the faked
// `e2b` module can never leak into any later test file that might one day import
// the real SDK at runtime.
afterAll(() => {
  mock.restore()
})

const FAKE_KEY = "fake-api-key-for-hermetic-tests"

describe("e2b runtime backend — logs + ports (hermetic, faked SDK)", () => {
  test("getLogs maps real v2 sandbox log entries onto provider-neutral LogEntry[]", async () => {
    logsFailure = undefined
    logsFixture = {
      logs: [
        { level: "info", message: "boot", timestamp: "2026-07-20T00:00:00.000Z", fields: {} },
        { level: "debug", message: "trace", timestamp: "2026-07-20T00:00:01.000Z", fields: {} },
        { level: "warn", message: "slow", timestamp: "2026-07-20T00:00:02.000Z", fields: {} },
        { level: "error", message: "boom", timestamp: "2026-07-20T00:00:03.000Z", fields: {} },
      ],
    }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    const logs = await backend.getLogs("sbx_1")

    // Drove the documented, versioned logs endpoint with the sandbox id in the path.
    expect(lastLogsRequest?.path).toBe("/v2/sandboxes/{sandboxID}/logs")
    expect(lastLogsRequest?.params).toEqual({ path: { sandboxID: "sbx_1" } })

    // debug collapses to info; warn/error pass through; ts + message preserved.
    expect(logs).toEqual([
      { ts: "2026-07-20T00:00:00.000Z", level: "info", event: "sandbox", message: "boot" },
      { ts: "2026-07-20T00:00:01.000Z", level: "info", event: "sandbox", message: "trace" },
      { ts: "2026-07-20T00:00:02.000Z", level: "warn", event: "sandbox", message: "slow" },
      { ts: "2026-07-20T00:00:03.000Z", level: "error", event: "sandbox", message: "boom" },
    ])
  })

  test("getLogs returns [] for a real empty log response (a genuine result, not a stub)", async () => {
    logsFailure = undefined
    logsFixture = { logs: [] }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    expect(await backend.getLogs("sbx_empty")).toEqual([])
  })

  test("getLogs tolerates a logless envelope without throwing", async () => {
    logsFailure = undefined
    logsFixture = {}
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    expect(await backend.getLogs("sbx_missing_field")).toEqual([])
  })

  test("getLogs raises a typed live-provider error on an API failure (never a silent [])", async () => {
    logsFailure = { error: { message: "upstream" }, response: { status: 500 } }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    await expect(backend.getLogs("sbx_err")).rejects.toBeInstanceOf(LiveProviderUnavailableError)
  })

  test("listExposedPorts is a clear typed unsupported result — E2B has no port-enumeration API", async () => {
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    const caught = await backend.listExposedPorts("sbx_ports").catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(LiveProviderUnavailableError)
    expect((caught as LiveProviderUnavailableError).code).toBe("live_provider_unavailable")
  })
})
