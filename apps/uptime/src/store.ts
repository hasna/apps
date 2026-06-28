import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { uptimeDbPath, uptimeHostedFallbackDbPath } from "./paths.js";
import { assertHostedTargetAllowed } from "./target-policy.js";
import {
  MAX_INTERVAL_SECONDS,
  MAX_RESULT_LIMIT,
  MAX_RETRY_COUNT,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL_SECONDS,
  MIN_RETRY_COUNT,
  MIN_TIMEOUT_MS,
} from "./limits.js";
import type {
  CheckResult,
  CreateMonitorInput,
  Incident,
  ListResultsOptions,
  Monitor,
  MonitorSummary,
  MonitorStatus,
  UpdateMonitorInput,
  UptimeSummary,
} from "./types.js";

export interface UptimeStoreOptions {
  dbPath?: string;
  mode?: UptimeRuntimeMode;
  allowHostedLocalStore?: boolean;
  cloudDatabaseUrl?: string;
}

export type UptimeRuntimeMode = "local" | "hosted";

export interface UptimeBackup {
  sourcePath: string;
  backupPath: string;
  bytes: number;
  createdAt: string;
}

export interface UptimeBackupCheck {
  ok: boolean;
  backupPath: string;
  integrity: string;
  schemaVersion: string | null;
  missingTables: string[];
  monitors: number;
  results: number;
  incidents: number;
}

const REQUIRED_TABLES = ["schema_migrations", "monitors", "check_results", "incidents", "check_leases"] as const;
const CURRENT_SCHEMA_VERSION = "1";

interface MonitorRow {
  id: string;
  name: string;
  kind: "http" | "tcp";
  url: string | null;
  host: string | null;
  port: number | null;
  method: string;
  expected_status: number | null;
  interval_seconds: number;
  timeout_ms: number;
  retry_count: number;
  enabled: number;
  status: MonitorStatus;
  last_checked_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface CheckResultRow {
  id: string;
  monitor_id: string;
  checked_at: string;
  status: "up" | "down";
  latency_ms: number | null;
  status_code: number | null;
  error: string | null;
  attempt_count: number;
}

interface IncidentRow {
  id: string;
  monitor_id: string;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  last_failure_at: string;
  failure_count: number;
  recovery_check_id: string | null;
  reason: string | null;
}

interface CheckLeaseRow {
  monitor_id: string;
  owner: string;
  leased_until: string;
  acquired_at: string;
}

interface NormalizedMonitorInput {
  name: string;
  kind: "http" | "tcp";
  url?: string;
  host?: string;
  port?: number;
  method: string;
  expectedStatus: number | null;
  intervalSeconds: number;
  timeoutMs: number;
  retryCount: number;
  enabled: boolean;
}

export class StaleCheckResultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleCheckResultError";
  }
}

export class UptimeStore {
  readonly dbPath: string;
  readonly mode: UptimeRuntimeMode;
  readonly dataMode: "local-sqlite" | "hosted-local-sqlite";
  private readonly db: Database;

