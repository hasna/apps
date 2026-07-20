/**
 * Live E2B backend built on the official `e2b` SDK (pinned 2.31.0). The SDK is
 * imported lazily so the CLI/MCP stay usable offline and the hermetic test
 * suite never loads it. The API key is supplied by ./resolve from the
 * environment or the `secrets` vault and is passed straight to the SDK — it is
 * never logged or persisted here.
 *
 * NOTE: This path requires a real E2B_API_KEY and network access; it is not
 * exercised by the hermetic suite. Behaviour is mapped to the documented E2B
 * high-level API but should be smoke-tested against a live account before relying
 * on it in production.
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

export interface E2bBackendConfig {
  apiKey: string
}

async function loadSandbox(): Promise<E2bStatic> {
  try {
    const mod = (await import("e2b")) as unknown as { Sandbox: E2bStatic }
    return mod.Sandbox
  } catch (cause) {
    throw new LiveProviderUnavailableError(`failed to load the e2b SDK: ${String(cause)}`)
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
      const Sandbox = await loadSandbox()
      const sandbox = await Sandbox.connect(id, opts)
      const result = await sandbox.commands.run(shellJoin(argv), {
        ...opts,
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { envs: options.env }),
        ...(options.timeout_ms === undefined ? {} : { timeoutMs: options.timeout_ms }),
      })
      return {
        session_id: `${id}:cmd`,
        exit_code: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        finished: true,
      }
    },
    async getLogs(_id: string): Promise<LogEntry[]> {
      return []
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
    async listExposedPorts(_id: string): Promise<ExposedPort[]> {
      return []
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
