import type { CaptureOptions, CaptureRunRecord, FreshnessStatus, JsonObject, RestoreExecutionOptions, RestorePlan, SnapshotRecord } from "./types.js";
import { captureAll } from "./capture/index.js";
import { SnapshotStore } from "./storage.js";
import { RestoreMaxAgeError, assertSnapshotWithinMaxAge, createRestorePlan, executeRestorePlan, prepareRestorePlanForExecution } from "./restore.js";
import { resolveMaxAgeMs } from "./util.js";

export interface RuntimeOptions {
  dbPath?: string;
}

export interface CaptureSnapshotOptions extends RuntimeOptions, CaptureOptions {
  name?: string;
}

export interface SnapshotEnvelope {
  snapshot: SnapshotRecord;
  resource_count: number;
  diagnostic_count: number;
  duplicate: boolean;
}

export async function captureSnapshot(options: CaptureSnapshotOptions = {}): Promise<SnapshotEnvelope> {
  const store = new SnapshotStore({ path: options.dbPath });
  // Capture lease: serializes concurrent captures against this store (the
  // */5 cron firing while a manual capture is in flight — station04 P1
  // 2026-08-24). A lease that cannot be acquired within the wait is not an
  // error: saveSnapshot is idempotent, so an overlapping duplicate capture
  // becomes a no-op instead of a failed transaction.
  const leaseAcquired = store.acquireCaptureLease();
  try {
    const capture = await captureAll(options);
    const snapshot = store.saveSnapshot(capture.resources, {
      createdAt: options.now,
      name: options.name,
      diagnostics: capture.diagnostics,
      sourceStatuses: capture.sourceStatuses
    });
    // Record a capture run on EVERY attempt — including when the capture dedups
    // identical state. Freshness (capture liveness) keys off run recency, so a
    // stable machine whose newest UNIQUE snapshot has not changed in hours stays
    // green as long as the */5 capture cron is actually running.
    store.recordCaptureRun({
      createdAt: options.now,
      snapshotId: snapshot.id,
      duplicateOf: snapshot.duplicateOf ?? null,
      resourceCount: capture.resources.length,
      diagnosticCount: capture.diagnostics.length,
      status: snapshot.duplicateOf ? "duplicate" : "created"
    });
    if (!leaseAcquired) {
      console.warn("[snapshots] capture lease not acquired within the wait window; capture proceeded without serialization (saveSnapshot remains idempotent).");
      store.recordAuditEvent("capture.lease-unavailable", null, {
        snapshot_id: snapshot.id,
        message: "capture proceeded without the capture lease"
      });
    }
    return {
      snapshot,
      resource_count: capture.resources.length,
      diagnostic_count: capture.diagnostics.length,
      duplicate: Boolean(snapshot.duplicateOf)
    };
  } finally {
    store.releaseCaptureLease();
    store.close();
  }
}

export function listSnapshots(options: RuntimeOptions & { limit?: number } = {}): SnapshotRecord[] {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    return store.listSnapshots(options.limit ?? 50);
  } finally {
    store.close();
  }
}

export interface ListCaptureRunsOptions extends RuntimeOptions {
  limit?: number;
}

export function listCaptureRuns(options: ListCaptureRunsOptions = {}): CaptureRunRecord[] {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    return store.listCaptureRuns(options.limit ?? 10);
  } finally {
    store.close();
  }
}

export interface FreshnessOptions extends RuntimeOptions {
  threshold?: number;
  now?: string;
}

function ageSeconds(nowMs: number, iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((nowMs - at) / 1000));
}

export function freshness(options: FreshnessOptions = {}): FreshnessStatus {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    const threshold = options.threshold ?? 900;
    const nowMs = options.now ? Date.parse(options.now) : Date.now();
    if (!Number.isFinite(nowMs)) throw new Error(`Invalid now: ${options.now}`);
    const latestRun = store.latestCaptureRun();
    const newestSnapshot = store.listSnapshots(1)[0];

    const last_capture_run_at = latestRun?.createdAt ?? null;
    const last_capture_run_age_seconds = ageSeconds(nowMs, last_capture_run_at);
    const newest_snapshot_at = newestSnapshot?.createdAt ?? null;
    const newest_snapshot_age_seconds = ageSeconds(nowMs, newest_snapshot_at);

    if (!latestRun) {
      // No capture run has ever been recorded: capture never ran (or the store is
      // genuinely empty). This is the one legitimate "no snapshots" alert.
      return {
        ok: false,
        reason: "no-capture-runs",
        last_capture_run_at,
        last_capture_run_age_seconds,
        newest_snapshot_at,
        newest_snapshot_age_seconds,
        threshold
      };
    }
    if ((last_capture_run_age_seconds ?? Infinity) > threshold) {
      // The capture cron has not produced a run inside the threshold window.
      return {
        ok: false,
        reason: "capture-run-stale",
        last_capture_run_at,
        last_capture_run_age_seconds,
        newest_snapshot_at,
        newest_snapshot_age_seconds,
        threshold
      };
    }
    return {
      ok: true,
      reason: "fresh",
      last_capture_run_at,
      last_capture_run_age_seconds,
      newest_snapshot_at,
      newest_snapshot_age_seconds,
      threshold
    };
  } finally {
    store.close();
  }
}

