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

// Drives the faked command runner. Mirrors a single E2B CommandResult; the fake
// `commands.run` throws a CommandExitError-shaped error whenever exitCode !== 0,
// exactly like the real SDK's `CommandHandle.wait()`.
let execFixture: { exitCode: number; stdout: string; stderr: string } = { exitCode: 0, stdout: "", stderr: "" }
let lastRun: { cmd: string; opts: Record<string, unknown> } | undefined
// When set, the fake `commands.run` throws this instead — used to prove that
// genuine (non-CommandExitError) failures are re-thrown, never converted.
let execThrow: Error | undefined

/**
 * Faithful stand-in for the real `e2b` `CommandExitError`: extends Error, carries
 * a stable `name`, and implements CommandResult (exitCode/stdout/stderr). Its
 * message is the envd's Go-style "exit status N" — the exact string the CLI
 * leaked to users before the fix.
 */
class FakeCommandExitError extends Error {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly error: string
  constructor(result: { exitCode: number; stdout: string; stderr: string }) {
    const message = `exit status ${result.exitCode}`
    super(message)
    this.name = "CommandExitError"
    this.exitCode = result.exitCode
    this.stdout = result.stdout
    this.stderr = result.stderr
    this.error = message
  }
}

// Fake `e2b` module. Only the pieces the log/exec paths touch are implemented;
// every method is offline and never inspects the (fake) API key beyond storing it.
mock.module("e2b", () => ({
  Sandbox: {
    async connect() {
      return {
        commands: {
          async run(cmd: string, opts: Record<string, unknown>) {
            lastRun = { cmd, opts }
            // A genuine transport/auth failure (not a CommandExitError).
            if (execThrow !== undefined) throw execThrow
            const result = { ...execFixture }
            // Real SDK: run() awaits wait(), which throws on any non-zero exit.
            if (result.exitCode !== 0) throw new FakeCommandExitError(result)
            return result
          },
        },
      }
    },
  },
  CommandExitError: FakeCommandExitError,
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

/**
 * Regression coverage for the 1.0.1 defect: E2B's `commands.run()` throws a
 * `CommandExitError` on any non-zero exit, and the backend used to let that
 * escape — so `sandboxes -p e2b exec <id> ...` reported "error: exit status N",
 * threw away the command's stdout/stderr, and masked the real exit code to 1.
 * These tests would have failed before the fix (exec rejected) and pass after it
 * (exec resolves with the true exit code + captured output).
 */
describe("e2b runtime backend — exec exit-code propagation (hermetic, faked SDK)", () => {
  test("a successful command returns exit 0 with output captured (and drives commands.run)", async () => {
    execFixture = { exitCode: 0, stdout: "hi\n", stderr: "" }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })

    const result = await backend.exec("sbx_ok", ["echo", "hi"])

    expect(result.exit_code).toBe(0)
    expect(result.stdout).toBe("hi\n")
    expect(result.stderr).toBe("")
    expect(result.finished).toBe(true)
    // argv is shell-joined into the single command string the SDK expects.
    expect(lastRun?.cmd).toBe("echo hi")
  })

  test("a non-zero exit is a RESULT, not a throw — real exit code + stderr are preserved", async () => {
    // Mirrors `ls /nonexistent`: envd reports "exit status 2" and the command
    // still produced diagnostic output on stderr.
    execFixture = {
      exitCode: 2,
      stdout: "",
      stderr: "ls: cannot access '/nope': No such file or directory\n",
    }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })

    // Before the fix this rejected with the SDK's CommandExitError.
    const result = await backend.exec("sbx_fail", ["ls", "/nope"])

    expect(result.exit_code).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("ls: cannot access '/nope': No such file or directory\n")
    expect(result.finished).toBe(true)
  })

  test("exit code 1 propagates too (the canonical /bin/false case)", async () => {
    execFixture = { exitCode: 1, stdout: "", stderr: "" }
    const backend = createE2bBackend({ apiKey: FAKE_KEY })

    const result = await backend.exec("sbx_false", ["/bin/false"])

    expect(result.exit_code).toBe(1)
    expect(result.finished).toBe(true)
  })

  test("a genuine (non-CommandExitError) SDK failure is re-thrown, never swallowed as exit 0", async () => {
    // A transport/auth error has no numeric exitCode and is NOT a CommandExitError;
    // it must propagate so real failures are never disguised as a normal result.
    class FakeSandboxError extends Error {
      constructor(message: string) {
        super(message)
        this.name = "SandboxError"
      }
    }
    execThrow = new FakeSandboxError("connection reset by peer")
    const backend = createE2bBackend({ apiKey: FAKE_KEY })
    try {
      await expect(backend.exec("sbx_transport", ["echo", "hi"])).rejects.toThrow("connection reset by peer")
    } finally {
      execThrow = undefined
    }
  })
})
