/**
 * Session Registry — shared registry of active Claude Code sessions.
 * Designed to be reusable across the open-* ecosystem (mementos, todos, conversations).
 *
 * Each MCP server registers on connect, heartbeats, and can query peers.
 * PID identifies the Claude Code process — all MCPs in same session share a PID.
 *
 * WHERE IT LIVES, AND WHEN (fleet fail-closed wave, 2026-09-11). Until this
 * revision the registry was an ungated SQLite file at the HOME ROOT
 * (`~/.open-sessions-registry.db`), created by the first `registerSession`
 * call — i.e. by every `mementos-mcp` start, including a hosted one that had
 * just refused to open the memory store (T1 §3.5 mementos). Two rules broke
 * at once: "no local fleet SQLite on any station" and "an app's files live
 * under ~/.hasna/<app>". Now:
 *
 *   - The registry is an on-box SQLite file ONLY when this process is allowed
 *     to have an on-box store at all: the explicit local opt-in
 *     (`HASNA_MEMENTOS_LOCAL=1` / `HASNA_MEMENTOS_DB_PATH`, see
 *     `selectsMementosLocalStore`) or the server context (`mementos-serve`).
 *     It then lives NEXT TO the memory store — `<dir of the store>/
 *     sessions-registry.db` — never at the home root; a `:memory:` store gets
 *     a `:memory:` registry.
 *   - On the HOSTED route (a credential resolved, no opt-in) the registry is
 *     PROCESS-LOCAL: the same API, backed by an in-process map, so the
 *     auto-inject orchestrator and the channel pusher keep working for this
 *     server's own session, and nothing is read from or written to disk.
 *     Cross-process peer discovery is a local-store feature; it does not
 *     exist on a hosted station and must not invent a file to fake it.
 */

import { SqliteAdapter as Database, isServerContext } from "../storage.js";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDbPath } from "./config.js";
import { selectsMementosLocalStore } from "./local-opt-in.js";

// ============================================================================
// Types
// ============================================================================

export interface SessionInfo {
  id: string;
  pid: number;
  cwd: string;
  git_root: string | null;
  agent_name: string | null;
  project_name: string | null;
  tty: string | null;
  mcp_server: string;
  metadata: Record<string, unknown>;
  registered_at: string;
  last_seen_at: string;
}

export interface SessionFilter {
  project_name?: string;
  git_root?: string;
  mcp_server?: string;
  agent_name?: string;
  exclude_pid?: number;
}

// ============================================================================
// Placement
// ============================================================================

/** File name of the registry, placed next to the memory store. */
export const SESSION_REGISTRY_FILE = "sessions-registry.db";

/**
 * Is an on-box registry file permitted for this process? Only under the
 * explicit local opt-in or in the server. Answered from the env dictionary
 * (and the server flag) — no Keychain, no filesystem.
 */
export function sessionRegistryUsesLocalStore(env: Record<string, string | undefined> = process.env): boolean {
  return isServerContext() || selectsMementosLocalStore(env);
}

/**
 * Where the registry file lives when one is permitted: beside the memory
 * store (`getDbPath()`), so a pinned scratch store gets a scratch registry
 * and a `:memory:` store gets a `:memory:` registry. Never the home root.
 */
export function sessionRegistryPath(): string {
  const store = getDbPath();
  if (store === ":memory:") return ":memory:";
  return join(dirname(store), SESSION_REGISTRY_FILE);
}

// ============================================================================
// Database (local opt-in / server only)
// ============================================================================

let _db: Database | null = null;
let _dbPath: string | null = null;