export function getSnapshotEnvelope(options: RuntimeOptions & { id: string }) {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    const snapshot = store.getSnapshot(options.id);
    if (!snapshot) throw new Error(`Snapshot not found: ${options.id}`);
    return {
      snapshot,
      resources: store.getSnapshotResources(options.id)
    };
  } finally {
    store.close();
  }
}

export function listResources(options: RuntimeOptions & { limit?: number } = {}) {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    return {
      resources: store.listResources(options.limit ?? 200)
    };
  } finally {
    store.close();
  }
}

export function listSnapshotResources(options: RuntimeOptions & { id: string; tree?: boolean }) {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    const snapshot = store.getSnapshot(options.id);
    if (!snapshot) throw new Error(`Snapshot not found: ${options.id}`);
    const resources = store.getSnapshotResources(options.id);
    return {
      snapshot,
      resources,
      tree: options.tree ? buildResourceTree(resources) : undefined
    };
  } finally {
    store.close();
  }
}

export function planSnapshotRestore(options: RuntimeOptions & RestoreExecutionOptions & { id: string }): RestorePlan {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    const snapshot = store.getSnapshot(options.id);
    if (!snapshot) throw new Error(`Snapshot not found: ${options.id}`);
    const maxAgeMs = resolveMaxAgeMs(options.maxAgeMs);
    try {
      assertSnapshotWithinMaxAge(snapshot, maxAgeMs);
    } catch (error) {
      if (error instanceof RestoreMaxAgeError) logRestoreRefusal(store, snapshot, error);
      throw error;
    }
    const resources = store.getSnapshotResources(options.id);
    const plan = createRestorePlan(snapshot, resources, store.listPolicies(), { ...options, maxAgeMs });
    store.saveRestorePlan(plan as unknown as JsonObject & { id: string; snapshotId: string; createdAt: string });
    if (options.apply) store.saveRestoreRun(plan);
    return plan;
  } finally {
    store.close();
  }
}

export function applySavedRestorePlan(options: RuntimeOptions & RestoreExecutionOptions & { planId: string }): RestorePlan {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    const plan = store.getRestorePlan(options.planId);
    if (!plan) throw new Error(`Restore plan not found: ${options.planId}`);
    if (!options.planHash) {
      throw new Error(`Applying restore plan ${options.planId} requires --plan-hash.`);
    }
    if (plan.planHash !== options.planHash) {
      throw new Error(`Restore plan hash mismatch for ${options.planId}.`);
    }
    // Re-check the freshness gate at apply time: a plan created within the
    // limit may have aged past it while waiting for --apply --yes.
    const snapshot = store.getSnapshot(plan.snapshotId);
    const maxAgeMs = plan.request?.maxAgeMs ?? resolveMaxAgeMs(options.maxAgeMs);
    if (snapshot) {
      try {
        assertSnapshotWithinMaxAge(snapshot, maxAgeMs);
      } catch (error) {
        if (error instanceof RestoreMaxAgeError) logRestoreRefusal(store, snapshot, error);
        throw error;
      }
    }
    const result = executeRestorePlan(prepareRestorePlanForExecution(plan), { ...options, apply: Boolean(options.apply) });
    if (options.apply) store.saveRestoreRun(result);
    return result;
  } finally {
    store.close();
  }
}

/**
 * A max-age refusal is a logged, alerting error: it goes to stderr and is
 * appended to the durable audit trail so a refused restore is never silent.
 */
function logRestoreRefusal(store: SnapshotStore, snapshot: SnapshotRecord, error: RestoreMaxAgeError): void {
  console.error(`[snapshots] ${error.message}`);
  store.recordAuditEvent("restore.max-age-refused", snapshot.id, {
    snapshot_id: snapshot.id,
    snapshot_created_at: snapshot.createdAt,
    error: error.message
  });
}

export function upsertPolicy(options: RuntimeOptions & { selector: string; mode: "observe" | "restore" | "ignore"; reason?: string }) {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    return store.upsertPolicy(options.selector, options.mode, options.reason);
  } finally {
    store.close();
  }
}

function buildResourceTree(resources: Array<{ id: string; kind: string; name: string; parentId?: string }>) {
  const childrenByParent = new Map<string, typeof resources>();
  for (const resource of resources) {
    if (!resource.parentId) continue;
    const children = childrenByParent.get(resource.parentId) ?? [];
    children.push(resource);
    childrenByParent.set(resource.parentId, children);
  }
  const render = (resource: typeof resources[number]): JsonObject => ({
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    children: (childrenByParent.get(resource.id) ?? []).map(render)
  });
  return resources.filter((resource) => !resource.parentId).map(render);
}

export function listPolicies(options: RuntimeOptions = {}) {
  const store = new SnapshotStore({ path: options.dbPath });
  try {
    return store.listPolicies();
  } finally {
    store.close();
  }
}
