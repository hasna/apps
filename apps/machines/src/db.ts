import { Database } from "bun:sqlite";
import { hostname } from "node:os";
import { machineDisplayName, readManifest } from "./manifests.js";
import { ensureParentDir, getDbPath } from "./paths.js";
import { publicMetadataKeys, redactErrorMessage, redactSensitiveValue } from "./redaction.js";
import type { FleetManifest, MachineManifest, MachineConnection, MachinePlatform } from "./types.js";

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

function isReadonlyDatabaseError(error: unknown): boolean {
  return error instanceof Error && /readonly database/i.test(error.message);
}

function execOptionalCloudSchema(db: Database, sql: string): boolean {
  try {
    db.exec(sql);
    return true;
  } catch (error) {
    if (isReadonlyDatabaseError(error)) return false;
    throw error;
  }
}

function createCloudRuntimeTables(db: Database): void {
  execOptionalCloudSchema(db, `
    CREATE TABLE IF NOT EXISTS machine_registry (
      machine_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      friendly_name TEXT,
      platform TEXT NOT NULL,
      connection TEXT,
      declared INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT NOT NULL DEFAULT '[]',
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      source_kind TEXT NOT NULL DEFAULT 'manifest',
      source_ref TEXT,
      manifest_updated_at TEXT,
      updated_at TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      private_metadata INTEGER NOT NULL DEFAULT 0
    )
  `);

  const runtimeEventsAvailable = execOptionalCloudSchema(db, `
    CREATE TABLE IF NOT EXISTS runtime_events (
      event_id TEXT PRIMARY KEY,
      machine_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT,
      message TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'machines',
      dedupe_key TEXT,
      data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      resolved_at TEXT,
      private_metadata INTEGER NOT NULL DEFAULT 0
    )
  `);
  if (!runtimeEventsAvailable) return;

  execOptionalCloudSchema(db, `
    CREATE INDEX IF NOT EXISTS runtime_events_machine_updated_at_idx
    ON runtime_events (machine_id, updated_at)
  `);

  execOptionalCloudSchema(db, `
    CREATE INDEX IF NOT EXISTS runtime_events_dedupe_key_idx
    ON runtime_events (dedupe_key)
  `);
}

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

  createCloudRuntimeTables(db);

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

export interface StoredMachineRegistry {
  machine_id: string;
  display_name: string;
  friendly_name: string | null;
  platform: MachinePlatform;
  connection: MachineConnection | null;
  declared: number;
  tags_json: string;
  capabilities_json: string;
  source_kind: string;
  source_ref: string | null;
  manifest_updated_at: string | null;
  updated_at: string;
  observed_at: string;
  private_metadata: number;
}

export interface MachineRegistrySnapshot {
  machineId: string;
  displayName?: string | null;
  friendlyName?: string | null;
  platform: MachinePlatform;
  connection?: MachineConnection | null;
  declared?: boolean;
  tags?: string[];
  capabilities?: Record<string, unknown>;
  sourceKind?: string;
  sourceRef?: string | null;
  manifestUpdatedAt?: string | null;
  updatedAt?: string | null;
  observedAt?: string | null;
  privateMetadata?: boolean;
}

export type RuntimeEventSeverity = "info" | "notice" | "warning" | "error" | "critical";
export type RuntimeEventStatus = "open" | "resolved" | "ignored";

export interface RuntimeEventInput {
  eventId?: string;
  machineId: string;
  eventType: string;
  severity?: RuntimeEventSeverity;
  status?: RuntimeEventStatus;
  subject?: string | null;
  message: string;
  source?: string;
  dedupeKey?: string | null;
  data?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  privateMetadata?: boolean;
}

export interface StoredRuntimeEvent {
  event_id: string;
  machine_id: string;
  event_type: string;
  severity: RuntimeEventSeverity;
  status: RuntimeEventStatus;
  subject: string | null;
  message: string;
  source: string;
  dedupe_key: string | null;
  data_json: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  private_metadata: number;
}

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function publicRuntimeData(data: Record<string, unknown> | undefined, privateMetadata: boolean): Record<string, unknown> {
  if (privateMetadata) return data ?? {};
  return redactRuntimeNetworkValues(
    redactSensitiveValue(data ?? {}, "", { redactSecretReferences: true }),
  ) as Record<string, unknown>;
}

