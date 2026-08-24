import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type {
  CaptureDiagnostic,
  CaptureSourceStatus,
  JsonObject,
  RestorePlan,
  RestorePolicy,
  SnapshotRecord,
  SnapshotResource,
  SnapshotSaveOptions,
  StoredSnapshotResource,
  StorageOptions
} from "./types.js";
import { defaultDbPath, ensureParentDir, nowIso, sha256, stableJson } from "./util.js";

type Row = Record<string, unknown>;

export class SnapshotStore {
  readonly path: string;
  readonly db: Database;

  constructor(options: StorageOptions = {}) {
    this.path = options.path ?? defaultDbPath();
    ensureParentDir(this.path);
    this.db = new Database(this.path);
    // busy_timeout BEFORE journal_mode: the WAL-mode switch needs an
    // exclusive lock, and concurrent store construction (two captures racing
    // to open the same db — station04 P1 2026-08-24) failed with
    // "database is locked" while the timeout was still unset.
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        parent_id TEXT,
        hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        name TEXT,
        hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        resource_count INTEGER NOT NULL,
        summary TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS snapshot_resources (
        snapshot_id TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        source TEXT NOT NULL,
        parent_id TEXT,
        hash TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (snapshot_id, resource_id),
        FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS policies (
        selector TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        reason TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restore_plans (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS restore_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        plan_hash TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        subject_id TEXT,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS capture_leases (
        lease_key TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS snapshots_created_at_idx ON snapshots(created_at DESC);
      CREATE INDEX IF NOT EXISTS resources_last_seen_at_idx ON resources(last_seen_at DESC);
      CREATE INDEX IF NOT EXISTS snapshot_resources_lookup_idx ON snapshot_resources(snapshot_id, kind, name, resource_id);
      CREATE INDEX IF NOT EXISTS restore_plans_snapshot_idx ON restore_plans(snapshot_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS restore_runs_plan_idx ON restore_runs(plan_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS audit_events_type_idx ON audit_events(event_type, created_at DESC);
    `);
  }

  saveSnapshot(resources: SnapshotResource[], options: SnapshotSaveOptions = {}): SnapshotRecord {
    const createdAt = options.createdAt ?? nowIso();
    const storedResources = resources.map(toStoredResource).sort((a, b) => a.id.localeCompare(b.id));
    const snapshotHash = sha256(stableJson(storedResources.map((resource) => ({
      id: resource.id,
      hash: resource.hash
    }))));

    const id = options.id ?? `snap_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 14)}_${snapshotHash.slice(0, 12)}`;
    const summary = summarizeResources(storedResources, options.diagnostics ?? [], options.sourceStatuses ?? []);

    const insertResource = this.db.query(`
      INSERT INTO resources (id, kind, name, source, parent_id, hash, payload, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        source = excluded.source,
        parent_id = excluded.parent_id,
        hash = excluded.hash,
        payload = excluded.payload,
        last_seen_at = excluded.last_seen_at
    `);
    const insertSnapshot = this.db.query(`
      INSERT INTO snapshots (id, name, hash, created_at, resource_count, summary)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const insertSnapshotResource = this.db.query(`
      INSERT INTO snapshot_resources (snapshot_id, resource_id, kind, name, source, parent_id, hash, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id, resource_id) DO NOTHING
    `);

    // BEGIN IMMEDIATE takes the write lock BEFORE the duplicate check, so two
    // concurrent captures (e.g. the */5 cron firing while a manual capture is
    // in flight — station04 P1 2026-08-24) can never both pass the existence
    // check and then collide on the same (snapshot id, resource id) rows. The
    // second writer blocks until the first commits, then sees the committed
    // row and returns a duplicate instead of inserting. The ON CONFLICT DO
    // NOTHING clauses are belt-and-braces: a collision that still happens
    // becomes a no-op, never a failed transaction.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.getSnapshotByHash(snapshotHash);
      if (existing) {
        this.db.exec("COMMIT");
        return { ...existing, duplicateOf: existing.id };
      }
      for (const resource of storedResources) {
        insertResource.run(
          resource.id,
          resource.kind,
          resource.name,
          resource.source,
          resource.parentId ?? null,
          resource.hash,
          JSON.stringify(resource),
          createdAt,
          createdAt
        );
      }
      const inserted = insertSnapshot.run(id, options.name ?? null, snapshotHash, createdAt, storedResources.length, JSON.stringify(summary));
      if (inserted.changes === 0) {
        // Someone else won the id race (defensive: unreachable under
        // BEGIN IMMEDIATE). Treat as a duplicate of the existing snapshot.
        const winner = this.getSnapshotByHash(snapshotHash) ?? this.getSnapshot(id);
        this.db.exec("COMMIT");
        return winner ? { ...winner, duplicateOf: winner.id } : {
          id,
          name: options.name,
          hash: snapshotHash,
          createdAt,
          resourceCount: storedResources.length,
          summary
        };
      }
      for (const resource of storedResources) {
        insertSnapshotResource.run(
          id,
          resource.id,
          resource.kind,
          resource.name,
          resource.source,
          resource.parentId ?? null,
          resource.hash,
          JSON.stringify(resource)
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no active transaction to roll back
      }
      throw error;
    }

    return {
      id,
      name: options.name,
      hash: snapshotHash,
      createdAt,
      resourceCount: storedResources.length,
      summary
    };
  }

  // --- Capture lease -------------------------------------------------------
  //
  // Serializes captures against a single store so concurrent runs (cron +
  // manual, two CLIs) cannot double-insert the same snapshot. Mirrors the
  // fleet watchdog lease (tmux-server-watchdog.sh): atomically insert the
  // named row iff absent or expired; the row self-expires if the holder dies
  // (no file locks — Station Contract §6.2). A broken lease DB logs loudly
  // and proceeds: capture availability outranks mutual exclusion, and
  // saveSnapshot is idempotent anyway.

  static readonly CAPTURE_LEASE_TTL_MS_DEFAULT = 240_000; // 240s: > worst-case capture, < the 5-min daemon period
  static readonly CAPTURE_LEASE_WAIT_MS_DEFAULT = 30_000;
  private captureLeaseHolderId: string | null = null;

  private static envIntMs(name: string, fallback: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * Acquire the per-store capture lease. Returns true when this store holds
   * the lease, false when another live holder kept it for the whole wait.
   * Expired leases are reclaimed on the next attempt, so a crashed holder
   * cannot wedge captures beyond the TTL.
   */
  acquireCaptureLease(options: { ttlMs?: number; waitMs?: number } = {}): boolean {
    const ttlMs = options.ttlMs ?? SnapshotStore.envIntMs("HASNA_SNAPSHOTS_CAPTURE_LEASE_TTL_MS", SnapshotStore.CAPTURE_LEASE_TTL_MS_DEFAULT);
    const waitMs = options.waitMs ?? SnapshotStore.envIntMs("HASNA_SNAPSHOTS_CAPTURE_LEASE_WAIT_MS", SnapshotStore.CAPTURE_LEASE_WAIT_MS_DEFAULT);
    const holderId = `pid-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    const deadline = Date.now() + Math.max(0, waitMs);
    let acquired = false;
    do {
      const nowIsoValue = nowIso();
      acquired = this.tryAcquireCaptureLease(holderId, ttlMs, nowIsoValue);
      if (acquired) break;
      if (Date.now() >= deadline) break;
      Bun.sleepSync(100);
    } while (true);
    if (acquired) this.captureLeaseHolderId = holderId;
    return acquired;
  }

  private tryAcquireCaptureLease(holderId: string, ttlMs: number, nowIsoValue: string): boolean {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.query("DELETE FROM capture_leases WHERE lease_key = 'capture' AND expires_at <= ?").run(nowIsoValue);
      const inserted = this.db.query(
        `INSERT INTO capture_leases (lease_key, holder_id, acquired_at, expires_at)
         VALUES ('capture', ?, ?, ?)
         ON CONFLICT(lease_key) DO NOTHING`
      ).run(holderId, nowIsoValue, new Date(Date.parse(nowIsoValue) + ttlMs).toISOString());
      this.db.exec("COMMIT");
      return inserted.changes === 1;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK");
      } catch {
        // no active transaction to roll back
      }
      console.warn(`[snapshots] capture lease could not be read/written (${error instanceof Error ? error.message : String(error)}); proceeding without capture serialization.`);
      return false;
    }
  }

  /** Release the capture lease if this store holds it. */
  releaseCaptureLease(): void {
    if (!this.captureLeaseHolderId) return;
    this.db.query("DELETE FROM capture_leases WHERE lease_key = 'capture' AND holder_id = ?").run(this.captureLeaseHolderId);
    this.captureLeaseHolderId = null;
  }

  listSnapshots(limit = 50): SnapshotRecord[] {
    return (this.db.query("SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map(snapshotFromRow);
  }

  getSnapshot(id: string): SnapshotRecord | undefined {
    const row = this.db.query("SELECT * FROM snapshots WHERE id = ?").get(id) as Row | null;
    return row ? snapshotFromRow(row) : undefined;
  }

  getSnapshotByHash(hash: string): SnapshotRecord | undefined {
    const row = this.db.query("SELECT * FROM snapshots WHERE hash = ?").get(hash) as Row | null;
    return row ? snapshotFromRow(row) : undefined;
  }

  getSnapshotResources(snapshotId: string): StoredSnapshotResource[] {
    return this.db
      .query("SELECT payload FROM snapshot_resources WHERE snapshot_id = ? ORDER BY kind, name, resource_id")
      .all(snapshotId)
      .map((row) => JSON.parse(String((row as Row).payload)) as StoredSnapshotResource);
  }

  listResources(limit = 200): StoredSnapshotResource[] {
    return this.db
      .query("SELECT payload FROM resources ORDER BY last_seen_at DESC LIMIT ?")
      .all(limit)
      .map((row) => JSON.parse(String((row as Row).payload)) as StoredSnapshotResource);
  }

  upsertPolicy(selector: string, mode: RestorePolicy["mode"], reason?: string): RestorePolicy {
    const updatedAt = nowIso();
    this.db
      .query(
        `INSERT INTO policies (selector, mode, reason, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(selector) DO UPDATE SET mode = excluded.mode, reason = excluded.reason, updated_at = excluded.updated_at`
      )
      .run(selector, mode, reason ?? null, updatedAt);
    return { selector, mode, reason, updatedAt };
  }

  listPolicies(): RestorePolicy[] {
    return (this.db.query("SELECT * FROM policies ORDER BY selector").all() as Row[]).map(policyFromRow);
  }

  saveRestorePlan(plan: JsonObject & { id: string; snapshotId: string; createdAt: string }): void {
    this.db
      .query("INSERT OR REPLACE INTO restore_plans (id, snapshot_id, created_at, payload) VALUES (?, ?, ?, ?)")
      .run(plan.id, plan.snapshotId, plan.createdAt, JSON.stringify(plan));
  }

  getRestorePlan(id: string): RestorePlan | undefined {
    const row = this.db.query("SELECT payload FROM restore_plans WHERE id = ?").get(id) as Row | null;
    return row ? JSON.parse(String(row.payload)) as RestorePlan : undefined;
  }

  saveRestoreRun(plan: RestorePlan): JsonObject {
    const createdAt = nowIso();
    const status = plan.summary.failed > 0 ? "failed" : plan.summary.blocked > 0 ? "blocked" : "complete";
    const run = {
      id: `run_${plan.id}_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 17)}_${sha256(stableJson({ createdAt, summary: plan.summary, random: Math.random() })).slice(0, 8)}`,
      plan_id: plan.id,
      snapshot_id: plan.snapshotId,
      plan_hash: plan.planHash ?? null,
      status,
      created_at: createdAt,
      summary: plan.summary
    };
    this.db
      .query("INSERT INTO restore_runs (id, plan_id, snapshot_id, plan_hash, status, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(run.id, run.plan_id, run.snapshot_id, run.plan_hash, run.status, run.created_at, JSON.stringify({ ...run, plan }));
    this.db
      .query("INSERT INTO audit_events (id, event_type, subject_id, created_at, payload) VALUES (?, ?, ?, ?, ?)")
      .run(`audit_${run.id}`, "restore.run", run.id, createdAt, JSON.stringify(run));
    return run as unknown as JsonObject;
  }

  /** Append a durable audit event (e.g. a restore refused by the max-age gate). */
  recordAuditEvent(eventType: string, subjectId: string | null, payload: JsonObject): void {
    const createdAt = nowIso();
    const id = `audit_${eventType}_${createdAt.replace(/[-:.TZ]/g, "").slice(0, 17)}_${sha256(stableJson({ createdAt, eventType, random: Math.random() })).slice(0, 8)}`;
    this.db
      .query("INSERT INTO audit_events (id, event_type, subject_id, created_at, payload) VALUES (?, ?, ?, ?, ?)")
      .run(id, eventType, subjectId, createdAt, JSON.stringify(payload));
  }
}

export function toStoredResource(resource: SnapshotResource): StoredSnapshotResource {
  const payload: JsonObject = {
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    source: resource.source,
    attributes: resource.attributes
  };
  if (resource.parentId) payload.parentId = resource.parentId;
  return {
    ...resource,
    hash: sha256(stableJson(payload))
  };
}

function summarizeResources(resources: StoredSnapshotResource[], diagnostics: CaptureDiagnostic[], sourceStatuses: CaptureSourceStatus[]): JsonObject {
  const byKind: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const resource of resources) {
    byKind[resource.kind] = (byKind[resource.kind] ?? 0) + 1;
    bySource[resource.source] = (bySource[resource.source] ?? 0) + 1;
  }
  return {
    by_kind: byKind,
    by_source: bySource,
    diagnostics: diagnostics.map((diagnostic) => ({
      source: diagnostic.source,
      level: diagnostic.level,
      message: diagnostic.message
    })),
    sources: sourceStatuses.map((status) => ({
      source: status.source,
      ok: status.ok,
      duration_ms: status.durationMs,
      resource_count: status.resourceCount,
      diagnostic_count: status.diagnosticCount
    })),
    degraded: sourceStatuses.some((status) => !status.ok)
  };
}

function snapshotFromRow(row: Row): SnapshotRecord {
  return {
    id: String(row.id),
    name: row.name == null ? undefined : String(row.name),
    hash: String(row.hash),
    createdAt: String(row.created_at),
    resourceCount: Number(row.resource_count),
    summary: JSON.parse(String(row.summary)) as JsonObject
  };
}

function policyFromRow(row: Row): RestorePolicy {
  return {
    selector: String(row.selector),
    mode: row.mode as RestorePolicy["mode"],
    reason: row.reason == null ? undefined : String(row.reason),
    updatedAt: String(row.updated_at)
  };
}

export function defaultSnapshotName(): string {
  return `${basename(process.cwd())}-${nowIso()}`;
}
