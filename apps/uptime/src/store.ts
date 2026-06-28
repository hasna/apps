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
  CheckEvidence,
  CheckResult,
  Incident,
  ImportedMonitorInput,
  ImportedUpdateMonitorInput,
  ListResultsOptions,
  Monitor,
  MonitorSummary,
  MonitorStatus,
  ProbeCheckJob,
  ProbeCheckJobStatus,
  ProbeIdentity,
  ProbeSubmissionReceipt,
  UptimeSummary,
} from "./types.js";

export interface UptimeStoreOptions {
  dbPath?: string;
  mode?: UptimeRuntimeMode;
  allowHostedLocalStore?: boolean;
  cloudDatabaseUrl?: string;
}

export type UptimeRuntimeMode = "local" | "hosted";

const SECRET_URL_PARAM_PATTERN = /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)/i;

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

export interface MonitorProvenance {
  monitorId: string;
  source: string;
  sourceId: string;
  sourceLabel: string | null;
  importedAt: string;
  snapshot: unknown;
}

export interface UpsertMonitorProvenanceInput {
  monitorId: string;
  source: string;
  sourceId: string;
  sourceLabel?: string | null;
  snapshot: unknown;
}

export interface StoredImportBatch {
  id: string;
  source: string;
  status: "applied" | "rolled_back";
  createdAt: string;
  rolledBackAt: string | null;
  records: unknown[];
}

export interface SaveImportBatchInput {
  id: string;
  source: string;
  records: unknown[];
}

const REQUIRED_TABLES = ["schema_migrations", "monitors", "check_results", "incidents", "check_leases", "monitor_provenance", "import_batches", "probe_identities", "probe_check_jobs", "probe_submissions"] as const;
const PROBE_TABLES = new Set<string>(["probe_identities", "probe_check_jobs", "probe_submissions"]);
const CURRENT_SCHEMA_VERSION = "2";