function publicRuntimeString(value: string | null | undefined, privateMetadata: boolean): string | null {
  if (value == null) return null;
  return privateMetadata ? value : redactErrorMessage(value);
}

function redactRuntimeNetworkValues(value: unknown): unknown {
  if (typeof value === "string") return redactErrorMessage(value);
  if (Array.isArray(value)) return value.map((entry) => redactRuntimeNetworkValues(entry));
  if (value && typeof value === "object") {
    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = redactRuntimeNetworkValues(entry);
    }
    return redacted;
  }
  return value;
}

function registryCapabilities(machine: MachineManifest): Record<string, unknown> {
  return {
    packageNames: machine.packages?.map((pkg) => pkg.name).sort() ?? [],
    appNames: machine.apps?.map((app) => app.name).sort() ?? [],
    fileCount: machine.files?.length ?? 0,
    metadataKeys: publicMetadataKeys(machine.metadata),
  };
}

export function upsertMachineRegistrySnapshot(snapshot: MachineRegistrySnapshot): StoredMachineRegistry {
  const db = getDb();
  const now = new Date().toISOString();
  const updatedAt = snapshot.updatedAt ?? snapshot.manifestUpdatedAt ?? now;
  const observedAt = snapshot.observedAt ?? now;
  db.query(
    `INSERT INTO machine_registry (
       machine_id,
       display_name,
       friendly_name,
       platform,
       connection,
       declared,
       tags_json,
       capabilities_json,
       source_kind,
       source_ref,
       manifest_updated_at,
       updated_at,
       observed_at,
       private_metadata
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(machine_id) DO UPDATE SET
       display_name = excluded.display_name,
       friendly_name = excluded.friendly_name,
       platform = excluded.platform,
       connection = excluded.connection,
       declared = excluded.declared,
       tags_json = excluded.tags_json,
       capabilities_json = excluded.capabilities_json,
       source_kind = excluded.source_kind,
       source_ref = excluded.source_ref,
       manifest_updated_at = excluded.manifest_updated_at,
       updated_at = excluded.updated_at,
       observed_at = excluded.observed_at,
       private_metadata = excluded.private_metadata`
  ).run(
    snapshot.machineId,
    snapshot.displayName ?? snapshot.friendlyName ?? snapshot.machineId,
    snapshot.friendlyName ?? null,
    snapshot.platform,
    snapshot.connection ?? null,
    snapshot.declared === false ? 0 : 1,
    jsonText(redactSensitiveValue(snapshot.tags ?? [], "tags")),
    jsonText(redactSensitiveValue(snapshot.capabilities ?? {}, "", { redactSecretReferences: true })),
    snapshot.sourceKind ?? "manifest",
    snapshot.sourceRef ?? null,
    snapshot.manifestUpdatedAt ?? null,
    updatedAt,
    observedAt,
    snapshot.privateMetadata ? 1 : 0,
  );
  return listMachineRegistry(snapshot.machineId)[0]!;
}

function markMissingRegistryRowsUndeclared(machineIds: string[], sourceKind: string, observedAt: string): void {
  const db = getDb();
  if (machineIds.length === 0) {
    db.query(
      `UPDATE machine_registry
       SET declared = 0, updated_at = ?, observed_at = ?
       WHERE source_kind = ? AND declared = 1`
    ).run(observedAt, observedAt, sourceKind);
    return;
  }

  const placeholders = machineIds.map(() => "?").join(", ");
  db.query(
    `UPDATE machine_registry
     SET declared = 0, updated_at = ?, observed_at = ?
     WHERE source_kind = ? AND declared = 1 AND machine_id NOT IN (${placeholders})`
  ).run(observedAt, observedAt, sourceKind, ...machineIds);
}

