/**
 * Local, hermetic sandbox backend — a persistent in-process *simulator*, not a
 * real cloud provider. It is the default provider for offline development and
 * the target for the CLI/MCP hermetic test suite. State is persisted as JSON
 * under a home directory so lifecycle survives across separate CLI invocations.
 *
 * File and exec operations are routed through the managed-adapter guest-broker
 * framing (see ./ceremony) so the same request-integrity contract used by the
 * live adapters is exercised here. Command execution is a deterministic
 * simulation over the in-memory workspace; it never spawns host processes.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  LocalGuestBrokerAuthenticator,
  buildExecSpec,
  roundTripBrokerRequest,
  sha256Digest,
  toWorkspacePath,
} from "./ceremony"
import type { BrokerBinding } from "./ceremony"
import {
  type CreateOptions,
  type ExecOptions,
  type ExecResult,
  type ExposedPort,
  type FileEntry,
  type LogEntry,
  type SandboxBackend,
  SandboxNotFoundError,
  type SandboxRecord,
  type SnapshotRecord,
  type WriteReceipt,
} from "./types"
import type { WorkspacePath } from "../adapters/managed/index"

interface Persisted {
  record: SandboxRecord
  files: Record<string, string>
  fileRevisions: Record<string, number>
  logs: LogEntry[]
  ports: ExposedPort[]
  snapshots: SnapshotRecord[]
}

const ID_PREFIX = "sbx_local_"

export function defaultSandboxesHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SANDBOXES_HOME
  if (explicit !== undefined && explicit.length > 0) return explicit
  const home = env.HOME ?? env.USERPROFILE ?? "/tmp"
  return join(home, ".hasna", "sandboxes")
}

export class LocalSandboxBackend implements SandboxBackend {
  readonly provider = "local" as const
  readonly #dir: string
  readonly #authenticator = new LocalGuestBrokerAuthenticator("local-broker-key-v1")
  #epoch = 1n

  constructor(home: string) {
    this.#dir = join(home, "instances")
    mkdirSync(this.#dir, { recursive: true })
  }

  #path(id: string): string {
    return join(this.#dir, `${encodeURIComponent(id)}.json`)
  }

  #load(id: string): Persisted {
    const path = this.#path(id)
    if (!existsSync(path)) throw new SandboxNotFoundError(id)
    return JSON.parse(readFileSync(path, "utf8")) as Persisted
  }

  #save(state: Persisted): void {
    writeFileSync(this.#path(state.record.id), `${JSON.stringify(state, null, 2)}\n`)
  }

  #binding(id: string): BrokerBinding {
    this.#epoch += 1n
    return {
      resourceId: id,
      immutableFingerprintSha256: sha256Digest(`${id}:fingerprint`),
      creationTokenSha256: sha256Digest(`${id}:creation`),
      sessionBindingSha256: sha256Digest(`${id}:session`),
      epoch: this.#epoch,
    }
  }

  #log(state: Persisted, level: LogEntry["level"], event: string, message: string): void {
    state.logs.push({ ts: new Date().toISOString(), level, event, message })
  }

  async create(options: CreateOptions): Promise<SandboxRecord> {
    const id = `${ID_PREFIX}${randomUUID().replace(/-/gu, "").slice(0, 20)}`
    const now = new Date().toISOString()
    const record: SandboxRecord = {
      id,
      provider: "local",
      status: "running",
      created_at: now,
      template: options.template ?? null,
      metadata: options.metadata ?? {},
      labels: {},
      expires_at:
        options.timeout_ms === undefined ? null : new Date(Date.now() + options.timeout_ms).toISOString(),
    }
    const state: Persisted = { record, files: {}, fileRevisions: {}, logs: [], ports: [], snapshots: [] }
    this.#log(state, "info", "create", `created local sandbox ${id}`)
    this.#save(state)
    return record
  }

  async list(): Promise<SandboxRecord[]> {
    if (!existsSync(this.#dir)) return []
    const records: SandboxRecord[] = []
    for (const file of readdirSync(this.#dir)) {
      if (!file.endsWith(".json")) continue
      try {
        const state = JSON.parse(readFileSync(join(this.#dir, file), "utf8")) as Persisted
        records.push(state.record)
      } catch {
        // skip corrupt entries
      }
    }
    records.sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    return records
  }

  async get(id: string): Promise<SandboxRecord> {
    return this.#load(id).record
  }

  async destroy(id: string): Promise<void> {
    const path = this.#path(id)
    if (!existsSync(path)) throw new SandboxNotFoundError(id)
    rmSync(path)
  }

  async stop(id: string): Promise<SandboxRecord> {
    const state = this.#load(id)
    state.record.status = "stopped"
    this.#log(state, "info", "stop", `stopped sandbox ${id}`)
    this.#save(state)
    return state.record
  }

  async keepAlive(id: string, timeoutMs: number): Promise<SandboxRecord> {
    const state = this.#load(id)
    state.record.expires_at = new Date(Date.now() + timeoutMs).toISOString()
    this.#log(state, "info", "keep_alive", `extended sandbox ${id} by ${timeoutMs}ms`)
    this.#save(state)
    return state.record
  }

  async exec(id: string, argv: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const state = this.#load(id)
    if (state.record.status !== "running") {
      throw new SandboxNotFoundError(`${id} (not running)`)
    }
    const spec = buildExecSpec(argv, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.timeout_ms === undefined ? {} : { wallTimeoutMs: options.timeout_ms }),
    })
    // Route through the managed guest-broker framing contract.
    const decoded = roundTripBrokerRequest(this.#binding(id), { operation: "exec_start", spec }, this.#authenticator)
    if (decoded.operation !== "exec_start") throw new Error("broker framing returned wrong operation")
    const sessionId = `sess_${randomUUID().replace(/-/gu, "").slice(0, 16)}`
    const result = simulateExec(decoded.spec.argv, options.cwd ?? "/workspace", state.files)
    this.#log(
      state,
      result.exit_code === 0 ? "info" : "warn",
      "exec",
      `exec ${JSON.stringify(argv)} -> exit ${result.exit_code}`,
    )
    this.#save(state)
    return { session_id: sessionId, finished: true, ...result }
  }

  async getLogs(id: string): Promise<LogEntry[]> {
    return this.#load(id).logs
  }

  async writeFile(id: string, path: string, content: Uint8Array): Promise<WriteReceipt> {
    const state = this.#load(id)
    const wsPath = toWorkspacePath(path)
    const decoded = roundTripBrokerRequest(
      this.#binding(id),
      { operation: "file_write", request: { path: wsPath, bytes: content } },
      this.#authenticator,
    )
    if (decoded.operation !== "file_write") throw new Error("broker framing returned wrong operation")
    const bytes = decoded.request.bytes
    state.files[wsPath] = Buffer.from(bytes).toString("base64")
    state.fileRevisions[wsPath] = (state.fileRevisions[wsPath] ?? 0) + 1
    this.#log(state, "info", "write_file", `wrote ${bytes.byteLength} bytes to ${wsPath}`)
    this.#save(state)
    return { path: wsPath, size: bytes.byteLength, sha256: sha256Digest(bytes) }
  }

  async readFile(id: string, path: string): Promise<Uint8Array> {
    const state = this.#load(id)
    const wsPath = toWorkspacePath(path)
    const stored = state.files[wsPath]
    if (stored === undefined) throw new SandboxNotFoundError(`file ${wsPath} in ${id}`)
    const bytes = Buffer.from(stored, "base64")
    const decoded = roundTripBrokerRequest(
      this.#binding(id),
      { operation: "file_read", request: { path: wsPath, offset: 0, length: bytes.byteLength } },
      this.#authenticator,
    )
    if (decoded.operation !== "file_read") throw new Error("broker framing returned wrong operation")
    return new Uint8Array(bytes)
  }

  async listFiles(id: string, path: string): Promise<FileEntry[]> {
    const state = this.#load(id)
    const wsPath = toWorkspacePath(path)
    const decoded = roundTripBrokerRequest(
      this.#binding(id),
      { operation: "file_list", request: { path: wsPath, limit: 1000 } },
      this.#authenticator,
    )
    if (decoded.operation !== "file_list") throw new Error("broker framing returned wrong operation")
    const prefix = wsPath === "/workspace" ? "/workspace" : wsPath
    const dirs = new Set<string>()
    const files: FileEntry[] = []
    for (const [filePath, b64] of Object.entries(state.files)) {
      if (filePath !== prefix && !filePath.startsWith(`${prefix}/`)) continue
      const remainder = filePath === prefix ? filePath : filePath.slice(prefix.length + 1)
      const slash = remainder.indexOf("/")
      if (slash === -1) {
        files.push({ path: filePath, type: "file", size: Buffer.from(b64, "base64").byteLength })
      } else {
        dirs.add(`${prefix}/${remainder.slice(0, slash)}`)
      }
    }
    const dirEntries: FileEntry[] = [...dirs].map((d) => ({ path: d, type: "dir", size: null }))
    return [...dirEntries, ...files].sort((a, b) => (a.path < b.path ? -1 : 1))
  }

  async exposePort(id: string, port: number): Promise<ExposedPort> {
    const state = this.#load(id)
    const existing = state.ports.find((p) => p.port === port)
    if (existing !== undefined) return existing
    const url = `https://${port}-${id}.local.sandboxes.invalid`
    const entry: ExposedPort = { port, url }
    state.ports.push(entry)
    this.#log(state, "info", "expose_port", `exposed port ${port} -> ${url}`)
    this.#save(state)
    return entry
  }

  async listExposedPorts(id: string): Promise<ExposedPort[]> {
    return this.#load(id).ports
  }

  async snapshot(id: string): Promise<SnapshotRecord> {
    const state = this.#load(id)
    const filesFingerprint = sha256Digest(JSON.stringify(state.files))
    const snap: SnapshotRecord = {
      id: `snap_${randomUUID().replace(/-/gu, "").slice(0, 16)}`,
      sandbox_id: id,
      created_at: new Date().toISOString(),
      ref: filesFingerprint,
    }
    state.snapshots.push(snap)
    this.#log(state, "info", "snapshot", `captured snapshot ${snap.id}`)
    this.#save(state)
    return snap
  }

  async close(): Promise<void> {
    // no-op: local state is flushed synchronously on every mutation
  }
}

/**
 * Deterministic, side-effect-free command simulation over the in-memory
 * workspace. Supports the small set of commands the CLI/MCP smoke paths rely on.
 * Unknown commands succeed with a clearly labeled simulated line.
 */
