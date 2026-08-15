/**
 * Live E2B backend built on the official `e2b` SDK (pinned 2.31.0). The SDK is
 * imported lazily so the CLI/MCP stay usable offline and the hermetic test
 * suite never loads it. The API key is supplied by ./resolve from the
 * environment or the `secrets` vault and is passed straight to the SDK — it is
 * never logged or persisted here.
 *
 * NOTE: The live paths require a real E2B_API_KEY and network access. The
 * request/response *mapping* (including getLogs and the typed listExposedPorts
 * unsupported result) is covered hermetically against a faked `e2b` module, but
 * end-to-end behaviour should still be smoke-tested against a live account before
 * relying on it in production.
 */
import { shellJoin } from "./shell"
import {
  LiveProviderUnavailableError,
  type CreateOptions,
  type ExecOptions,
  type ExecResult,
  type ExposedPort,
  type FileEntry,
  type LogEntry,
  type SandboxBackend,
  type SandboxRecord,
  type SnapshotRecord,
  type WriteReceipt,
} from "./types"

interface E2bCommandResult {
  exitCode: number
  stdout: string
  stderr: string
}
interface E2bEntry {
  name: string
  path?: string
  type?: string
  size?: number
}
interface E2bSandbox {
  sandboxId: string
  commands: { run(cmd: string, opts?: Record<string, unknown>): Promise<E2bCommandResult> }
  files: {
    read(path: string, opts?: Record<string, unknown>): Promise<string>
    write(path: string, data: string | Uint8Array): Promise<unknown>
    list(path: string, opts?: Record<string, unknown>): Promise<E2bEntry[]>
  }
  getHost(port: number): string
  kill(opts?: Record<string, unknown>): Promise<boolean>
  pause(opts?: Record<string, unknown>): Promise<boolean>
  setTimeout(ms: number, opts?: Record<string, unknown>): Promise<void>
  createSnapshot?(opts?: Record<string, unknown>): Promise<{ snapshotId?: string; id?: string }>
}
interface E2bInfo {
  sandboxId: string
  metadata?: Record<string, string>
  startedAt?: string | Date
  templateId?: string
}
interface E2bPaginator {
  hasNext: boolean
  nextItems(opts?: Record<string, unknown>): Promise<E2bInfo[]>
}
interface E2bStatic {
  create(template: string | undefined, opts: Record<string, unknown>): Promise<E2bSandbox>
  connect(id: string, opts: Record<string, unknown>): Promise<E2bSandbox>
  list(opts: Record<string, unknown>): E2bPaginator
  getInfo(id: string, opts: Record<string, unknown>): Promise<E2bInfo>
}

/**
 * Shape of a structured E2B sandbox log entry as returned by the documented,
 * versioned `GET /v2/sandboxes/{sandboxID}/logs` endpoint
 * (openapi `SandboxLogEntry`). E2B ships no high-level `Sandbox.getLogs()`, so we
 * drive this endpoint through the SDK's own typed `ApiClient` (built on
 * openapi-fetch) to return real logs instead of a stub.
 */
interface E2bLogEntry {
  level?: string
  message?: string
  timestamp?: string
  fields?: Record<string, string>
}
interface E2bLogsResult {
  data?: { logs?: E2bLogEntry[] }
  error?: unknown
  response?: { status?: number }
}
interface E2bApiClient {
  api: {
    GET(
      path: "/v2/sandboxes/{sandboxID}/logs",
      init: { params: { path: { sandboxID: string }; query?: Record<string, unknown> } },
    ): Promise<E2bLogsResult>
  }
}
type E2bApiClientCtor = new (config: unknown, opts?: { requireApiKey?: boolean }) => E2bApiClient
type E2bConnectionConfigCtor = new (opts: { apiKey?: string }) => unknown
type E2bCommandExitErrorCtor = new (...args: never[]) => Error

interface E2bModule {
  Sandbox: E2bStatic
  ApiClient?: E2bApiClientCtor
  ConnectionConfig?: E2bConnectionConfigCtor
  CommandExitError?: E2bCommandExitErrorCtor
}

export interface E2bBackendConfig {
  apiKey: string
}

