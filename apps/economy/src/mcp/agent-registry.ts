/**
 * @hasna/economy — local agent-lifecycle registry (inlined from @hasna/agent-registry)
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * Self-contained implementation of the fleet-standard agent-lifecycle MCP
 * tools — `register_agent` / `heartbeat` / `set_focus` / `list_agents` —
 * previously provided by the `@hasna/agent-registry` npm package. That package
 * was deleted entirely (owner directive 2026-09-03, hasna/apps#1529); this
 * module keeps the same tool names and schemas. Persistence follows the
 * client's storage lane: under the explicit local opt-in
 * (`HASNA_ECONOMY_LOCAL=1`) the registry is a dedicated `agent-registry.db`
 * beside economy's own store (survives restarts, shared by every MCP process
 * on the box); a HOSTED client keeps it in memory, because a hosted station
 * never writes a SQLite file under the app home (hasna/apps#1720). An explicit
 * `HASNA_AGENT_REGISTRY_DB_PATH` names a file in either lane.
 *
 * The original implementation was built on the retired cloud storage kit; this
 * port uses bun:sqlite directly with the same table shape, active window
 * (30 min), conflict semantics, and optional event emission.
 */
import { Database } from 'bun:sqlite'
import { dirname, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { z } from 'zod'
import { getDataDir } from '../db/database.js'
import { economyCloudStorage } from '../lib/cloud-storage.js'

/**
 * Structural subset of @hasna/events' EventsClient that the registry emits
 * lifecycle events through. Kept identical to the deleted package's
 * `AgentEventsClient`.
 */
export interface AgentEventsClient {
  emit(input: {
    source: string
    type: string
    subject?: string
    severity?: 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical'
    data?: Record<string, unknown>
    message?: string
  }): Promise<unknown> | unknown
}

const SERVICE_NAME = 'agent-registry'
const DEFAULT_ACTIVE_WINDOW_MS = 30 * 60 * 1000

export interface Agent {
  id: string
  name: string
  session_id: string | null
  role: string
  status: string
  active_project_id: string | null
  working_dir: string | null
  machine_id: string | null
  capabilities: string[]
  metadata: Record<string, unknown>
  last_seen_at: string
  created_at: string
}

interface SqlLike {
  get(sql: string, ...params: unknown[]): Record<string, unknown> | null
  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>>
  run(sql: string, ...params: unknown[]): { changes: number }
  exec(sql: string): void
}

function envVar(suffix: string): string | undefined {
  return (
    process.env[`HASNA_AGENT_REGISTRY_${suffix}`] ??
    process.env[`HASNA_AGENT_${suffix}`]
  )
}

function getActiveWindowMs(): number {
  const env = envVar('TIMEOUT_MS')
  if (env) {
    const parsed = Number.parseInt(env, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_ACTIVE_WINDOW_MS
}

function envSessionId(): string | null {
  return envVar('SESSION_ID') ?? null
}

/** bun:sqlite's in-memory database: no file, process-local. */
export const MEMORY_REGISTRY_PATH = ':memory:'

/**
 * Where the registry lives. An explicit `HASNA_AGENT_REGISTRY_DB_PATH` always
 * wins. Otherwise the storage seam decides: a hosted client (a credential
 * resolved through the @hasna/contracts chain) gets the in-memory registry —
 * the app home stays free of SQLite files in hosted mode — and only the
 * explicit local opt-in persists `agent-registry.db` beside economy's store.
 * With neither, the seam throws its fail-closed error (the same one the
 * server's own store raised at startup).
 */
export function resolveRegistryDbPath(): string {
  const explicit = process.env.HASNA_AGENT_REGISTRY_DB_PATH
  if (explicit && explicit.trim()) return explicit
  if (economyCloudStorage().active) return MEMORY_REGISTRY_PATH
  return join(getDataDir(), 'agent-registry.db')
}

let defaultDb: RegistryDb | null = null;

/**
 * Minimal bun:sqlite wrapper exposing the get/all/run/exec surface the
 * registry uses. `Database` itself only has run/exec/query/prepare on bun
 * 1.3.x — the deleted package got get/all from the storage kit's own sqlite
 * wrapper; this keeps the same call shape without the kit.
 */
class RegistryDb implements SqlLike {
  private db: Database;

  constructor(path: string) {
    if (path !== MEMORY_REGISTRY_PATH && dirname(path) && !existsSync(dirname(path))) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    }
    this.db = new Database(path);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 10000");
  }

  get(sql: string, ...params: unknown[]): Record<string, unknown> | null {
    return this.db.prepare(sql).get(...(params as any[])) as Record<string, unknown> | null;
  }

  all(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
    return this.db.prepare(sql).all(...(params as any[])) as Array<Record<string, unknown>>;
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    return this.db.prepare(sql).run(...(params as any[]));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

function getDefaultStore(): SqlLike {
  if (!defaultDb) {
    defaultDb = new RegistryDb(resolveRegistryDbPath());
    ensureAgentsTable(defaultDb);
  }
  return defaultDb;
}

export function resetDefaultStoreForTests(): void {
  try {
    defaultDb?.close();
  } catch {
    // Best-effort close only.
  }
  defaultDb = null;
}

const AGENTS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS agents (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  session_id        TEXT,
  role              TEXT NOT NULL DEFAULT 'agent',
  status            TEXT NOT NULL DEFAULT 'active',
  active_project_id TEXT,
  working_dir       TEXT,
  machine_id        TEXT,
  capabilities      TEXT NOT NULL DEFAULT '[]',
  metadata          TEXT NOT NULL DEFAULT '{}',
  last_seen_at      TEXT NOT NULL,
  created_at        TEXT NOT NULL
)`
const AGENTS_NAME_INDEX_SQL = `CREATE INDEX IF NOT EXISTS agents_name_idx ON agents(name)`

function ensureAgentsTable(db: SqlLike): void {
  db.exec(AGENTS_TABLE_SQL)
  db.exec(AGENTS_NAME_INDEX_SQL)
}

function newAgentId(): string {
  return `ag_${crypto.randomUUID().slice(0, 8)}`
}

function now(): string {
  return new Date().toISOString()
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    session_id: (row.session_id as string | null) ?? null,
    role: (row.role as string | null) ?? 'agent',
    status: (row.status as string | null) ?? 'active',
    active_project_id: (row.active_project_id as string | null) ?? null,
    working_dir: (row.working_dir as string | null) ?? null,
    machine_id: (row.machine_id as string | null) ?? null,
    capabilities: safeParseArray(row.capabilities),
    metadata: safeParseObject(row.metadata),
    last_seen_at: String(row.last_seen_at),
    created_at: String(row.created_at),
  }
}

function safeParseArray(value: unknown): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(String(value))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function safeParseObject(value: unknown): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function isActiveAt(lastSeenAt: string, windowMs: number): boolean {
  return Date.now() - new Date(lastSeenAt).getTime() < windowMs
}

function isAgentConflict(result: unknown): result is ConflictDescriptor {
  return Boolean(result) && (result as { conflict?: boolean }).conflict === true
}

function getAgent(id: string, db: SqlLike): Agent | null {
  const row = db.get('SELECT * FROM agents WHERE id = ?', id)
  return row ? rowToAgent(row) : null
}

function getAgentByName(name: string, db: SqlLike): Agent | null {
  const row = db.get(
    "SELECT * FROM agents WHERE name = ? AND status = 'active' ORDER BY last_seen_at DESC LIMIT 1",
    normalizeName(name),
  )
  return row ? rowToAgent(row) : null
}

function resolveAgent(idOrName: string | null | undefined, db: SqlLike): Agent | null {
  const key = (idOrName ?? envSessionId()) as string | undefined
  if (!key) return null
  return getAgentByName(key, db) ?? getAgent(key, db)
}

function listAgents(
  opts: { include_archived?: boolean; online_only?: boolean } = {},
  db: SqlLike,
): Agent[] {
  const includeArchived = opts.include_archived ?? false
  const where = includeArchived ? '' : "WHERE status = 'active'"
  const rows = db.all(`SELECT * FROM agents ${where} ORDER BY name`)
  let agents = rows.map(rowToAgent)
  if (opts.online_only) {
    const windowMs = getActiveWindowMs()
    agents = agents.filter(
      (a) => a.status === 'active' && isActiveAt(a.last_seen_at, windowMs),
    )
  }
  return agents
}

interface RegisterInput {
  name: string
  session_id?: string
  role?: string
  working_dir?: string
  project_id?: string
  machine_id?: string
  capabilities?: string[]
  metadata?: Record<string, unknown>
  force?: boolean
}

interface ConflictDescriptor {
  conflict: true
  existing_id: string
  existing_name: string
  last_seen_at: string
  session_hint: string | null
  working_dir: string | null
  message: string
}

function registerAgent(input: RegisterInput, db: SqlLike): Agent | ConflictDescriptor {
  const name = normalizeName(input.name)
  if (!name) {
    throw new Error('register_agent: name is required')
  }
  const sessionId = input.session_id ?? envSessionId() ?? null
  const windowMs = getActiveWindowMs()
  const existing = getAgentByName(name, db)
  if (existing) {
    const active = isActiveAt(existing.last_seen_at, windowMs)
    const sameSession =
      Boolean(sessionId) && Boolean(existing.session_id) && sessionId === existing.session_id
    const differentSession =
      Boolean(sessionId) && Boolean(existing.session_id) && sessionId !== existing.session_id
    const callerHasNoSession = !sessionId
    const existingHasActiveSession = Boolean(existing.session_id) && active
    if (!input.force) {
      if (active && differentSession) return buildConflict(existing)
      if (callerHasNoSession && existingHasActiveSession)
        return buildConflict(existing)
    }
    const sets = ['last_seen_at = ?']
    const params: unknown[] = [now()]
    if (sessionId && !sameSession) {
      sets.push('session_id = ?')
      params.push(sessionId)
    }
    if (input.role !== undefined) {
      sets.push('role = ?')
      params.push(input.role)
    }
    if (input.working_dir !== undefined) {
      sets.push('working_dir = ?')
      params.push(input.working_dir)
    }
    if (input.machine_id !== undefined) {
      sets.push('machine_id = ?')
      params.push(input.machine_id)
    }
    if (input.project_id !== undefined) {
      sets.push('active_project_id = ?')
      params.push(input.project_id)
    }
    if (input.capabilities !== undefined) {
      sets.push('capabilities = ?')
      params.push(JSON.stringify(input.capabilities))
    }
    if (input.metadata !== undefined) {
      sets.push('metadata = ?')
      params.push(JSON.stringify(input.metadata))
    }
    sets.push("status = 'active'")
    params.push(existing.id)
    db.run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, ...params)
    return getAgent(existing.id, db)!
  }
  const id = newAgentId()
  const ts = now()
  db.run(
    `INSERT INTO agents
       (id, name, session_id, role, status, active_project_id, working_dir, machine_id, capabilities, metadata, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    sessionId,
    input.role ?? 'agent',
    input.project_id ?? null,
    input.working_dir ?? null,
    input.machine_id ?? null,
    JSON.stringify(input.capabilities ?? []),
    JSON.stringify(input.metadata ?? {}),
    ts,
    ts,
  )
  return getAgent(id, db)!
}

function buildConflict(existing: Agent): ConflictDescriptor {
  const minutesAgo = Math.round(
    (Date.now() - new Date(existing.last_seen_at).getTime()) / 60000,
  )
  return {
    conflict: true,
    existing_id: existing.id,
    existing_name: existing.name,
    last_seen_at: existing.last_seen_at,
    session_hint: existing.session_id ? existing.session_id.slice(0, 8) : null,
    working_dir: existing.working_dir,
    message:
      `Agent "${existing.name}" is already active (last seen ${minutesAgo}m ago). ` +
      (existing.session_id
        ? `Pass session_id="${existing.session_id}" to reclaim it, `
        : '') +
      'use force:true to take over, or choose a different name.',
  }
}

function heartbeat(idOrName: string | null | undefined, db: SqlLike): Agent | null {
  const agent = resolveAgent(idOrName, db)
  if (!agent) return null
  db.run('UPDATE agents SET last_seen_at = ? WHERE id = ?', now(), agent.id)
  return getAgent(agent.id, db)
}

function setFocus(
  idOrName: string | null | undefined,
  projectId: string | null,
  db: SqlLike,
): Agent | null {
  const agent = resolveAgent(idOrName, db)
  if (!agent) return null
  db.run(
    'UPDATE agents SET active_project_id = ?, last_seen_at = ? WHERE id = ?',
    projectId,
    now(),
    agent.id,
  )
  return getAgent(agent.id, db)
}

// --- event emission (mirrors the deleted package's events.ts) ---

function agentData(agent: Agent): Record<string, unknown> {
  return {
    agent_id: agent.id,
    session_id: agent.session_id,
    project_id: agent.active_project_id,
    machine_id: agent.machine_id,
    role: agent.role,
  }
}

export async function emitAgentEvent(
  client: AgentEventsClient | undefined,
  type: string,
  agent: Agent,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!client) return
  try {
    await client.emit({
      source: SERVICE_NAME,
      type,
      subject: agent.name,
      severity: type === 'agent.heartbeat' ? 'debug' : 'info',
      data: { ...agentData(agent), ...extra },
    })
  } catch {
    // Registry telemetry must never affect MCP tool behavior.
  }
}

export async function emitConflictEvent(
  client: AgentEventsClient | undefined,
  conflict: ConflictDescriptor,
): Promise<void> {
  if (!client) return
  try {
    await client.emit({
      source: SERVICE_NAME,
      type: 'agent.conflict',
      subject: conflict.existing_name,
      severity: 'warning',
      data: {
        existing_id: conflict.existing_id,
        last_seen_at: conflict.last_seen_at,
        session_hint: conflict.session_hint,
      },
      message: conflict.message,
    })
  } catch {
    // Registry telemetry must never affect MCP tool behavior.
  }
}

// --- MCP tool registration ---

function jsonText(data: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function errorText(message: string): {
  content: Array<{ type: string; text: string }>
  isError: boolean
} {
  return { content: [{ type: 'text', text: message }], isError: true }
}

interface AgentFocus {
  set(agentId: string, value: { project_id: string | null }): void
}

export interface RegisterAgentToolsOptions {
  service?: string
  events?: AgentEventsClient
  db?: SqlLike
  agentFocus?: AgentFocus
  includeExtendedTools?: boolean
  toolFilter?: (name: string) => boolean
}

/**
 * Register the fleet-standard agent-lifecycle tools on an MCP server.
 * `send_feedback` from the deleted package is NOT implemented here — it
 * delegated to the retired cloud storage; consumers ship their own
 * feedback tool (economy's routes through the Store with a category enum).
 */
export function registerAgentTools(
  server: {
    tool: (...args: any[]) => unknown
  },
  opts: RegisterAgentToolsOptions = {},
): void {
  // The store is resolved on FIRST USE, never at registration. buildServer()
  // registers these tools at startup, and resolving the store here opened
  // `agent-registry.db` under the app home before any tool was called — in
  // hosted mode too, where no SQLite file may exist (hasna/apps#1720).
  let resolved: SqlLike | undefined
  const db = (): SqlLike => (resolved ??= opts.db ?? getDefaultStore())
  const events = opts.events
  const focus = opts.agentFocus
  const includeExtended = opts.includeExtendedTools ?? false
  const allow = (name: string) => (opts.toolFilter ? opts.toolFilter(name) : true)
  const tool = (
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: any) => Promise<unknown> | unknown,
  ) => {
    if (!allow(name)) return
    server.tool(name, description, schema, handler)
  }

  tool(
    'register_agent',
    'Register or heartbeat an agent by name. Returns the agent, or a structured conflict descriptor if the name is actively held by another session.',
    {
      name: z.string().describe('Agent name (normalized to lowercase; unique among active agents)'),
      session_id: z.string().optional().describe('Stable session id used to reclaim the name'),
      role: z.string().optional().describe('Agent role (default: agent)'),
      working_dir: z.string().optional().describe('Working directory of the agent'),
      project_id: z.string().optional().describe('Set active project focus on register'),
      capabilities: z.array(z.string()).optional().describe('Declared capabilities'),
      force: z.boolean().optional().describe('Take over the name even if actively held'),
    },
    async (args: RegisterInput) => {
      const result = registerAgent(
        {
          name: args.name,
          session_id: args.session_id,
          role: args.role,
          working_dir: args.working_dir,
          project_id: args.project_id,
          capabilities: args.capabilities,
          force: args.force,
        },
        db(),
      )
      if (isAgentConflict(result)) {
        await emitConflictEvent(events, result)
        return { ...jsonText(result), isError: true }
      }
      await emitAgentEvent(events, 'agent.registered', result)
      return jsonText(result)
    },
  )

  tool(
    'heartbeat',
    "Update an agent's last_seen_at to signal it is still active.",
    {
      agent_id: z.string().optional().describe('Agent id'),
      name: z.string().optional().describe('Agent name (alternative to agent_id)'),
    },
    async (args: { agent_id?: string; name?: string }) => {
      const agent = heartbeat(args.agent_id ?? args.name, db())
      if (!agent)
        return errorText(`Agent not found: ${args.agent_id ?? args.name ?? '(none)'}`)
      await emitAgentEvent(events, 'agent.heartbeat', agent)
      return jsonText(agent)
    },
  )

  tool(
    'set_focus',
    'Set (or clear) the active project context for an agent. Omit project_id to clear.',
    {
      agent_id: z.string().optional().describe('Agent id'),
      name: z.string().optional().describe('Agent name (alternative to agent_id)'),
      project_id: z.string().optional().describe('Project id to focus on; omit to clear'),
    },
    async (args: { agent_id?: string; name?: string; project_id?: string }) => {
      const projectId = args.project_id ?? null
      const agent = setFocus(args.agent_id ?? args.name, projectId, db())
      if (!agent)
        return errorText(`Agent not found: ${args.agent_id ?? args.name ?? '(none)'}`)
      focus?.set(agent.id, { project_id: projectId })
      await emitAgentEvent(events, 'agent.focus_changed', agent, { project_id: projectId })
      return jsonText(agent)
    },
  )

  tool(
    'list_agents',
    'List registered agents.',
    {
      online_only: z.boolean().optional().describe('Only agents seen within the active window'),
      include_archived: z.boolean().optional().describe('Include archived agents'),
    },
    async (args: { online_only?: boolean; include_archived?: boolean }) => {
      const agents = listAgents(
        { online_only: args.online_only, include_archived: args.include_archived },
        db(),
      )
      return jsonText(agents)
    },
  )

  if (includeExtended) {
    tool(
      'get_focus',
      'Get the active project context for an agent.',
      {
        agent_id: z.string().optional(),
        name: z.string().optional(),
      },
      async (args: { agent_id?: string; name?: string }) => {
        const agent = resolveAgent(args.agent_id ?? args.name, db())
        if (!agent)
          return errorText(`Agent not found: ${args.agent_id ?? args.name ?? '(none)'}`)
        return jsonText({ agent_id: agent.id, project_id: agent.active_project_id })
      },
    )

    tool(
      'unfocus',
      'Clear the active project context for an agent.',
      {
        agent_id: z.string().optional(),
        name: z.string().optional(),
      },
      async (args: { agent_id?: string; name?: string }) => {
        const agent = setFocus(args.agent_id ?? args.name, null, db())
        if (!agent)
          return errorText(`Agent not found: ${args.agent_id ?? args.name ?? '(none)'}`)
        focus?.set(agent.id, { project_id: null })
        await emitAgentEvent(events, 'agent.focus_changed', agent, { project_id: null })
        return jsonText(agent)
      },
    )
  }
}