  constructor(options: UptimeStoreOptions = {}) {
    this.mode = resolveRuntimeMode(options.mode ?? "local");
    const cloudDatabaseUrl = options.cloudDatabaseUrl ?? process.env.HASNA_UPTIME_DATABASE_URL;
    if (this.mode === "hosted" && cloudDatabaseUrl) {
      throw new Error("hosted cloud database adapter is not implemented yet");
    }
    if (this.mode === "hosted" && !allowHostedLocalStore(options.allowHostedLocalStore)) {
      throw new Error("hosted mode requires a cloud data layer; set HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE=1 only for explicit local fallback testing");
    }
    this.dataMode = this.mode === "hosted" ? "hosted-local-sqlite" : "local-sqlite";
    this.dbPath = options.dbPath ?? (this.mode === "hosted" ? uptimeHostedFallbackDbPath() : uptimeDbPath());
    if (this.dbPath !== ":memory:") {
      mkdirSync(dirname(this.dbPath), { recursive: true });
    }
    this.db = new Database(this.dbPath, { create: true });
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS monitors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('http', 'tcp')),
        url TEXT,
        host TEXT,
        port INTEGER,
        method TEXT NOT NULL DEFAULT 'GET',
        expected_status INTEGER,
        interval_seconds INTEGER NOT NULL DEFAULT 60,
        timeout_ms INTEGER NOT NULL DEFAULT 5000,
        retry_count INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown',
        last_checked_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.ensureColumn("monitors", "revision", "INTEGER NOT NULL DEFAULT 1");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS check_results (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('up', 'down')),
        latency_ms REAL,
        status_code INTEGER,
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('open', 'closed')),
        opened_at TEXT NOT NULL,
        closed_at TEXT,
        last_failure_at TEXT NOT NULL,
        failure_count INTEGER NOT NULL DEFAULT 1,
        recovery_check_id TEXT,
        reason TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS check_leases (
        monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
        owner TEXT NOT NULL,
        leased_until TEXT NOT NULL,
        acquired_at TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db
      .query("INSERT OR REPLACE INTO schema_migrations (key, value, updated_at) VALUES ('schema_version', ?, ?)")
      .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
    this.db.run("CREATE INDEX IF NOT EXISTS idx_results_monitor_time ON check_results(monitor_id, checked_at DESC)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_incidents_monitor_status ON incidents(monitor_id, status)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_check_leases_until ON check_leases(leased_until)");
  }

  backup(destinationPath?: string): UptimeBackup {
    if (this.dbPath === ":memory:" && !destinationPath) {
      throw new Error("backup path is required for in-memory stores");
    }
    const createdAt = new Date().toISOString();
    const backupPath = destinationPath ?? join(dirname(this.dbPath), "backups", `uptime-${createdAt.replace(/[:.]/g, "-")}.db`);
    mkdirSync(dirname(backupPath), { recursive: true });
    if (this.dbPath === ":memory:") {
      this.vacuumInto(backupPath);
    } else {
      this.db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      copyFileSync(this.dbPath, backupPath);
    }
    const bytes = statSync(backupPath).size;
    return { sourcePath: this.dbPath, backupPath, bytes, createdAt };
  }

  verifyBackup(backupPath: string): UptimeBackupCheck {
    return verifyBackupFile(backupPath);
  }

  static verifyBackup(backupPath: string): UptimeBackupCheck {
    return verifyBackupFile(backupPath);
  }

  static restoreBackup(backupPath: string, destinationPath = uptimeDbPath()): UptimeBackup {
    const check = verifyBackupFile(backupPath);
    if (!check.ok) throw new Error(`backup integrity check failed: ${check.integrity}`);
    if (destinationPath === ":memory:") throw new Error("cannot restore a backup to an in-memory store");
    if (existsSync(destinationPath) || existsSync(`${destinationPath}-wal`) || existsSync(`${destinationPath}-shm`)) {
      throw new Error("restore destination already exists or has SQLite sidecar files");
    }
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(backupPath, destinationPath);
    const bytes = statSync(destinationPath).size;
    return {
      sourcePath: backupPath,
      backupPath: destinationPath,
      bytes,
      createdAt: new Date().toISOString(),
    };
  }

  createMonitor(input: CreateMonitorInput): Monitor {
    const normalized = normalizeCreateMonitor(input);
    if (this.mode === "hosted") assertHostedTargetAllowed(normalized);
    const now = new Date().toISOString();
    const monitor: Monitor = {
      id: newId("mon"),
      name: normalized.name,
      kind: normalized.kind,
      url: normalized.url ?? null,
      host: normalized.host ?? null,
      port: normalized.port ?? null,
      method: normalized.method ?? "GET",
      expectedStatus: normalized.expectedStatus ?? null,
      intervalSeconds: normalized.intervalSeconds ?? 60,
      timeoutMs: normalized.timeoutMs ?? 5000,
      retryCount: normalized.retryCount ?? 0,
      enabled: normalized.enabled ?? true,
      status: normalized.enabled === false ? "paused" : "unknown",
      lastCheckedAt: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO monitors (
          id, name, kind, url, host, port, method, expected_status,
          interval_seconds, timeout_ms, retry_count, enabled, status,
          last_checked_at, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        monitor.id,
        monitor.name,
        monitor.kind,
        monitor.url,
        monitor.host,
        monitor.port,
        monitor.method,
        monitor.expectedStatus,
        monitor.intervalSeconds,
        monitor.timeoutMs,
        monitor.retryCount,
        monitor.enabled ? 1 : 0,
        monitor.status,
        monitor.lastCheckedAt,
        monitor.revision,
        monitor.createdAt,
        monitor.updatedAt,
      );
    return monitor;
  }

  listMonitors(options: { includeDisabled?: boolean } = {}): Monitor[] {
    const rows = options.includeDisabled
      ? this.db.query("SELECT * FROM monitors ORDER BY name ASC").all() as MonitorRow[]
      : this.db.query("SELECT * FROM monitors WHERE enabled = 1 ORDER BY name ASC").all() as MonitorRow[];
    return rows.map(monitorFromRow);
  }

  getMonitor(idOrName: string): Monitor | null {
    const row = this.db
      .query("SELECT * FROM monitors WHERE id = ? OR name = ?")
      .get(idOrName, idOrName) as MonitorRow | null;
    return row ? monitorFromRow(row) : null;
  }

  updateMonitor(idOrName: string, input: UpdateMonitorInput): Monitor {
    const current = this.getMonitor(idOrName);
    if (!current) throw new Error(`Monitor not found: ${idOrName}`);
    const updatedAt = new Date().toISOString();
    const next = normalizeUpdateMonitor(current, input, updatedAt);
    if (this.mode === "hosted") assertHostedTargetAllowed(next);
    this.db
      .query(
        `UPDATE monitors SET
          name = ?, kind = ?, url = ?, host = ?, port = ?, method = ?,
          expected_status = ?, interval_seconds = ?, timeout_ms = ?,
          retry_count = ?, enabled = ?, status = ?, last_checked_at = ?,
          revision = revision + 1, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.name,
        next.kind,
        next.url,
        next.host,
        next.port,
        next.method,
        next.expectedStatus,
        next.intervalSeconds,
        next.timeoutMs,
        next.retryCount,
        next.enabled ? 1 : 0,
        next.status,
        next.lastCheckedAt,
        updatedAt,
        current.id,
      );
    if (definitionChanged(current, next)) {
      this.closeOpenIncident(current.id, updatedAt);
    }
    return this.getMonitor(current.id)!;
  }

  deleteMonitor(idOrName: string): boolean {
    const current = this.getMonitor(idOrName);
    if (!current) return false;
    this.db.query("DELETE FROM monitors WHERE id = ?").run(current.id);
    return true;
  }

  acquireCheckLease(monitorId: string, owner: string, ttlMs: number): boolean {
    const now = new Date();
    const nowIso = now.toISOString();
    const leasedUntil = new Date(now.getTime() + Math.max(1000, ttlMs)).toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .query("DELETE FROM check_leases WHERE monitor_id = ? AND leased_until <= ?")
        .run(monitorId, nowIso);
      this.db
        .query("INSERT OR IGNORE INTO check_leases (monitor_id, owner, leased_until, acquired_at) VALUES (?, ?, ?, ?)")
        .run(monitorId, owner, leasedUntil, nowIso);
      const row = this.db
        .query("SELECT * FROM check_leases WHERE monitor_id = ?")
        .get(monitorId) as CheckLeaseRow | null;
      return row?.owner === owner;
    });
    return tx();
  }

  releaseCheckLease(monitorId: string, owner: string): void {
    this.db.query("DELETE FROM check_leases WHERE monitor_id = ? AND owner = ?").run(monitorId, owner);
  }

  recordCheckResult(input: Omit<CheckResult, "id" | "checkedAt"> & { checkedAt?: string; expectedMonitorRevision?: number }): CheckResult {
    const monitor = this.getMonitor(input.monitorId);
    if (!monitor) throw new Error(`Monitor not found: ${input.monitorId}`);
    if (input.expectedMonitorRevision !== undefined && monitor.revision !== input.expectedMonitorRevision) {
      throw new StaleCheckResultError(`Monitor changed while check was in progress: ${monitor.name}`);
    }
    if (!monitor.enabled) {
      throw new StaleCheckResultError(`Monitor was disabled while check was in progress: ${monitor.name}`);
    }
    const checkedAt = input.checkedAt ?? new Date().toISOString();
    const result: CheckResult = {
      id: newId("chk"),
      monitorId: monitor.id,
      checkedAt,
      status: input.status,
      latencyMs: input.latencyMs,
      statusCode: input.statusCode,
      error: input.error,
      attemptCount: Math.max(1, input.attemptCount),
    };
    const tx = this.db.transaction(() => {
      const current = this.db
        .query("SELECT * FROM monitors WHERE id = ?")
        .get(result.monitorId) as MonitorRow | null;
      if (!current) throw new Error(`Monitor not found: ${result.monitorId}`);
      if (input.expectedMonitorRevision !== undefined && current.revision !== input.expectedMonitorRevision) {
        throw new StaleCheckResultError(`Monitor changed while check was in progress: ${current.name}`);
      }
      if (!current.enabled) {
        throw new StaleCheckResultError(`Monitor was disabled while check was in progress: ${current.name}`);
      }
      this.db
        .query(
          `INSERT INTO check_results (
            id, monitor_id, checked_at, status, latency_ms, status_code, error, attempt_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          result.id,
          result.monitorId,
          result.checkedAt,
          result.status,
          result.latencyMs,
          result.statusCode,
          result.error,
          result.attemptCount,
        );
      this.db
        .query("UPDATE monitors SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?")
        .run(result.status, result.checkedAt, result.checkedAt, result.monitorId);
      this.reconcileIncidentInTransaction(result);
    });
    tx();
    return result;
  }

  listResults(options: ListResultsOptions = {}): CheckResult[] {
    const limit = clampLimit(options.limit ?? 50);
    const rows = options.monitorId
      ? this.db
        .query("SELECT * FROM check_results WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT ?")
        .all(options.monitorId, limit) as CheckResultRow[]
      : this.db.query("SELECT * FROM check_results ORDER BY checked_at DESC LIMIT ?").all(limit) as CheckResultRow[];
    return rows.map(checkResultFromRow);
  }

  listIncidents(options: { status?: "open" | "closed"; monitorId?: string; limit?: number } = {}): Incident[] {
    const clauses: string[] = [];
    const args: (string | number)[] = [];
    if (options.status) {
      clauses.push("status = ?");
      args.push(options.status);
    }
    if (options.monitorId) {
      clauses.push("monitor_id = ?");
      args.push(options.monitorId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    args.push(clampLimit(options.limit ?? 50));
    const rows = this.db
      .query(`SELECT * FROM incidents ${where} ORDER BY opened_at DESC LIMIT ?`)
      .all(...args) as IncidentRow[];
    return rows.map(incidentFromRow);
  }

  getOpenIncident(monitorId: string): Incident | null {
    const row = this.db
      .query("SELECT * FROM incidents WHERE monitor_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(monitorId) as IncidentRow | null;
    return row ? incidentFromRow(row) : null;
  }

  summary(): UptimeSummary {
    const monitors = this.listMonitors({ includeDisabled: true });
    const summaries = monitors.map((monitor) => this.monitorSummary(monitor));
    return {
      generatedAt: new Date().toISOString(),
      monitors: summaries,
      totals: {
        monitors: monitors.length,
        enabled: monitors.filter((m) => m.enabled).length,
        up: monitors.filter((m) => m.status === "up").length,
        down: monitors.filter((m) => m.status === "down").length,
        paused: monitors.filter((m) => !m.enabled || m.status === "paused").length,
        unknown: monitors.filter((m) => m.status === "unknown").length,
        openIncidents: this.countOpenIncidents(),
      },
    };
  }

  private countOpenIncidents(): number {
    const row = this.db
      .query("SELECT COUNT(*) AS count FROM incidents WHERE status = 'open'")
      .get() as { count: number } | null;
    return Number(row?.count ?? 0);
  }

  private monitorSummary(monitor: Monitor): MonitorSummary {
    const row = this.db
      .query(
        `SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count,
          SUM(CASE WHEN status = 'down' THEN 1 ELSE 0 END) as down_count,
          AVG(CASE WHEN status = 'up' THEN latency_ms ELSE NULL END) as avg_latency
        FROM check_results WHERE monitor_id = ?`,
      )
      .get(monitor.id) as { total: number; up_count: number | null; down_count: number | null; avg_latency: number | null };
    const total = Number(row.total ?? 0);
    const up = Number(row.up_count ?? 0);
    const down = Number(row.down_count ?? 0);
    return {
      monitor,
      totalChecks: total,
      upChecks: up,
      downChecks: down,
      uptimePercent: total > 0 ? round((up / total) * 100, 4) : null,
      averageLatencyMs: row.avg_latency == null ? null : round(row.avg_latency, 2),
      openIncident: this.getOpenIncident(monitor.id),
    };
  }

  private reconcileIncidentInTransaction(result: CheckResult): void {
    const open = this.db
      .query("SELECT * FROM incidents WHERE monitor_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1")
      .get(result.monitorId) as IncidentRow | null;
    if (result.status === "down") {
      if (open) {
        this.db
          .query("UPDATE incidents SET last_failure_at = ?, failure_count = failure_count + 1, reason = COALESCE(?, reason) WHERE id = ?")
          .run(result.checkedAt, result.error, open.id);
      } else {
        this.db
          .query(
            `INSERT INTO incidents (
              id, monitor_id, status, opened_at, closed_at, last_failure_at,
              failure_count, recovery_check_id, reason
            ) VALUES (?, ?, 'open', ?, NULL, ?, 1, NULL, ?)`,
          )
          .run(newId("inc"), result.monitorId, result.checkedAt, result.checkedAt, result.error);
      }
      return;
    }
    if (open) {
      this.db
        .query("UPDATE incidents SET status = 'closed', closed_at = ?, recovery_check_id = ? WHERE id = ?")
        .run(result.checkedAt, result.id, open.id);
    }
  }

  private closeOpenIncident(monitorId: string, closedAt: string): void {
    this.db
      .query("UPDATE incidents SET status = 'closed', closed_at = ? WHERE monitor_id = ? AND status = 'open'")
      .run(closedAt, monitorId);
  }

  private ensureColumn(table: string, name: string, definition: string): void {
    const columns = this.db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === name)) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }

  private vacuumInto(backupPath: string): void {
    const quoted = backupPath.replace(/'/g, "''");
    this.db.run(`VACUUM INTO '${quoted}'`);
  }
}

export function resolveRuntimeMode(mode?: UptimeRuntimeMode): UptimeRuntimeMode {
  const value = mode ?? process.env.HASNA_UPTIME_MODE ?? "local";
  if (value === "local" || value === "hosted") return value;
  throw new Error("HASNA_UPTIME_MODE must be local or hosted");
}

function allowHostedLocalStore(value?: boolean): boolean {
  return value === true || process.env.HASNA_UPTIME_ALLOW_HOSTED_LOCAL_STORE === "1";
}

function verifyBackupFile(backupPath: string): UptimeBackupCheck {
  const db = new Database(backupPath, { readonly: true });
  try {
    const integrityRow = db.query("PRAGMA integrity_check").get() as { integrity_check?: string } | null;
    const integrity = String(integrityRow?.integrity_check ?? "unknown");
    const missingTables = REQUIRED_TABLES.filter((table) => !tableExists(db, table));
    const schemaVersion = missingTables.includes("schema_migrations")
      ? null
      : (db
        .query("SELECT value FROM schema_migrations WHERE key = 'schema_version'")
        .get() as { value: string } | null)?.value ?? null;
    return {
      ok: integrity === "ok" && missingTables.length === 0 && schemaVersion === CURRENT_SCHEMA_VERSION,
      backupPath,
      integrity,
      schemaVersion,
      missingTables,
      monitors: tableCount(db, "monitors"),
      results: tableCount(db, "check_results"),
      incidents: tableCount(db, "incidents"),
    };
  } finally {
    db.close();
  }
}

function tableCount(db: Database, table: string): number {
  if (!tableExists(db, table)) return 0;
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | null;
  return Number(row?.count ?? 0);
}

function tableExists(db: Database, table: string): boolean {
  const row = db
    .query("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { count: number } | null;
  return Number(row?.count ?? 0) > 0;
}

function normalizeCreateMonitor(input: CreateMonitorInput): NormalizedMonitorInput {
  const name = input.name?.trim();
  if (!name) throw new Error("Monitor name is required");
  rejectControlCharacters(name, "Monitor name");
  const method = normalizeMethod(input.method ?? "GET");
  const expectedStatus = normalizeExpectedStatus(input.expectedStatus);
  const enabled = normalizeEnabled(input.enabled);
  if (input.kind === "http") {
    const url = normalizeHttpUrl(input.url);
    return {
      name,
      kind: input.kind,
      url,
      method,
      expectedStatus,
      intervalSeconds: boundedInteger(input.intervalSeconds ?? 60, "intervalSeconds", MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS),
      timeoutMs: boundedInteger(input.timeoutMs ?? 5000, "timeoutMs", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      retryCount: boundedInteger(input.retryCount ?? 0, "retryCount", MIN_RETRY_COUNT, MAX_RETRY_COUNT),
      enabled,
    };
  } else if (input.kind === "tcp") {
    const host = input.host?.trim();
    if (!host) throw new Error("TCP monitors require host");
    rejectControlCharacters(host, "TCP host");
    if (!Number.isInteger(input.port) || input.port! <= 0 || input.port! > 65535) {
      throw new Error("TCP monitors require a port from 1 to 65535");
    }
    return {
      name,
      kind: input.kind,
      host,
      port: input.port,
      method,
      expectedStatus: null,
      intervalSeconds: boundedInteger(input.intervalSeconds ?? 60, "intervalSeconds", MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS),
      timeoutMs: boundedInteger(input.timeoutMs ?? 5000, "timeoutMs", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
      retryCount: boundedInteger(input.retryCount ?? 0, "retryCount", MIN_RETRY_COUNT, MAX_RETRY_COUNT),
      enabled,
    };
  } else {
    throw new Error("Monitor kind must be http or tcp");
  }
}

function definitionChanged(current: Monitor, next: Monitor): boolean {
  return (
    next.kind !== current.kind
    || next.url !== current.url
    || next.host !== current.host
    || next.port !== current.port
    || next.method !== current.method
    || next.expectedStatus !== current.expectedStatus
  );
}

function normalizeUpdateMonitor(current: Monitor, input: UpdateMonitorInput, updatedAt: string): Monitor {
  const merged: Monitor = {
    ...current,
    ...input,
    expectedStatus: input.expectedStatus === undefined ? current.expectedStatus : input.expectedStatus,
    updatedAt,
  };
  const normalized = normalizeCreateMonitor({
    name: merged.name,
    kind: merged.kind,
    url: merged.url ?? undefined,
    host: merged.host ?? undefined,
    port: merged.port ?? undefined,
    method: merged.method,
    expectedStatus: merged.expectedStatus,
    intervalSeconds: merged.intervalSeconds,
    timeoutMs: merged.timeoutMs,
    retryCount: merged.retryCount,
    enabled: merged.enabled,
  });
  const checkDefinitionChanged = (
    normalized.kind !== current.kind
    || (normalized.url ?? null) !== current.url
    || (normalized.host ?? null) !== current.host
    || (normalized.port ?? null) !== current.port
    || normalized.method !== current.method
    || normalized.expectedStatus !== current.expectedStatus
  );
  const status = normalized.enabled
    ? checkDefinitionChanged || !current.enabled
      ? "unknown"
      : current.status
    : "paused";
  return {
    ...current,
    name: normalized.name,
    kind: normalized.kind,
    url: normalized.url ?? null,
    host: normalized.host ?? null,
    port: normalized.port ?? null,
    method: normalized.method,
    expectedStatus: normalized.expectedStatus,
    intervalSeconds: normalized.intervalSeconds,
    timeoutMs: normalized.timeoutMs,
    retryCount: normalized.retryCount,
    enabled: normalized.enabled,
    status,
    lastCheckedAt: checkDefinitionChanged ? null : current.lastCheckedAt,
    updatedAt,
  };
}

function normalizeHttpUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) throw new Error("HTTP monitors require url");
  const parsed = new URL(raw);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("HTTP monitor url must use http or https");
  }
  return parsed.toString();
}

function normalizeMethod(value: string): string {
  const method = value.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(method)) throw new Error("HTTP method must contain only letters");
  return method;
}

