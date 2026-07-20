/**
 * Runtime driver seam shared by the `sandboxes` CLI and the `sandboxes-mcp`
 * server. Every backend (local simulator, live E2B, live Daytona) implements
 * {@link SandboxBackend}; the CLI and MCP layers never talk to a provider SDK
 * directly. All lifecycle shapes below are provider-neutral DTOs.
 */

export type SandboxProvider = "local" | "e2b" | "daytona"

export type SandboxStatus = "running" | "paused" | "stopped"

export interface SandboxRecord {
  id: string
  provider: SandboxProvider
  status: SandboxStatus
  created_at: string
  template: string | null
  metadata: Record<string, string>
  labels: Record<string, string>
  expires_at: string | null
}

export interface ExecResult {
  session_id: string
  exit_code: number
  stdout: string
  stderr: string
  finished: boolean
}

export interface FileEntry {
  path: string
  type: "file" | "dir"
  size: number | null
}

export interface WriteReceipt {
  path: string
  size: number
  sha256: string
}

export interface ExposedPort {
  port: number
  url: string
}

export interface SnapshotRecord {
  id: string
  sandbox_id: string
  created_at: string
  ref: string
}

export interface LogEntry {
  ts: string
  level: "info" | "warn" | "error"
  event: string
  message: string
}

export interface CreateOptions {
  template?: string
  metadata?: Record<string, string>
  timeout_ms?: number
}

export interface ExecOptions {
  cwd?: string
  timeout_ms?: number
  env?: Record<string, string>
  background?: boolean
}

/**
 * Provider-neutral sandbox lifecycle. Implemented by every backend. The CLI and
 * MCP tools are thin adapters over exactly these operations.
 */
export interface SandboxBackend {
  readonly provider: SandboxProvider
  create(options: CreateOptions): Promise<SandboxRecord>
  list(): Promise<SandboxRecord[]>
  get(id: string): Promise<SandboxRecord>
  destroy(id: string): Promise<void>
  stop(id: string): Promise<SandboxRecord>
  keepAlive(id: string, timeoutMs: number): Promise<SandboxRecord>
  exec(id: string, argv: string[], options?: ExecOptions): Promise<ExecResult>
  getLogs(id: string): Promise<LogEntry[]>
  writeFile(id: string, path: string, content: Uint8Array): Promise<WriteReceipt>
  readFile(id: string, path: string): Promise<Uint8Array>
  listFiles(id: string, path: string): Promise<FileEntry[]>
  exposePort(id: string, port: number): Promise<ExposedPort>
  listExposedPorts(id: string): Promise<ExposedPort[]>
  snapshot(id: string): Promise<SnapshotRecord>
  close(): Promise<void>
}

export class SandboxError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = "SandboxError"
    this.code = code
  }
}

export class SandboxNotFoundError extends SandboxError {
  constructor(id: string) {
    super("sandbox_not_found", `sandbox not found: ${id}`)
    this.name = "SandboxNotFoundError"
  }
}

export class MissingCredentialsError extends SandboxError {
  constructor(message: string) {
    super("missing_credentials", message)
    this.name = "MissingCredentialsError"
  }
}

export class LiveProviderUnavailableError extends SandboxError {
  constructor(message: string) {
    super("live_provider_unavailable", message)
    this.name = "LiveProviderUnavailableError"
  }
}
