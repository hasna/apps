/**
 * Live Daytona backend built on the official `@daytona/sdk` (pinned 0.193.0).
 * The SDK is imported lazily so the CLI/MCP stay usable offline and the hermetic
 * suite never loads it. Credentials come from ./resolve (env or `secrets` vault)
 * and are passed straight to the SDK — never logged or persisted here.
 *
 * File IO is performed via the sandbox process (base64 over `executeCommand`) for
 * portability across SDK builds. NOTE: requires a real DAYTONA_API_KEY and
 * network access; not exercised by the hermetic suite — smoke-test against a live
 * account before production use.
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

interface DaytonaExecResponse {
  exitCode: number
  result?: string
  artifacts?: { stdout?: string }
}
interface DaytonaSandbox {
  id: string
  process: { executeCommand(cmd: string, cwd?: string, env?: Record<string, string>, timeout?: number): Promise<DaytonaExecResponse> }
  getPreviewLink(port: number): Promise<{ url: string }>
  delete(timeout?: number): Promise<void>
}
interface DaytonaClient {
  create(params?: Record<string, unknown>, options?: Record<string, unknown>): Promise<DaytonaSandbox>
  get(id: string): Promise<DaytonaSandbox>
  list(query?: Record<string, unknown>): AsyncIterableIterator<DaytonaSandbox>
  start(sandbox: DaytonaSandbox, timeout?: number): Promise<void>
  stop(sandbox: DaytonaSandbox): Promise<void>
  delete(sandbox: DaytonaSandbox, timeout?: number): Promise<void>
}

export interface DaytonaBackendConfig {
  apiKey: string
  apiUrl?: string
}

export function createDaytonaBackend(config: DaytonaBackendConfig): SandboxBackend {
  let clientPromise: Promise<DaytonaClient> | undefined

  const client = async (): Promise<DaytonaClient> => {
    if (clientPromise === undefined) {
      clientPromise = (async () => {
        try {
          const mod = (await import("@daytona/sdk")) as unknown as {
            Daytona: new (cfg: Record<string, unknown>) => DaytonaClient
          }
          return new mod.Daytona({
            apiKey: config.apiKey,
            ...(config.apiUrl === undefined ? {} : { apiUrl: config.apiUrl }),
          })
        } catch (cause) {
          throw new LiveProviderUnavailableError(`failed to load the @daytona/sdk: ${String(cause)}`)
        }
      })()
    }
    return clientPromise
  }

  const record = (sandbox: DaytonaSandbox): SandboxRecord => ({
    id: sandbox.id,
    provider: "daytona",
    status: "running",
    created_at: new Date().toISOString(),
    template: null,
    metadata: {},
    labels: {},
    expires_at: null,
  })

  const run = async (sandbox: DaytonaSandbox, argv: string[], cwd?: string): Promise<DaytonaExecResponse> =>
    sandbox.process.executeCommand(shellJoin(argv), cwd)

  return {
    provider: "daytona",
    async create(options: CreateOptions): Promise<SandboxRecord> {
      const daytona = await client()
      const params: Record<string, unknown> = {}
      if (options.template !== undefined) params.snapshot = options.template
      if (options.metadata !== undefined) params.labels = options.metadata
      const sandbox = await daytona.create(params)
      return record(sandbox)
    },
    async list(): Promise<SandboxRecord[]> {
      const daytona = await client()
      const records: SandboxRecord[] = []
      for await (const sandbox of daytona.list()) records.push(record(sandbox))
      return records
    },
    async get(id: string): Promise<SandboxRecord> {
      const daytona = await client()
      return record(await daytona.get(id))
    },
    async destroy(id: string): Promise<void> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      await daytona.delete(sandbox)
    },
    async stop(id: string): Promise<SandboxRecord> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      await daytona.stop(sandbox)
      return { ...record(sandbox), status: "stopped" }
    },
    async keepAlive(id: string, _timeoutMs: number): Promise<SandboxRecord> {
      return this.get(id)
    },
    async exec(id: string, argv: string[], options: ExecOptions = {}): Promise<ExecResult> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      const response = await sandbox.process.executeCommand(
        shellJoin(argv),
        options.cwd,
        options.env,
        options.timeout_ms === undefined ? undefined : Math.ceil(options.timeout_ms / 1000),
      )
      const stdout = response.artifacts?.stdout ?? response.result ?? ""
      return { session_id: `${id}:cmd`, exit_code: response.exitCode, stdout, stderr: "", finished: true }
    },
    async getLogs(_id: string): Promise<LogEntry[]> {
      return []
    },
    async writeFile(id: string, path: string, content: Uint8Array): Promise<WriteReceipt> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      const b64 = Buffer.from(content).toString("base64")
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."
      await run(sandbox, ["sh", "-c", `mkdir -p ${JSON.stringify(dir)} && printf %s ${b64} | base64 -d > ${JSON.stringify(path)}`])
      const { createHash } = await import("node:crypto")
      return { path, size: content.byteLength, sha256: `sha256:${createHash("sha256").update(content).digest("hex")}` }
    },
    async readFile(id: string, path: string): Promise<Uint8Array> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      const response = await run(sandbox, ["sh", "-c", `base64 -w0 ${JSON.stringify(path)} 2>/dev/null || base64 ${JSON.stringify(path)}`])
      const b64 = (response.artifacts?.stdout ?? response.result ?? "").trim()
      return new Uint8Array(Buffer.from(b64, "base64"))
    },
    async listFiles(id: string, path: string): Promise<FileEntry[]> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      const response = await run(sandbox, ["sh", "-c", `ls -1 ${JSON.stringify(path)}`])
      const out = (response.artifacts?.stdout ?? response.result ?? "").trim()
      if (out.length === 0) return []
      return out.split("\n").map((name) => ({ path: `${path.replace(/\/$/u, "")}/${name}`, type: "file", size: null }))
    },
    async exposePort(id: string, port: number): Promise<ExposedPort> {
      const daytona = await client()
      const sandbox = await daytona.get(id)
      const link = await sandbox.getPreviewLink(port)
      return { port, url: link.url }
    },
    async listExposedPorts(_id: string): Promise<ExposedPort[]> {
      return []
    },
    async snapshot(_id: string): Promise<SnapshotRecord> {
      throw new LiveProviderUnavailableError(
        "daytona filesystem snapshot is not implemented in this build; use provider-native snapshots",
      )
    },
    async close(): Promise<void> {},
  }
}