async function loadE2b(): Promise<E2bModule> {
  try {
    return (await import("e2b")) as unknown as E2bModule
  } catch (cause) {
    throw new LiveProviderUnavailableError(`failed to load the e2b SDK: ${String(cause)}`)
  }
}

async function loadSandbox(): Promise<E2bStatic> {
  return (await loadE2b()).Sandbox
}

/** Map E2B's LogLevel ("debug"|"info"|"warn"|"error") onto our neutral levels. */
function normalizeLogLevel(level: string | undefined): LogEntry["level"] {
  return level === "warn" || level === "error" ? level : "info"
}

/**
 * E2B's `commands.run()` REJECTS with a `CommandExitError` on any non-zero exit
 * code: it awaits `CommandHandle.wait()`, which throws for every exit code other
 * than 0. That error *implements* `CommandResult` (it carries the real
 * `exitCode`/`stdout`/`stderr`), so for our provider-neutral seam a non-zero exit
 * is a normal, reportable result — not a transport failure. Recognise it (by
 * class when the SDK exports it, otherwise by its stable `name` + shape) so
 * `exec` can return the true exit code and captured output instead of leaking the
 * SDK's raw "exit status N" message and masking the code to 1.
 */
function asCommandExitResult(error: unknown, mod: E2bModule): E2bCommandResult | undefined {
  const looksLikeExit =
    (typeof mod.CommandExitError === "function" && error instanceof mod.CommandExitError) ||
    (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "CommandExitError")
  if (!looksLikeExit) return undefined
  const candidate = error as { exitCode?: unknown; stdout?: unknown; stderr?: unknown }
  if (typeof candidate.exitCode !== "number") return undefined
  return {
    exitCode: candidate.exitCode,
    stdout: typeof candidate.stdout === "string" ? candidate.stdout : "",
    stderr: typeof candidate.stderr === "string" ? candidate.stderr : "",
  }
}

