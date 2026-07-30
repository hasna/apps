import { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { ensureParentDir, getDbPath } from "./paths.js";

export class SqliteAdapter {
  readonly raw: Database;

  constructor(path: string) {
    this.raw = new Database(path);
    this.raw.exec("PRAGMA busy_timeout = 5000");
  }

  close(): void {
    this.raw.close();
  }
}

let adapter: SqliteAdapter | null = null;

const AGENT_HEARTBEAT_COLUMNS: Array<{ name: string; definition: string }> = [
  { name: "daemon_version", definition: "TEXT" },
  { name: "agent_mode", definition: "TEXT" },
  { name: "platform", definition: "TEXT" },
  { name: "os_version", definition: "TEXT" },
  { name: "os_build", definition: "TEXT" },
  { name: "arch", definition: "TEXT" },
  { name: "uptime_seconds", definition: "INTEGER" },
  { name: "tool_versions_json", definition: "TEXT" },
  { name: "tailscale_json", definition: "TEXT" },
  { name: "storage_sync_status", definition: "TEXT" },
  { name: "storage_sync_last_error", definition: "TEXT" },
  { name: "doctor_summary_json", definition: "TEXT" },
  { name: "private_metadata", definition: "INTEGER NOT NULL DEFAULT 0" },
  { name: "observed_at", definition: "TEXT" },
];

function createTables(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_heartbeats (
      machine_id TEXT NOT NULL,
      pid INTEGER NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      daemon_version TEXT,
      agent_mode TEXT,
      platform TEXT,
      os_version TEXT,
      os_build TEXT,
      arch TEXT,
      uptime_seconds INTEGER,
      tool_versions_json TEXT,
      tailscale_json TEXT,
      storage_sync_status TEXT,
      storage_sync_last_error TEXT,
      doctor_summary_json TEXT,
      private_metadata INTEGER NOT NULL DEFAULT 0,
      observed_at TEXT,
      PRIMARY KEY (machine_id, pid)
    )
  `);
  migrateAgentHeartbeats(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS setup_runs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      status TEXT NOT NULL,
      actions_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS machine_registry (
      id TEXT PRIMARY KEY,
      friendly_name TEXT,
      platform TEXT,
      arch TEXT,
      status TEXT NOT NULL DEFAULT 'unknown',
      labels_json TEXT NOT NULL DEFAULT '{}',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mutation_approval_nonces (
      nonce_sha256 TEXT PRIMARY KEY,
      token_sha256 TEXT NOT NULL,
      surface TEXT NOT NULL,
      operation TEXT NOT NULL,
      caller_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      transport TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS mutation_approval_nonces_expires_at_idx
    ON mutation_approval_nonces (expires_at)
  `);

  // The roster controller deliberately uses SQLite for exclusion. Do not
  // replace this with a pid/flock file: an inherited fd caused the station's
  // previous controller to remain wedged after its parent died.
  db.exec(`
    CREATE TABLE IF NOT EXISTS roster_leases (
      name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roster_entry_state (
      entry_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      failed_attempts_json TEXT NOT NULL DEFAULT '[]',
      first_missing_at INTEGER,
      last_attempt_at INTEGER,
      last_error TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roster_launch_records (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      entry_id TEXT NOT NULL,
      target TEXT NOT NULL,
      attempted_at TEXT NOT NULL,
      outcome TEXT NOT NULL,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS roster_launch_records_entry_idx
    ON roster_launch_records (entry_id, attempted_at DESC);

    CREATE TABLE IF NOT EXISTS roster_gate_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      sampled_at INTEGER NOT NULL,
      swap_used_gb REAL NOT NULL,
      phase TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS roster_runs (
      id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      classification TEXT NOT NULL,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      gate_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      mttr_ms INTEGER
    );
  `);
}

function migrateAgentHeartbeats(db: Database): void {
  const columns = db.query("PRAGMA table_info(agent_heartbeats)").all() as Array<{ name: string }>;
  const existing = new Set(columns.map((column) => column.name));
  for (const column of AGENT_HEARTBEAT_COLUMNS) {
    if (existing.has(column.name)) continue;
    db.exec(`ALTER TABLE agent_heartbeats ADD COLUMN ${column.name} ${column.definition}`);
  }
}

