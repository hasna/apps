import type { CaptureOptions, JsonObject, RestoreExecutionOptions, RestorePlan, SnapshotRecord } from "./types.js";
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
      name: options.name,
      diagnostics: capture.diagnostics,
      sourceStatuses: capture.sourceStatuses
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