function normalizeExpectedStatus(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("expectedStatus must be an HTTP status from 100 to 599");
  }
  return value;
}

function normalizeEnabled(value: boolean | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value !== "boolean") throw new Error("enabled must be a boolean");
  return value;
}

function rejectControlCharacters(value: string, label: string): void {
  if (/[\x00-\x1f\x7f-\x9f]/.test(value)) {
    throw new Error(`${label} must not contain control characters`);
  }
}

function monitorFromRow(row: MonitorRow): Monitor {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    host: row.host,
    port: row.port,
    method: row.method,
    expectedStatus: row.expected_status,
    intervalSeconds: row.interval_seconds,
    timeoutMs: row.timeout_ms,
    retryCount: row.retry_count,
    enabled: Boolean(row.enabled),
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    revision: row.revision ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function checkResultFromRow(row: CheckResultRow): CheckResult {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    checkedAt: row.checked_at,
    status: row.status,
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    error: row.error,
    attemptCount: row.attempt_count,
  };
}

function incidentFromRow(row: IncidentRow): Incident {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    lastFailureAt: row.last_failure_at,
    failureCount: row.failure_count,
    recoveryCheckId: row.recovery_check_id,
    reason: row.reason,
  };
}

function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.floor(value), MAX_RESULT_LIMIT));
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