export function getAdapter(path = getDbPath()): SqliteAdapter {
  if (path === ":memory:") {
    const memoryAdapter = new SqliteAdapter(path);
    createTables(memoryAdapter.raw);
    return memoryAdapter;
  }

  if (adapter && adapter.raw.filename !== path) {
    adapter.close();
    adapter = null;
  }

  if (!adapter) {
    ensureParentDir(path);
    adapter = new SqliteAdapter(path);
    adapter.raw.exec("PRAGMA journal_mode = WAL");
    adapter.raw.exec("PRAGMA foreign_keys = ON");
    createTables(adapter.raw);
  }

  return adapter;
}

export function getDb(path = getDbPath()): Database {
  return getAdapter(path).raw;
}

export function closeDb(): void {
  if (adapter) {
    adapter.close();
    adapter = null;
  }
}

export interface HeartbeatUpsertMetadata {
  daemonVersion?: string | null;
  agentMode?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  osBuild?: string | null;
  arch?: string | null;
  uptimeSeconds?: number | null;
  toolVersions?: Record<string, unknown> | null;
  tailscale?: Record<string, unknown> | null;
  storageSyncStatus?: string | null;
  storageSyncLastError?: string | null;
  doctorSummary?: Record<string, unknown> | null;
  privateMetadata?: boolean;
}

export function upsertHeartbeat(
  machineId: string,
  pid = process.pid,
  status: "online" | "offline" = "online",
  metadata: HeartbeatUpsertMetadata = {},
): void {
  const db = getDb();
  db.query(
    `INSERT INTO agent_heartbeats (
       machine_id,
       pid,
       status,
       updated_at,
       daemon_version,
       agent_mode,
       platform,
       os_version,
       os_build,
       arch,
       uptime_seconds,
       tool_versions_json,
       tailscale_json,
	       storage_sync_status,
	       storage_sync_last_error,
	       doctor_summary_json,
	       private_metadata,
	       observed_at
	     )
	     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine_id, pid) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at,
       daemon_version = excluded.daemon_version,
       agent_mode = excluded.agent_mode,
       platform = excluded.platform,
       os_version = excluded.os_version,
       os_build = excluded.os_build,
       arch = excluded.arch,
       uptime_seconds = excluded.uptime_seconds,
       tool_versions_json = excluded.tool_versions_json,
       tailscale_json = excluded.tailscale_json,
	       storage_sync_status = excluded.storage_sync_status,
	       storage_sync_last_error = excluded.storage_sync_last_error,
	       doctor_summary_json = excluded.doctor_summary_json,
	       private_metadata = excluded.private_metadata,
	       observed_at = excluded.observed_at`
  ).run(
    machineId,
    pid,
    status,
    new Date().toISOString(),
    metadata.daemonVersion ?? null,
    metadata.agentMode ?? null,
    metadata.platform ?? null,
    metadata.osVersion ?? null,
    metadata.osBuild ?? null,
    metadata.arch ?? null,
    metadata.uptimeSeconds == null ? null : Math.max(0, Math.floor(metadata.uptimeSeconds)),
    metadata.toolVersions ? JSON.stringify(metadata.toolVersions) : null,
    metadata.tailscale ? JSON.stringify(metadata.tailscale) : null,
    metadata.storageSyncStatus ?? null,
	    metadata.storageSyncLastError ?? null,
	    metadata.doctorSummary ? JSON.stringify(metadata.doctorSummary) : null,
	    metadata.privateMetadata ? 1 : 0,
	    new Date().toISOString(),
	  );
}

export function getLocalMachineId(): string {
  return process.env["HASNA_MACHINES_MACHINE_ID"] || hostname();
}

export interface StoredHeartbeat {
  machine_id: string;
  pid: number;
  status: string;
  updated_at: string;
  daemon_version: string | null;
  agent_mode: string | null;
  platform: string | null;
  os_version: string | null;
  os_build: string | null;
  arch: string | null;
  uptime_seconds: number | null;
  tool_versions_json: string | null;
  tailscale_json: string | null;
  storage_sync_status: string | null;
  storage_sync_last_error: string | null;
  doctor_summary_json: string | null;
  private_metadata: number;
  observed_at: string | null;
}

export interface HeartbeatSnapshot {
  machineId: string;
  pid: number;
  status: "online" | "offline";
  updatedAt: string;
  daemonVersion?: string | null;
  agentMode?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  osBuild?: string | null;
  arch?: string | null;
  uptimeSeconds?: number | null;
  toolVersions?: Record<string, unknown> | null;
  tailscale?: Record<string, unknown> | null;
  storageSyncStatus?: string | null;
  storageSyncLastError?: string | null;
  doctorSummary?: Record<string, unknown> | null;
  privateMetadata?: boolean;
  observedAt?: string | null;
}