function simulateExec(
  argv: string[],
  cwd: string,
  files: Record<string, string>,
): { exit_code: number; stdout: string; stderr: string } {
  const [cmdRaw, ...args] = argv
  const cmd = (cmdRaw ?? "").split("/").pop() ?? ""
  const readWorkspaceFile = (p: string): string | undefined => {
    const key = toWorkspacePath(p) as WorkspacePath
    const stored = files[key]
    return stored === undefined ? undefined : Buffer.from(stored, "base64").toString("utf8")
  }
  switch (cmd) {
    case "true":
      return { exit_code: 0, stdout: "", stderr: "" }
    case "false":
      return { exit_code: 1, stdout: "", stderr: "" }
    case "echo":
      return { exit_code: 0, stdout: `${args.join(" ")}\n`, stderr: "" }
    case "pwd":
      return { exit_code: 0, stdout: `${toWorkspacePath(cwd)}\n`, stderr: "" }
    case "cat": {
      const out: string[] = []
      for (const arg of args) {
        const content = readWorkspaceFile(arg)
        if (content === undefined) {
          return { exit_code: 1, stdout: out.join(""), stderr: `cat: ${arg}: No such file\n` }
        }
        out.push(content)
      }
      return { exit_code: 0, stdout: out.join(""), stderr: "" }
    }
    case "ls": {
      const base = args[0] ?? "/workspace"
      const prefix = toWorkspacePath(base)
      const names = Object.keys(files)
        .filter((p) => p === prefix || p.startsWith(`${prefix}/`))
        .map((p) => (p === prefix ? p : p.slice(prefix.length + 1).split("/")[0] ?? ""))
      const unique = [...new Set(names)].filter((n) => n.length > 0).sort()
      return { exit_code: 0, stdout: unique.length > 0 ? `${unique.join("\n")}\n` : "", stderr: "" }
    }
    case "sh":
    case "bash": {
      const dashC = args.indexOf("-c")
      if (dashC !== -1 && args[dashC + 1] !== undefined) {
        const script = args[dashC + 1] as string
        const tokens = script.trim().split(/\s+/u)
        return simulateExec(tokens, cwd, files)
      }
      return { exit_code: 0, stdout: "", stderr: "" }
    }
    default:
      return { exit_code: 0, stdout: `[local-sim] executed: ${argv.join(" ")}\n`, stderr: "" }
  }
}