function getDb(): Database {
  const path = sessionRegistryPath();
  if (_db && _dbPath === path) return _db;
  if (_db) {
    _db.close();
    _db = null;
  }

  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  _db = new Database(path);
  _dbPath = path;
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 3000");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      pid INTEGER NOT NULL,
      cwd TEXT NOT NULL,
      git_root TEXT,
      agent_name TEXT,
      project_name TEXT,
      tty TEXT,
      mcp_server TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      registered_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_pid_mcp
      ON sessions(pid, mcp_server);
    CREATE INDEX IF NOT EXISTS idx_sessions_project
      ON sessions(project_name);
    CREATE INDEX IF NOT EXISTS idx_sessions_agent
      ON sessions(agent_name);
    CREATE INDEX IF NOT EXISTS idx_sessions_git_root
      ON sessions(git_root);
  `);

  return _db;
}

// ============================================================================
// Process-local registry (hosted route)
// ============================================================================

/** The hosted-route registry: this process's own sessions, nothing on disk. */
const _memory = new Map<string, SessionInfo>();

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function now(): string {
  return new Date().toISOString();
}

function parseRow(row: Record<string, unknown>): SessionInfo {
  return {
    id: row["id"] as string,
    pid: row["pid"] as number,
    cwd: row["cwd"] as string,
    git_root: (row["git_root"] as string) || null,
    agent_name: (row["agent_name"] as string) || null,
    project_name: (row["project_name"] as string) || null,
    tty: (row["tty"] as string) || null,
    mcp_server: row["mcp_server"] as string,
    metadata: JSON.parse((row["metadata"] as string) || "{}"),
    registered_at: row["registered_at"] as string,
    last_seen_at: row["last_seen_at"] as string,
  };
}

// Check if a process is alive (signal 0 doesn't kill, just checks)
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function matchesFilter(s: SessionInfo, filter?: SessionFilter): boolean {
  if (!filter) return true;
  if (filter.project_name && s.project_name !== filter.project_name) return false;
  if (filter.git_root && s.git_root !== filter.git_root) return false;
  if (filter.mcp_server && s.mcp_server !== filter.mcp_server) return false;
  if (filter.agent_name && s.agent_name !== filter.agent_name) return false;
  if (filter.exclude_pid && s.pid === filter.exclude_pid) return false;
  return true;
}

// ============================================================================
// Registry API
// ============================================================================

export function registerSession(opts: {
  mcp_server: string;
  agent_name?: string;
  project_name?: string;
  cwd?: string;
  git_root?: string;
  tty?: string;
  metadata?: Record<string, unknown>;
}): SessionInfo {
  const pid = process.pid;
  const cwd = opts.cwd || process.cwd();
  const timestamp = now();

  if (!sessionRegistryUsesLocalStore()) {
    // Hosted route: process-local. Same PID + MCP server = same session.
    const existing = [..._memory.values()].find((s) => s.pid === pid && s.mcp_server === opts.mcp_server);
    const record: SessionInfo = {
      id: existing?.id ?? generateId(),
      pid,
      cwd,
      git_root: opts.git_root || null,
      agent_name: opts.agent_name || null,
      project_name: opts.project_name || null,
      tty: opts.tty || null,
      mcp_server: opts.mcp_server,
      metadata: { ...(opts.metadata || {}) },
      registered_at: existing?.registered_at ?? timestamp,
      last_seen_at: timestamp,
    };
    _memory.set(record.id, record);
    return { ...record, metadata: { ...record.metadata } };
  }

  const db = getDb();
  const id = generateId();

  // Upsert — same PID + MCP server = same session
  const existing = db.query(
    "SELECT id FROM sessions WHERE pid = ? AND mcp_server = ?"
  ).get(pid, opts.mcp_server) as { id: string } | null;

  if (existing) {
    db.run(
      `UPDATE sessions SET agent_name = ?, project_name = ?, cwd = ?,
       git_root = ?, tty = ?, metadata = ?, last_seen_at = ? WHERE id = ?`,
      [
        opts.agent_name || null,
        opts.project_name || null,
        cwd,
        opts.git_root || null,
        opts.tty || null,
        JSON.stringify(opts.metadata || {}),
        timestamp,
        existing.id,
      ]
    );
    return getSession(existing.id)!;
  }

  db.run(
    `INSERT INTO sessions (id, pid, cwd, git_root, agent_name, project_name, tty, mcp_server, metadata, registered_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, pid, cwd,
      opts.git_root || null,
      opts.agent_name || null,
      opts.project_name || null,
      opts.tty || null,
      opts.mcp_server,
      JSON.stringify(opts.metadata || {}),
      timestamp, timestamp,
    ]
  );

  return getSession(id)!;
}