export function upsertHeartbeatSnapshot(snapshot: HeartbeatSnapshot): void {
  const observedAt = snapshot.observedAt ?? new Date().toISOString();
  const db = getDb();
  db.query(
    `INSERT INTO agent_heartbeats (
       machine_id,
       pid,
       status,
       updated_at,
       daemon_version,
       agent_mode,
       platform,
       os_version,
       os_build,
       arch,
       uptime_seconds,
       tool_versions_json,
       tailscale_json,
       storage_sync_status,
       storage_sync_last_error,
       doctor_summary_json,
       private_metadata,
       observed_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine_id, pid) DO UPDATE SET
       status = excluded.status,
       updated_at = excluded.updated_at,
       daemon_version = excluded.daemon_version,
       agent_mode = excluded.agent_mode,
       platform = excluded.platform,
       os_version = excluded.os_version,
       os_build = excluded.os_build,
       arch = excluded.arch,
       uptime_seconds = excluded.uptime_seconds,
       tool_versions_json = excluded.tool_versions_json,
       tailscale_json = excluded.tailscale_json,
       storage_sync_status = excluded.storage_sync_status,
       storage_sync_last_error = excluded.storage_sync_last_error,
       doctor_summary_json = excluded.doctor_summary_json,
       private_metadata = excluded.private_metadata,
       observed_at = excluded.observed_at`
  ).run(
    snapshot.machineId,
    snapshot.pid,
    snapshot.status,
    snapshot.updatedAt,
    snapshot.daemonVersion ?? null,
    snapshot.agentMode ?? null,
    snapshot.platform ?? null,
    snapshot.osVersion ?? null,
    snapshot.osBuild ?? null,
    snapshot.arch ?? null,
    snapshot.uptimeSeconds == null ? null : Math.max(0, Math.floor(snapshot.uptimeSeconds)),
    snapshot.toolVersions ? JSON.stringify(snapshot.toolVersions) : null,
    snapshot.tailscale ? JSON.stringify(snapshot.tailscale) : null,
    snapshot.storageSyncStatus ?? null,
    snapshot.storageSyncLastError ?? null,
    snapshot.doctorSummary ? JSON.stringify(snapshot.doctorSummary) : null,
    snapshot.privateMetadata ? 1 : 0,
    observedAt,
  );
}

export function listHeartbeats(machineId?: string): StoredHeartbeat[] {
  const db = getDb();
  if (machineId) {
    return db
      .query(
        `SELECT *
         FROM agent_heartbeats
         WHERE machine_id = ?
         ORDER BY updated_at DESC`
      )
      .all(machineId) as StoredHeartbeat[];
  }

  return db
    .query(
      `SELECT *
       FROM agent_heartbeats
       ORDER BY updated_at DESC`
    )
    .all() as StoredHeartbeat[];
}

export function latestHeartbeatByMachine(heartbeats: readonly StoredHeartbeat[]): Map<string, StoredHeartbeat> {
  const byMachine = new Map<string, StoredHeartbeat>();
  for (const heartbeat of heartbeats) {
    if (!byMachine.has(heartbeat.machine_id)) {
      byMachine.set(heartbeat.machine_id, heartbeat);
    }
  }
  return byMachine;
}

export function countRuns(table: "setup_runs" | "sync_runs"): number {
  const db = getDb();
  const row = db.query(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
  return row.count;
}

export function setHeartbeatStatus(machineId: string, pid: number, status: "online" | "offline"): void {
  const db = getDb();
  db.query(
    `UPDATE agent_heartbeats
     SET status = ?, updated_at = ?
     WHERE machine_id = ? AND pid = ?`
  ).run(status, new Date().toISOString(), machineId, pid);
}

export function recordSetupRun(machineId: string, status: string, details: unknown): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO setup_runs (id, machine_id, status, details_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), machineId, status, JSON.stringify(details), now, now);
}

export function recordSyncRun(machineId: string, status: string, actions: unknown): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO sync_runs (id, machine_id, status, actions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(crypto.randomUUID(), machineId, status, JSON.stringify(actions), now, now);
}
