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