export function heartbeatSession(id: string): void {
  if (!sessionRegistryUsesLocalStore()) {
    const s = _memory.get(id);
    if (s) s.last_seen_at = now();
    return;
  }
  const db = getDb();
  db.run("UPDATE sessions SET last_seen_at = ? WHERE id = ?", [now(), id]);
}

export function unregisterSession(id: string): void {
  if (!sessionRegistryUsesLocalStore()) {
    _memory.delete(id);
    return;
  }
  const db = getDb();
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

export function getSession(id: string): SessionInfo | null {
  if (!sessionRegistryUsesLocalStore()) {
    const s = _memory.get(id);
    return s ? { ...s, metadata: { ...s.metadata } } : null;
  }
  const db = getDb();
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseRow(row) : null;
}

export function listSessions(filter?: SessionFilter): SessionInfo[] {
  if (!sessionRegistryUsesLocalStore()) {
    return [..._memory.values()]
      .filter((s) => matchesFilter(s, filter))
      .filter((s) => {
        if (isProcessAlive(s.pid)) return true;
        _memory.delete(s.id);
        return false;
      })
      .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : a.last_seen_at > b.last_seen_at ? -1 : 0))
      .map((s) => ({ ...s, metadata: { ...s.metadata } }));
  }

  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filter?.project_name) {
    conditions.push("project_name = ?");
    params.push(filter.project_name);
  }
  if (filter?.git_root) {
    conditions.push("git_root = ?");
    params.push(filter.git_root);
  }
  if (filter?.mcp_server) {
    conditions.push("mcp_server = ?");
    params.push(filter.mcp_server);
  }
  if (filter?.agent_name) {
    conditions.push("agent_name = ?");
    params.push(filter.agent_name);
  }
  if (filter?.exclude_pid) {
    conditions.push("pid != ?");
    params.push(filter.exclude_pid);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.query(
    `SELECT * FROM sessions ${where} ORDER BY last_seen_at DESC`
  ).all(...params) as Record<string, unknown>[];

  // Filter out dead sessions
  return rows.map(parseRow).filter(s => {
    if (isProcessAlive(s.pid)) return true;
    // Clean up dead session
    db.run("DELETE FROM sessions WHERE id = ?", [s.id]);
    return false;
  });
}

export function getSessionByAgent(agentName: string): SessionInfo | null {
  const sessions = listSessions({ agent_name: agentName });
  return sessions[0] || null;
}

export function getSessionsByProject(projectName: string): SessionInfo[] {
  return listSessions({ project_name: projectName });
}

export function cleanStaleSessions(): number {
  if (!sessionRegistryUsesLocalStore()) {
    let cleaned = 0;
    for (const s of [..._memory.values()]) {
      if (!isProcessAlive(s.pid)) {
        _memory.delete(s.id);
        cleaned++;
      }
    }
    return cleaned;
  }
  const db = getDb();
  const rows = db.query("SELECT id, pid FROM sessions").all() as { id: string; pid: number }[];
  let cleaned = 0;
  for (const row of rows) {
    if (!isProcessAlive(row.pid)) {
      db.run("DELETE FROM sessions WHERE id = ?", [row.id]);
      cleaned++;
    }
  }
  return cleaned;
}

export function updateSessionAgent(mcpServer: string, agentName: string): void {
  const pid = process.pid;
  if (!sessionRegistryUsesLocalStore()) {
    for (const s of _memory.values()) {
      if (s.pid === pid && s.mcp_server === mcpServer) {
        s.agent_name = agentName;
        s.last_seen_at = now();
      }
    }
    return;
  }
  const db = getDb();
  db.run(
    "UPDATE sessions SET agent_name = ?, last_seen_at = ? WHERE pid = ? AND mcp_server = ?",
    [agentName, now(), pid, mcpServer]
  );
}

// ============================================================================
// Cleanup
// ============================================================================

export function closeRegistry(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

/** Drop the process-local registry. Test seam only. */
export function __resetProcessLocalRegistry(): void {
  _memory.clear();
}