export function syncMachineRegistryFromManifest(
  manifest: FleetManifest = readManifest(),
  options: { sourceKind?: string; sourceRef?: string | null } = {},
): StoredMachineRegistry[] {
  const observedAt = new Date().toISOString();
  const sourceKind = options.sourceKind ?? "manifest";
  const machineIds = manifest.machines.map((machine) => machine.id);
  for (const machine of manifest.machines) {
    upsertMachineRegistrySnapshot({
      machineId: machine.id,
      displayName: machineDisplayName(machine),
      friendlyName: machine.friendlyName ?? null,
      platform: machine.platform,
      connection: machine.connection ?? null,
      declared: true,
      tags: machine.tags ?? [],
      capabilities: registryCapabilities(machine),
      sourceKind,
      sourceRef: options.sourceRef ?? null,
      manifestUpdatedAt: machine.updatedAt ?? manifest.generatedAt ?? null,
      updatedAt: machine.updatedAt ?? manifest.generatedAt ?? observedAt,
      observedAt,
      privateMetadata: false,
    });
  }
  markMissingRegistryRowsUndeclared(machineIds, sourceKind, observedAt);
  return listMachineRegistry();
}

export function listMachineRegistry(machineId?: string): StoredMachineRegistry[] {
  const db = getDb();
  if (machineId) {
    return db
      .query(
        `SELECT *
         FROM machine_registry
         WHERE machine_id = ?
         ORDER BY updated_at DESC`
      )
      .all(machineId) as StoredMachineRegistry[];
  }

  return db
    .query(
      `SELECT *
       FROM machine_registry
       ORDER BY updated_at DESC, machine_id ASC`
    )
    .all() as StoredMachineRegistry[];
}

export function recordRuntimeEvent(input: RuntimeEventInput): StoredRuntimeEvent {
  const db = getDb();
  const now = new Date().toISOString();
  const eventId = input.eventId ?? crypto.randomUUID();
  const createdAt = input.createdAt ?? now;
  const updatedAt = input.updatedAt ?? createdAt;
  const privateMetadata = input.privateMetadata === true;
  db.query(
    `INSERT INTO runtime_events (
       event_id,
       machine_id,
       event_type,
       severity,
       status,
       subject,
       message,
       source,
       dedupe_key,
       data_json,
       created_at,
       updated_at,
       resolved_at,
       private_metadata
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET
       machine_id = excluded.machine_id,
       event_type = excluded.event_type,
       severity = excluded.severity,
       status = excluded.status,
       subject = excluded.subject,
       message = excluded.message,
       source = excluded.source,
       dedupe_key = excluded.dedupe_key,
       data_json = excluded.data_json,
       updated_at = excluded.updated_at,
       resolved_at = excluded.resolved_at,
       private_metadata = excluded.private_metadata`
  ).run(
    eventId,
    input.machineId,
    input.eventType,
    input.severity ?? "warning",
    input.status ?? "open",
    publicRuntimeString(input.subject, privateMetadata),
    publicRuntimeString(input.message, privateMetadata) ?? "",
    input.source ?? "machines",
    input.dedupeKey ?? null,
    jsonText(publicRuntimeData(input.data, privateMetadata)),
    createdAt,
    updatedAt,
    input.resolvedAt ?? null,
    privateMetadata ? 1 : 0,
  );
  return listRuntimeEvents({ eventId })[0]!;
}

export function listRuntimeEvents(options: { machineId?: string; eventId?: string } = {}): StoredRuntimeEvent[] {
  const db = getDb();
  if (options.eventId) {
    return db
      .query(
        `SELECT *
         FROM runtime_events
         WHERE event_id = ?
         ORDER BY updated_at DESC`
      )
      .all(options.eventId) as StoredRuntimeEvent[];
  }
  if (options.machineId) {
    return db
      .query(
        `SELECT *
         FROM runtime_events
         WHERE machine_id = ?
         ORDER BY updated_at DESC`
      )
      .all(options.machineId) as StoredRuntimeEvent[];
  }

  return db
    .query(
      `SELECT *
       FROM runtime_events
       ORDER BY updated_at DESC, event_id ASC`
    )
    .all() as StoredRuntimeEvent[];
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