export function createE2bBackend(config: E2bBackendConfig): SandboxBackend {
  const opts = { apiKey: config.apiKey }
  const info = (i: E2bInfo): SandboxRecord => ({
    id: i.sandboxId,
    provider: "e2b",
    status: "running",
    created_at: typeof i.startedAt === "string" ? i.startedAt : (i.startedAt?.toISOString() ?? new Date().toISOString()),
    template: i.templateId ?? null,
    metadata: i.metadata ?? {},
    labels: {},
    expires_at: null,
  })

  return {
    provider: "e2b",
    async create(options: CreateOptions): Promise<SandboxRecord> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.create(options.template, {
        ...opts,
        ...(options.timeout_ms === undefined ? {} : { timeoutMs: options.timeout_ms }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata }),
      })
      return {
        id: sandbox.sandboxId,
        provider: "e2b",
        status: "running",
        created_at: new Date().toISOString(),
        template: options.template ?? null,
        metadata: options.metadata ?? {},
        labels: {},
        expires_at: null,
      }
    },
    async list(): Promise<SandboxRecord[]> {
      const Sandbox = await loadSandbox()
      const paginator = Sandbox.list(opts)
      const records: SandboxRecord[] = []
      let guard = 0
      while (paginator.hasNext && guard < 100) {
        guard += 1
        for (const item of await paginator.nextItems(opts)) records.push(info(item))
      }
      return records
    },
    async get(id: string): Promise<SandboxRecord> {
      const Sandbox = await loadSandbox()
      return info(await Sandbox.getInfo(id, opts))
    },
    async destroy(id: string): Promise<void> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      await sandbox.kill(opts)
    },
    async stop(id: string): Promise<SandboxRecord> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      await sandbox.pause(opts)
      const record = await this.get(id)
      return { ...record, status: "paused" }
    },
    async keepAlive(id: string, timeoutMs: number): Promise<SandboxRecord> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      await sandbox.setTimeout(timeoutMs, opts)
      return this.get(id)
    },
    async exec(id: string, argv: string[], options: ExecOptions = {}): Promise<ExecResult> {
      const mod = await loadE2b()
      const sandbox = await mod.Sandbox.connect(id, opts)
      const runOpts = {
        ...opts,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { envs: options.env }),
        ...(options.timeout_ms === undefined ? {} : { timeoutMs: options.timeout_ms }),
      }
      const toResult = (result: E2bCommandResult): ExecResult => ({
        session_id: `${id}:cmd`,
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        finished: true,
      })
      try {
        return toResult(await sandbox.commands.run(shellJoin(argv), runOpts))
      } catch (error) {
        // A non-zero exit is a real result, not a failure: recover the exit code
        // and captured output from the SDK's CommandExitError instead of throwing.
        const exit = asCommandExitResult(error, mod)
        if (exit !== undefined) return toResult(exit)
        throw error
      }
    },
    /**
     * Real sandbox logs via the documented, versioned E2B REST endpoint
     * `GET /v2/sandboxes/{sandboxID}/logs`, driven through the SDK's own typed
     * `ApiClient`. E2B ships no high-level `Sandbox.getLogs()`; when this SDK build
     * predates `ApiClient`/`ConnectionConfig` we raise a typed
     * live-provider-unavailable error rather than silently returning [].
     */
    async getLogs(id: string): Promise<LogEntry[]> {
      const mod = await loadE2b()
      if (typeof mod.ApiClient !== "function" || typeof mod.ConnectionConfig !== "function") {
        throw new LiveProviderUnavailableError(
          "e2b SDK build does not expose ApiClient/ConnectionConfig; cannot read sandbox logs",
        )
      }
      const client = new mod.ApiClient(new mod.ConnectionConfig({ apiKey: config.apiKey }))
      const res = await client.api.GET("/v2/sandboxes/{sandboxID}/logs", {
        params: { path: { sandboxID: id } },
      })
      // Fail closed: only a 2xx response that actually carried a body is a
      // success. Any error, non-2xx status, or missing body raises a typed error
      // rather than falling through to a misleading empty log list.
      const status = res.response?.status
      const ok = status !== undefined && status >= 200 && status < 300
      if (!ok || (res.error !== undefined && res.error !== null) || res.data === undefined) {
        throw new LiveProviderUnavailableError(
          `e2b logs request for ${id} failed (status ${status ?? "unknown"})`,
        )
      }
      return (res.data.logs ?? []).map((entry) => ({
        ts: entry.timestamp ?? new Date().toISOString(),
        level: normalizeLogLevel(entry.level),
        event: "sandbox",
        message: entry.message ?? "",
      }))
    },
    async writeFile(id: string, path: string, content: Uint8Array): Promise<WriteReceipt> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      await sandbox.files.write(path, content)
      const { createHash } = await import("node:crypto")
      return { path, size: content.byteLength, sha256: `sha256:${createHash("sha256").update(content).digest("hex")}` }
    },
    async readFile(id: string, path: string): Promise<Uint8Array> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      const text = await sandbox.files.read(path, opts)
      return new TextEncoder().encode(text)
    },
    async listFiles(id: string, path: string): Promise<FileEntry[]> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      const entries = await sandbox.files.list(path, opts)
      return entries.map((entry) => ({
        path: entry.path ?? `${path}/${entry.name}`,
        type: entry.type === "dir" ? "dir" : "file",
        size: entry.size ?? null,
      }))
    },
    async exposePort(id: string, port: number): Promise<ExposedPort> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      const host = sandbox.getHost(port)
      return { port, url: host.startsWith("http") ? host : `https://${host}` }
    },
    /**
     * E2B has no port-enumeration API: every sandbox port is reachable on demand
     * via getHost()/expose-port, so the provider keeps no server-side list of
     * "exposed" ports to return. We surface a clear typed unsupported result
     * instead of a misleading empty list.
     */
    async listExposedPorts(_id: string): Promise<ExposedPort[]> {
      throw new LiveProviderUnavailableError(
        "e2b does not expose a port-enumeration API; use expose-port to obtain a URL for a specific port (every sandbox port is reachable on demand via getHost)",
      )
    },
    async snapshot(id: string): Promise<SnapshotRecord> {
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      if (sandbox.createSnapshot === undefined) {
        throw new LiveProviderUnavailableError("e2b SDK build does not expose createSnapshot()")
      }
      const snap = await sandbox.createSnapshot(opts)
      return {
        id: snap.snapshotId ?? snap.id ?? `snap_${id}`,
        sandbox_id: id,
        created_at: new Date().toISOString(),
        ref: snap.snapshotId ?? snap.id ?? "",
      }
    },
    async close(): Promise<void> {},
  }
}
