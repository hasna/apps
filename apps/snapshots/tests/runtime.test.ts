import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applySavedRestorePlan,
  captureSnapshot,
  getSnapshotEnvelope,
  listPolicies,
  listResources,
  listSnapshotResources,
  listSnapshots,
  planSnapshotRestore,
  upsertPolicy
} from "../src/runtime.js";
import { SnapshotStore } from "../src/storage.js";
import type { SnapshotResource } from "../src/types.js";

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "snapshots-runtime-")), "snapshots.sqlite");
}

describe("runtime restore plans", () => {
  test("saves immutable granular plans and applies them by id/hash", () => {
    const path = dbPath();
    const projectPath = join(mkdtempSync(join(tmpdir(), "snapshots-runtime-project-")), "project");
    const resource: SnapshotResource = {
      id: "project:saved-plan",
      kind: "project",
      name: "saved-plan",
      source: "projects",
      attributes: { path: projectPath },
      observedAt: "2026-06-19T00:00:00.000Z"
    };
    const store = new SnapshotStore({ path });
    try {
      store.saveSnapshot([resource], {
        id: "snap_saved_plan",
        createdAt: "2026-06-19T00:00:00.000Z"
      });
    } finally {
      store.close();
    }

    const plan = planSnapshotRestore({ dbPath: path, id: "snap_saved_plan", include: ["kind:project"] });
    const blocked = applySavedRestorePlan({ dbPath: path, planId: plan.id, planHash: plan.planHash, apply: true });
    const applied = applySavedRestorePlan({ dbPath: path, planId: plan.id, planHash: plan.planHash, apply: true, yes: true });
    const auditStore = new SnapshotStore({ path });
    const runCount = auditStore.db.query("SELECT count(*) AS count FROM restore_runs WHERE plan_id = ?").get(plan.id) as { count: number };
    const savedPlan = auditStore.getRestorePlan(plan.id);
    auditStore.close();

    expect(plan.planHash).toBeTruthy();
    expect(plan.operations).toHaveLength(1);
    expect(blocked.summary.blocked).toBe(1);
    expect(applied.summary.applied).toBe(1);
    expect(savedPlan?.summary.planned).toBe(1);
    expect(Number(runCount.count)).toBe(2);
    expect(() => applySavedRestorePlan({ dbPath: path, planId: plan.id, planHash: "bad" })).toThrow("hash mismatch");
    expect(() => applySavedRestorePlan({ dbPath: path, planId: plan.id, apply: true })).toThrow("--plan-hash");
  });

  test("uses distinct plan ids for distinct restore requests", () => {
    const path = dbPath();
    const projectPath = join(mkdtempSync(join(tmpdir(), "snapshots-plan-id-project-")), "project");
    const resource: SnapshotResource = {
      id: "project:plan-id",
      kind: "project",
      name: "plan-id",
      source: "projects",
      attributes: { path: projectPath },
      observedAt: "2026-06-19T00:00:00.000Z"
    };
    const store = new SnapshotStore({ path });
    try {
      store.saveSnapshot([resource], {
        id: "snap_plan_id",
        createdAt: "2026-06-19T00:00:00.000Z"
      });
    } finally {
      store.close();
    }

    const byKind = planSnapshotRestore({ dbPath: path, id: "snap_plan_id", include: ["kind:project"] });
    const byId = planSnapshotRestore({ dbPath: path, id: "snap_plan_id", include: ["project:plan-id"] });

    expect(byKind.id).not.toBe(byId.id);
    expect(byKind.planHash).not.toBe(byId.planHash);
  });
});