interface MonitorRow {
  id: string;
  name: string;
  kind: "http" | "tcp" | "browser_page";
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
  evidence_json: string | null;
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

interface MonitorProvenanceRow {
  monitor_id: string;
  source: string;
  source_id: string;
  source_label: string | null;
  imported_at: string;
  snapshot_json: string;
}

interface ImportBatchRow {
  id: string;
  source: string;
  status: "applied" | "rolled_back";
  created_at: string;
  rolled_back_at: string | null;
  records_json: string;
}

interface ProbeIdentityRow {
  id: string;
  name: string;
  public_key_pem: string;
  public_key_fingerprint: string;
  enabled: number;
  created_at: string;
  last_seen_at: string | null;
}

interface ProbeSubmissionRow {
  id: string;
  probe_id: string;
  job_id: string | null;
  monitor_id: string;
  check_result_id: string;
  nonce: string;
  checked_at: string;
  submitted_at: string;
}

interface ProbeCheckJobRow {
  id: string;
  monitor_id: string;
  monitor_revision: number | null;
  schedule_slot: string;
  status: ProbeCheckJobStatus;
  claimed_by_probe_id: string | null;
  fencing_token: string | null;
  due_at: string;
  claimed_at: string | null;
  lease_expires_at: string | null;
  submitted_result_id: string | null;
  created_at: string;
  updated_at: string;
}

interface NormalizedMonitorInput {
  name: string;
  kind: "http" | "tcp" | "browser_page";
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
        kind TEXT NOT NULL CHECK (kind IN ('http', 'tcp', 'browser_page')),
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
    this.ensureMonitorKindAllowsBrowserPage();
    this.db.run(`
      CREATE TABLE IF NOT EXISTS check_results (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        checked_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('up', 'down')),
        latency_ms REAL,
        status_code INTEGER,
        error TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 1,
        evidence_json TEXT
      )
    `);
    this.ensureColumn("check_results", "evidence_json", "TEXT");
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
      CREATE TABLE IF NOT EXISTS monitor_provenance (
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_label TEXT,
        imported_at TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        PRIMARY KEY (source, source_id)
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('applied', 'rolled_back')),
        created_at TEXT NOT NULL,
        rolled_back_at TEXT,
        records_json TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS probe_identities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        public_key_pem TEXT NOT NULL,
        public_key_fingerprint TEXT NOT NULL UNIQUE,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS probe_submissions (
        id TEXT PRIMARY KEY,
        probe_id TEXT NOT NULL REFERENCES probe_identities(id) ON DELETE CASCADE,
        job_id TEXT NOT NULL,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        check_result_id TEXT NOT NULL REFERENCES check_results(id) ON DELETE CASCADE,
        nonce TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        UNIQUE (probe_id, nonce)
      )
    `);
    this.ensureColumn("probe_submissions", "job_id", "TEXT");
    this.db.run(`
      CREATE TABLE IF NOT EXISTS probe_check_jobs (
        id TEXT PRIMARY KEY,
        monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
        monitor_revision INTEGER NOT NULL DEFAULT 1,
        schedule_slot TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'submitted', 'expired', 'cancelled')),
        claimed_by_probe_id TEXT REFERENCES probe_identities(id) ON DELETE SET NULL,
        fencing_token TEXT,
        due_at TEXT NOT NULL,
        claimed_at TEXT,
        lease_expires_at TEXT,
        submitted_result_id TEXT REFERENCES check_results(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (monitor_id, schedule_slot)
      )
    `);
    this.ensureColumn("probe_check_jobs", "monitor_revision", "INTEGER NOT NULL DEFAULT 1");
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
    this.db.run("CREATE INDEX IF NOT EXISTS idx_monitor_provenance_monitor ON monitor_provenance(monitor_id)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_probe_jobs_status_due ON probe_check_jobs(status, due_at)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_probe_jobs_probe_status ON probe_check_jobs(claimed_by_probe_id, status)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_probe_submissions_probe_time ON probe_submissions(probe_id, submitted_at DESC)");
    this.db.run("CREATE INDEX IF NOT EXISTS idx_probe_submissions_monitor_time ON probe_submissions(monitor_id, checked_at DESC)");
    this.db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_probe_submissions_job ON probe_submissions(job_id) WHERE job_id IS NOT NULL AND job_id != ''");
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

  createMonitor(input: ImportedMonitorInput, options: { allowBrowserPage?: boolean } = {}): Monitor {
    if (this.mode === "hosted") assertHostedTargetAllowed(input);
    const normalized = normalizeCreateMonitor(input, options.allowBrowserPage === true);
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

  updateMonitor(idOrName: string, input: ImportedUpdateMonitorInput, options: { allowBrowserPage?: boolean } = {}): Monitor {
    const current = this.getMonitor(idOrName);
    if (!current) throw new Error(`Monitor not found: ${idOrName}`);
    if (this.mode === "hosted") {
      assertHostedTargetAllowed({
        kind: input.kind ?? current.kind,
        url: input.url ?? current.url ?? undefined,
        host: input.host ?? current.host ?? undefined,
        port: input.port ?? current.port ?? undefined,
      });
    }
    const updatedAt = new Date().toISOString();
    const next = normalizeUpdateMonitor(current, input, updatedAt, options.allowBrowserPage === true);
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

  createProbeIdentity(input: { name: string; publicKeyPem: string; publicKeyFingerprint: string; enabled?: boolean }): ProbeIdentity {
    const name = input.name.trim();
    if (!name) throw new Error("Probe name is required");
    rejectControlCharacters(name, "Probe name");
    const now = new Date().toISOString();
    const probe: ProbeIdentity = {
      id: newId("prb"),
      name,
      publicKeyPem: input.publicKeyPem.trim(),
      publicKeyFingerprint: input.publicKeyFingerprint,
      enabled: input.enabled ?? true,
      createdAt: now,
      lastSeenAt: null,
    };
    if (!probe.publicKeyPem) throw new Error("Probe public key is required");
    this.db
      .query(
        `INSERT INTO probe_identities (
          id, name, public_key_pem, public_key_fingerprint, enabled, created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        probe.id,
        probe.name,
        probe.publicKeyPem,
        probe.publicKeyFingerprint,
        probe.enabled ? 1 : 0,
        probe.createdAt,
        probe.lastSeenAt,
      );
    return probe;
  }

  listProbeIdentities(options: { includeDisabled?: boolean } = {}): ProbeIdentity[] {
    const rows = options.includeDisabled
      ? this.db.query("SELECT * FROM probe_identities ORDER BY name ASC").all() as ProbeIdentityRow[]
      : this.db.query("SELECT * FROM probe_identities WHERE enabled = 1 ORDER BY name ASC").all() as ProbeIdentityRow[];
    return rows.map(probeIdentityFromRow);
  }

  getProbeIdentity(idOrName: string): ProbeIdentity | null {
    const row = this.db
      .query("SELECT * FROM probe_identities WHERE id = ? OR name = ?")
      .get(idOrName, idOrName) as ProbeIdentityRow | null;
    return row ? probeIdentityFromRow(row) : null;
  }

  updateProbeIdentity(idOrName: string, input: { enabled?: boolean; name?: string }): ProbeIdentity {
    const current = this.getProbeIdentity(idOrName);
    if (!current) throw new Error(`Probe not found: ${idOrName}`);
    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name) throw new Error("Probe name is required");
    rejectControlCharacters(name, "Probe name");
    const enabled = input.enabled ?? current.enabled;
    this.db
      .query("UPDATE probe_identities SET name = ?, enabled = ? WHERE id = ?")
      .run(name, enabled ? 1 : 0, current.id);
    return this.getProbeIdentity(current.id)!;
  }

  touchProbeIdentity(idOrName: string, seenAt = new Date().toISOString()): void {
    const probe = this.getProbeIdentity(idOrName);
    if (!probe) throw new Error(`Probe not found: ${idOrName}`);
    this.db.query("UPDATE probe_identities SET last_seen_at = ? WHERE id = ?").run(seenAt, probe.id);
  }

  createProbeCheckJob(input: { monitorId: string; scheduleSlot: string; dueAt?: string }): ProbeCheckJob {
    const monitor = this.getMonitor(input.monitorId);
    if (!monitor) throw new Error(`Monitor not found: ${input.monitorId}`);
    if (!monitor.enabled) throw new Error(`Monitor is disabled: ${monitor.name}`);
    const scheduleSlot = normalizeScheduleSlot(input.scheduleSlot);
    const dueAt = input.dueAt ?? new Date().toISOString();
    assertIsoTimestamp(dueAt, "Probe job dueAt");
    const now = new Date().toISOString();
    const existing = this.db
      .query("SELECT * FROM probe_check_jobs WHERE monitor_id = ? AND schedule_slot = ?")
      .get(monitor.id, scheduleSlot) as ProbeCheckJobRow | null;
    if (existing) return probeCheckJobFromRow(existing);
    const job: ProbeCheckJob = {
      id: newId("job"),
      monitorId: monitor.id,
      monitorRevision: monitor.revision,
      scheduleSlot,
      status: "pending",
      claimedByProbeId: null,
      fencingToken: null,
      dueAt,
      claimedAt: null,
      leaseExpiresAt: null,
      submittedResultId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .query(
        `INSERT INTO probe_check_jobs (
          id, monitor_id, monitor_revision, schedule_slot, status, claimed_by_probe_id, fencing_token,
          due_at, claimed_at, lease_expires_at, submitted_result_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.monitorId,
        job.monitorRevision,
        job.scheduleSlot,
        job.status,
        job.claimedByProbeId,
        job.fencingToken,
        job.dueAt,
        job.claimedAt,
        job.leaseExpiresAt,
        job.submittedResultId,
        job.createdAt,
        job.updatedAt,
      );
    return job;
  }

  getProbeCheckJob(id: string): ProbeCheckJob | null {
    const row = this.db.query("SELECT * FROM probe_check_jobs WHERE id = ?").get(id) as ProbeCheckJobRow | null;
    return row ? probeCheckJobFromRow(row) : null;
  }

  claimProbeCheckJob(input: { jobId: string; probeId: string; leaseTtlMs?: number }): ProbeCheckJob {
    const tx = this.db.transaction(() => {
      const probe = this.getProbeIdentity(input.probeId);
      if (!probe) throw new Error(`Probe not found: ${input.probeId}`);
      if (!probe.enabled) throw new Error(`Probe is disabled: ${probe.name}`);
      const current = this.getProbeCheckJob(input.jobId);
      if (!current) throw new Error(`Probe job not found: ${input.jobId}`);
      const now = new Date();
      const nowIso = now.toISOString();
      if (current.status === "submitted") throw new Error("Probe job already submitted");
      if (current.status === "cancelled") throw new Error("Probe job is cancelled");
      if (current.dueAt > nowIso) throw new Error("Probe job is not due yet");
      const leaseExpired = Boolean(current.leaseExpiresAt && current.leaseExpiresAt <= nowIso);
      if (current.status === "claimed" && !leaseExpired && current.claimedByProbeId !== probe.id) {
        throw new Error("Probe job already claimed by another probe");
      }
      if (current.status !== "pending" && current.status !== "claimed" && current.status !== "expired") {
        throw new Error(`Probe job is not claimable: ${current.status}`);
      }
      const leaseExpiresAt = new Date(now.getTime() + Math.max(1_000, input.leaseTtlMs ?? 120_000)).toISOString();
      const fencingToken = newId("fence");
      const update = this.db
        .query(
          `UPDATE probe_check_jobs
           SET status = 'claimed', claimed_by_probe_id = ?, fencing_token = ?, claimed_at = ?, lease_expires_at = ?, updated_at = ?
           WHERE id = ?
             AND submitted_result_id IS NULL
             AND (
               status IN ('pending', 'expired')
               OR (status = 'claimed' AND (claimed_by_probe_id = ? OR lease_expires_at <= ?))
             )`,
        )
        .run(probe.id, fencingToken, nowIso, leaseExpiresAt, nowIso, current.id, probe.id, nowIso);
      if (statementChanges(update) !== 1) throw new Error("Probe job claim raced; retry");
      this.touchProbeIdentity(probe.id, nowIso);
      return this.getProbeCheckJob(current.id)!;
    });
    return tx();
  }

  completeProbeCheckJob(input: { jobId: string; probeId: string; fencingToken: string; checkResultId: string; submittedAt?: string }): ProbeCheckJob {
    const job = this.getProbeCheckJob(input.jobId);
    if (!job) throw new Error(`Probe job not found: ${input.jobId}`);
    const submittedAt = input.submittedAt ?? new Date().toISOString();
    if (job.status !== "claimed") throw new Error(`Probe job is not claimable for submission: ${job.status}`);
    if (job.claimedByProbeId !== input.probeId) throw new Error("Probe job was claimed by another probe");
    if (job.fencingToken !== input.fencingToken) throw new Error("Probe job fencing token is invalid");
    if (!job.leaseExpiresAt || job.leaseExpiresAt <= submittedAt) {
      this.expireProbeCheckJob(job.id, submittedAt);
      throw new Error("Probe job lease expired");
    }
    const update = this.db
      .query(
        `UPDATE probe_check_jobs
         SET status = 'submitted', submitted_result_id = ?, updated_at = ?
         WHERE id = ?
           AND status = 'claimed'
           AND claimed_by_probe_id = ?
           AND fencing_token = ?
           AND lease_expires_at > ?
           AND submitted_result_id IS NULL`,
      )
      .run(input.checkResultId, submittedAt, job.id, input.probeId, input.fencingToken, submittedAt);
    if (statementChanges(update) !== 1) throw new Error("Probe job submission raced; retry");
    return this.getProbeCheckJob(job.id)!;
  }

  private expireProbeCheckJob(jobId: string, updatedAt = new Date().toISOString()): void {
    this.db
      .query("UPDATE probe_check_jobs SET status = 'expired', updated_at = ? WHERE id = ? AND status != 'submitted'")
      .run(updatedAt, jobId);
  }

  getProbeSubmission(probeId: string, nonce: string): ProbeSubmissionReceipt | null {
    const row = this.db
      .query("SELECT * FROM probe_submissions WHERE probe_id = ? AND nonce = ?")
      .get(probeId, nonce) as ProbeSubmissionRow | null;
    return row ? probeSubmissionFromRow(row) : null;
  }

  recordProbeSubmission(input: Omit<ProbeSubmissionReceipt, "id" | "submittedAt"> & { submittedAt?: string }): ProbeSubmissionReceipt {
    const submittedAt = input.submittedAt ?? new Date().toISOString();
    const receipt: ProbeSubmissionReceipt = {
      id: newId("psb"),
      probeId: input.probeId,
      jobId: input.jobId,
      monitorId: input.monitorId,
      checkResultId: input.checkResultId,
      nonce: input.nonce,
      checkedAt: input.checkedAt,
      submittedAt,
    };
    this.db
      .query(
        `INSERT INTO probe_submissions (
          id, probe_id, job_id, monitor_id, check_result_id, nonce, checked_at, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.id,
        receipt.probeId,
        receipt.jobId,
        receipt.monitorId,
        receipt.checkResultId,
        receipt.nonce,
        receipt.checkedAt,
        receipt.submittedAt,
      );
    return receipt;
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
      evidence: input.evidence ?? null,
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
            id, monitor_id, checked_at, status, latency_ms, status_code, error, attempt_count, evidence_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          result.evidence ? JSON.stringify(result.evidence) : null,
        );
      this.db
        .query("UPDATE monitors SET status = ?, last_checked_at = ?, updated_at = ? WHERE id = ?")
        .run(result.status, result.checkedAt, result.checkedAt, result.monitorId);
      this.reconcileIncidentInTransaction(result);
    });
    tx();
    return result;
  }

  getCheckResult(id: string): CheckResult | null {
    const row = this.db.query("SELECT * FROM check_results WHERE id = ?").get(id) as CheckResultRow | null;
    return row ? checkResultFromRow(row) : null;
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

  getProvenance(source: string, sourceId: string): MonitorProvenance | null {
    const row = this.db
      .query("SELECT * FROM monitor_provenance WHERE source = ? AND source_id = ?")
      .get(source, sourceId) as MonitorProvenanceRow | null;
    return row ? provenanceFromRow(row) : null;
  }

  upsertMonitorProvenance(input: UpsertMonitorProvenanceInput): MonitorProvenance {
    const importedAt = new Date().toISOString();
    this.db
      .query(
        `INSERT INTO monitor_provenance (
          monitor_id, source, source_id, source_label, imported_at, snapshot_json
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, source_id) DO UPDATE SET
          monitor_id = excluded.monitor_id,
          source_label = excluded.source_label,
          imported_at = excluded.imported_at,
          snapshot_json = excluded.snapshot_json`,
      )
      .run(
        input.monitorId,
        input.source,
        input.sourceId,
        input.sourceLabel ?? null,
        importedAt,
        JSON.stringify(input.snapshot),
      );
    return this.getProvenance(input.source, input.sourceId)!;
  }

  saveImportBatch(input: SaveImportBatchInput): StoredImportBatch {
    const createdAt = new Date().toISOString();
    this.db
      .query("INSERT INTO import_batches (id, source, status, created_at, rolled_back_at, records_json) VALUES (?, ?, 'applied', ?, NULL, ?)")
      .run(input.id, input.source, createdAt, JSON.stringify(input.records));
    return this.getImportBatch(input.id)!;
  }

  getImportBatch(batchId: string): StoredImportBatch | null {
    const row = this.db
      .query("SELECT * FROM import_batches WHERE id = ?")
      .get(batchId) as ImportBatchRow | null;
    return row ? importBatchFromRow(row) : null;
  }

  markImportBatchRolledBack(batchId: string): StoredImportBatch {
    const rolledBackAt = new Date().toISOString();
    this.db
      .query("UPDATE import_batches SET status = 'rolled_back', rolled_back_at = ? WHERE id = ?")
      .run(rolledBackAt, batchId);
    const batch = this.getImportBatch(batchId);
    if (!batch) throw new Error(`Import batch not found: ${batchId}`);
    return batch;
  }

  runInTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
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

  private ensureMonitorKindAllowsBrowserPage(): void {
    const row = this.db
      .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'monitors'")
      .get() as { sql: string } | null;
    if (!row?.sql || row.sql.includes("browser_page")) return;
    this.db.run("PRAGMA foreign_keys = OFF");
    this.db.run("PRAGMA legacy_alter_table = ON");
    try {
      const migrate = this.db.transaction(() => {
        this.db.run("ALTER TABLE monitors RENAME TO monitors_old_kind");
        this.db.run(`
          CREATE TABLE monitors (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL CHECK (kind IN ('http', 'tcp', 'browser_page')),
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
        this.db.run(`
          INSERT INTO monitors (
            id, name, kind, url, host, port, method, expected_status,
            interval_seconds, timeout_ms, retry_count, enabled, status,
            last_checked_at, revision, created_at, updated_at
          )
          SELECT
            id, name, kind, url, host, port, method, expected_status,
            interval_seconds, timeout_ms, retry_count, enabled, status,
            last_checked_at, revision, created_at, updated_at
          FROM monitors_old_kind
        `);
        this.db.run("DROP TABLE monitors_old_kind");
      });
      migrate();
    } finally {
      this.db.run("PRAGMA legacy_alter_table = OFF");
      this.db.run("PRAGMA foreign_keys = ON");
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
    const currentOk = missingTables.length === 0 && schemaVersion === CURRENT_SCHEMA_VERSION;
    const restorableV1 = schemaVersion === "1" && missingTables.every((table) => PROBE_TABLES.has(table));
    return {
      ok: integrity === "ok" && (currentOk || restorableV1),
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

function normalizeCreateMonitor(input: ImportedMonitorInput, allowBrowserPage = false): NormalizedMonitorInput {
  const name = input.name?.trim();
  if (!name) throw new Error("Monitor name is required");
  rejectControlCharacters(name, "Monitor name");
  const method = normalizeMethod(input.method ?? "GET");
  const expectedStatus = normalizeExpectedStatus(input.expectedStatus);
  const enabled = normalizeEnabled(input.enabled);
  if (input.kind === "http" || input.kind === "browser_page") {
    if (input.kind === "browser_page" && !allowBrowserPage) {
      throw new Error("browser_page monitors must be imported with explicit browser evidence support");
    }
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
    throw new Error("Monitor kind must be http, tcp, or browser_page");
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

function normalizeUpdateMonitor(current: Monitor, input: ImportedUpdateMonitorInput, updatedAt: string, allowBrowserPage = false): Monitor {
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
  }, allowBrowserPage || current.kind === "browser_page");
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
  for (const key of [...parsed.searchParams.keys()]) {
    if (SECRET_URL_PARAM_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
  }
  parsed.hash = "";
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

function normalizeScheduleSlot(value: string): string {
  const slot = value.trim();
  if (!slot) throw new Error("Probe job scheduleSlot is required");
  if (slot.length > 128) throw new Error("Probe job scheduleSlot is too long");
  rejectControlCharacters(slot, "Probe job scheduleSlot");
  return slot;
}

function assertIsoTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
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
    evidence: parseEvidence(row.evidence_json),
  };
}

function provenanceFromRow(row: MonitorProvenanceRow): MonitorProvenance {
  return {
    monitorId: row.monitor_id,
    source: row.source,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    importedAt: row.imported_at,
    snapshot: parseJson(row.snapshot_json),
  };
}

function importBatchFromRow(row: ImportBatchRow): StoredImportBatch {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    createdAt: row.created_at,
    rolledBackAt: row.rolled_back_at,
    records: Array.isArray(parseJson(row.records_json)) ? parseJson(row.records_json) as unknown[] : [],
  };
}

function probeIdentityFromRow(row: ProbeIdentityRow): ProbeIdentity {
  return {
    id: row.id,
    name: row.name,
    publicKeyPem: row.public_key_pem,
    publicKeyFingerprint: row.public_key_fingerprint,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function probeSubmissionFromRow(row: ProbeSubmissionRow): ProbeSubmissionReceipt {
  return {
    id: row.id,
    probeId: row.probe_id,
    jobId: row.job_id ?? "",
    monitorId: row.monitor_id,
    checkResultId: row.check_result_id,
    nonce: row.nonce,
    checkedAt: row.checked_at,
    submittedAt: row.submitted_at,
  };
}

function probeCheckJobFromRow(row: ProbeCheckJobRow): ProbeCheckJob {
  return {
    id: row.id,
    monitorId: row.monitor_id,
    monitorRevision: row.monitor_revision ?? 1,
    scheduleSlot: row.schedule_slot,
    status: row.status,
    claimedByProbeId: row.claimed_by_probe_id,
    fencingToken: row.fencing_token,
    dueAt: row.due_at,
    claimedAt: row.claimed_at,
    leaseExpiresAt: row.lease_expires_at,
    submittedResultId: row.submitted_result_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseEvidence(value: string | null): CheckEvidence | null {
  if (!value) return null;
  const parsed = parseJson(value);
  return parsed && typeof parsed === "object" ? parsed as CheckEvidence : null;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

function statementChanges(result: unknown): number {
  return Number((result as { changes?: number } | null)?.changes ?? 0);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