describe("runtime snapshot facade", () => {
  test("captures, lists, and recognizes a duplicate snapshot", async () => {
    const path = dbPath();

    const first = await captureSnapshot({ dbPath: path, include: [], name: "empty baseline" });
    const duplicate = await captureSnapshot({ dbPath: path, include: [], name: "duplicate attempt" });
    const snapshots = listSnapshots({ dbPath: path, limit: 1 });

    expect(first.resource_count).toBe(0);
    expect(first.diagnostic_count).toBe(0);
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.snapshot.duplicateOf).toBe(first.snapshot.id);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.name).toBe("empty baseline");
  });
  test("reads snapshot resources as both a flat list and a parent-child tree", () => {
    const path = dbPath();
    const resources: SnapshotResource[] = [
      {
        id: "tmux-session:runtime-tree",
        kind: "tmux-session",
        name: "runtime-tree",
        source: "test",
        attributes: {},
        observedAt: "2026-06-19T00:00:00.000Z"
      },
      {
        id: "tmux-window:runtime-tree:0",
        kind: "tmux-window",
        name: "runtime-tree:0",
        source: "test",
        parentId: "tmux-session:runtime-tree",
        attributes: { index: 0 },
        observedAt: "2026-06-19T00:00:00.000Z"
      }
    ];
    const store = new SnapshotStore({ path });
    try {
      store.saveSnapshot(resources, {
        id: "snap_runtime_tree",
        createdAt: "2026-06-19T00:00:00.000Z"
      });
    } finally {
      store.close();
    }

    const envelope = getSnapshotEnvelope({ dbPath: path, id: "snap_runtime_tree" });
    const flat = listSnapshotResources({ dbPath: path, id: "snap_runtime_tree" });
    const nested = listSnapshotResources({ dbPath: path, id: "snap_runtime_tree", tree: true });
    const latest = listResources({ dbPath: path, limit: 1 });

    expect(envelope.snapshot.id).toBe("snap_runtime_tree");
    expect(envelope.resources).toHaveLength(2);
    expect(flat.resources).toHaveLength(2);
    expect(flat.tree).toBeUndefined();
    expect(nested.tree).toEqual([
      {
        id: "tmux-session:runtime-tree",
        kind: "tmux-session",
        name: "runtime-tree",
        children: [
          {
            id: "tmux-window:runtime-tree:0",
            kind: "tmux-window",
            name: "runtime-tree:0",
            children: []
          }
        ]
      }
    ]);
    expect(latest.resources).toHaveLength(1);
    expect(() => getSnapshotEnvelope({ dbPath: path, id: "missing" })).toThrow("Snapshot not found: missing");
    expect(() => listSnapshotResources({ dbPath: path, id: "missing" })).toThrow("Snapshot not found: missing");
  });

  test("upserts policies through the runtime facade", () => {
    const path = dbPath();

    const created = upsertPolicy({ dbPath: path, selector: "kind:project", mode: "observe", reason: "audit only" });
    const replaced = upsertPolicy({ dbPath: path, selector: "kind:project", mode: "ignore" });

    expect(created.mode).toBe("observe");
    expect(replaced.mode).toBe("ignore");
    expect(listPolicies({ dbPath: path })).toEqual([
      expect.objectContaining({ selector: "kind:project", mode: "ignore" })
    ]);
  });
});

describe("runtime max-age gate", () => {
  const OLD_CREATED_AT = "2026-06-19T00:00:00.000Z";

  function saveAgedSnapshot(path: string, id = "snap_old"): void {
    const store = new SnapshotStore({ path });
    try {
      store.saveSnapshot(
        [{
          id: "project:aged",
          kind: "project",
          name: "aged",
          source: "projects",
          attributes: { path: join(mkdtempSync(join(tmpdir(), "snapshots-maxage-runtime-")), "project") },
          observedAt: OLD_CREATED_AT
        }],
        { id, createdAt: OLD_CREATED_AT }
      );
    } finally {
      store.close();
    }
  }

  function captureStderr(fn: () => void): string[] {
    const lines: string[] = [];
    const original = console.error;
    console.error = (message?: unknown) => {
      lines.push(String(message));
    };
    try {
      fn();
    } finally {
      console.error = original;
    }
    return lines;
  }

  test("refuses an old snapshot with a logged, audited error", () => {
    const path = dbPath();
    saveAgedSnapshot(path);

    const stderr = captureStderr(() => {
      expect(() => planSnapshotRestore({ dbPath: path, id: "snap_old", maxAgeMs: 3_600_000 })).toThrow("max-age");
    });

    expect(stderr.some((line) => line.includes("[snapshots]") && line.includes("Refusing restore"))).toBe(true);
    const auditStore = new SnapshotStore({ path });
    try {
      const rows = auditStore.db
        .query("SELECT payload FROM audit_events WHERE event_type = 'restore.max-age-refused'")
        .all() as Array<{ payload: string }>;
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0].payload)).toMatchObject({
        snapshot_id: "snap_old",
        snapshot_created_at: OLD_CREATED_AT
      });
    } finally {
      auditStore.close();
    }
  });

  test("HASNA_SNAPSHOTS_MAX_AGE applies as the configured limit", () => {
    const path = dbPath();
    saveAgedSnapshot(path);
    process.env.HASNA_SNAPSHOTS_MAX_AGE = "1h";
    try {
      expect(() => planSnapshotRestore({ dbPath: path, id: "snap_old" })).toThrow("max-age");
      expect(() => planSnapshotRestore({ dbPath: path, id: "snap_old", maxAgeMs: 365 * 86_400_000 })).not.toThrow();
    } finally {
      delete process.env.HASNA_SNAPSHOTS_MAX_AGE;
    }
  });

  test("an explicit limit wins over the environment", () => {
    const path = dbPath();
    saveAgedSnapshot(path);
    process.env.HASNA_SNAPSHOTS_MAX_AGE = "1h";
    try {
      expect(() => planSnapshotRestore({ dbPath: path, id: "snap_old", maxAgeMs: 365 * 86_400_000 })).not.toThrow();
    } finally {
      delete process.env.HASNA_SNAPSHOTS_MAX_AGE;
    }
  });

  test("a malformed configured limit fails loudly instead of disabling the gate", () => {
    const path = dbPath();
    saveAgedSnapshot(path);
    process.env.HASNA_SNAPSHOTS_MAX_AGE = "not-a-duration";
    try {
      expect(() => planSnapshotRestore({ dbPath: path, id: "snap_old" })).toThrow("Invalid duration");
    } finally {
      delete process.env.HASNA_SNAPSHOTS_MAX_AGE;
    }
  });

  test("applying a saved plan re-checks the gate at apply time", () => {
    const path = dbPath();
    saveAgedSnapshot(path);

    const plan = planSnapshotRestore({ dbPath: path, id: "snap_old" });
    expect(() => applySavedRestorePlan({ dbPath: path, planId: plan.id, planHash: plan.planHash, apply: true, yes: true, maxAgeMs: 3_600_000 })).toThrow("max-age");

    const stderr = captureStderr(() => {
      expect(() => applySavedRestorePlan({ dbPath: path, planId: plan.id, planHash: plan.planHash, maxAgeMs: 3_600_000 })).toThrow("max-age");
    });
    expect(stderr.some((line) => line.includes("[snapshots]") && line.includes("Refusing restore"))).toBe(true);

    const auditStore = new SnapshotStore({ path });
    try {
      const rows = auditStore.db
        .query("SELECT payload FROM audit_events WHERE event_type = 'restore.max-age-refused'")
        .all() as Array<{ payload: string }>;
      expect(rows).toHaveLength(2);
    } finally {
      auditStore.close();
    }
  });
});

describe("runtime capture lease", () => {
  test("capture proceeds without the lease and records the degraded path", async () => {
    const path = dbPath();
    const holder = new SnapshotStore({ path });
    try {
      expect(holder.acquireCaptureLease({ waitMs: 0, ttlMs: 60_000 })).toBe(true);
      process.env.HASNA_SNAPSHOTS_CAPTURE_LEASE_WAIT_MS = "50";
      try {
        const result = await captureSnapshot({ dbPath: path, include: [], name: "lease-degraded" });
        expect(result.resource_count).toBe(0);
        expect(result.duplicate).toBe(false);
      } finally {
        delete process.env.HASNA_SNAPSHOTS_CAPTURE_LEASE_WAIT_MS;
      }
      const auditStore = new SnapshotStore({ path });
      try {
        const rows = auditStore.db
          .query("SELECT payload FROM audit_events WHERE event_type = 'capture.lease-unavailable'")
          .all() as Array<{ payload: string }>;
        expect(rows).toHaveLength(1);
        expect(JSON.parse(rows[0].payload)).toMatchObject({ message: "capture proceeded without the capture lease" });
      } finally {
        auditStore.close();
      }
    } finally {
      holder.releaseCaptureLease();
      holder.close();
    }
  });

  test("sequential captures each acquire and release the lease cleanly", async () => {
    const path = dbPath();
    const first = await captureSnapshot({ dbPath: path, include: [], name: "lease-a" });
    const second = await captureSnapshot({ dbPath: path, include: [], name: "lease-b" });

    expect(first.resource_count).toBe(0);
    expect(second.resource_count).toBe(0);
    const store = new SnapshotStore({ path });
    try {
      const live = store.db.query("SELECT count(*) AS count FROM capture_leases WHERE lease_key = 'capture'").get() as { count: number };
      expect(Number(live.count)).toBe(0); // no leaked lease rows
      expect(store.listSnapshots().length).toBeGreaterThanOrEqual(1);
    } finally {
      store.close();
    }
  });
});
