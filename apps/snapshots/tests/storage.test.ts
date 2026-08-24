import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SnapshotStore } from "../src/storage.js";
import type { SnapshotResource } from "../src/types.js";

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "snapshots-storage-")), "snapshots.sqlite");
}

function machineResource(now = "2026-06-19T00:00:00.000Z"): SnapshotResource {
  return {
    id: "machine:test",
    kind: "machine",
    name: "test-machine",
    source: "machine",
    attributes: {
      hostname: "test-machine",
      platform: "linux"
    },
    observedAt: now
  };
}

describe("SnapshotStore", () => {
  test("stores snapshots and dedupes equivalent resource state", () => {
    const store = new SnapshotStore({ path: dbPath() });
    try {
      const first = store.saveSnapshot([machineResource()], { name: "first", createdAt: "2026-06-19T00:00:00.000Z" });
      const second = store.saveSnapshot([machineResource("2026-06-19T01:00:00.000Z")], {
        name: "second",
        createdAt: "2026-06-19T01:00:00.000Z"
      });

      expect(first.id).toBe(second.id);
      expect(second.duplicateOf).toBe(first.id);
      expect(store.listSnapshots()).toHaveLength(1);
      expect(store.getSnapshotResources(first.id)[0].hash).toBeTruthy();
    } finally {
      store.close();
    }
  });

  test("persists and lists restore policies", () => {
    const store = new SnapshotStore({ path: dbPath() });
    try {
      store.upsertPolicy("kind:process", "ignore", "processes are observe-only");
      expect(store.listPolicies()).toMatchObject([
        {
          selector: "kind:process",
          mode: "ignore",
          reason: "processes are observe-only"
        }
      ]);
    } finally {
      store.close();
    }
  });
});

describe("SnapshotStore concurrent capture safety (station04 P1 2026-08-24)", () => {
  test("a same-id save with different content dedupes instead of failing UNIQUE", () => {
    const store = new SnapshotStore({ path: dbPath() });
    try {
      const first = store.saveSnapshot([machineResource()], { id: "snap_same_id", createdAt: "2026-06-19T00:00:00.000Z" });
      const other: SnapshotResource = {
        id: "process:1",
        kind: "process",
        name: "bash",
        source: "processes",
        attributes: { pid: 1 },
        observedAt: "2026-06-19T00:00:00.000Z"
      };
      const second = store.saveSnapshot([other], { id: "snap_same_id", createdAt: "2026-06-19T00:00:00.000Z" });

      expect(first.id).toBe("snap_same_id");
      expect(second.duplicateOf).toBe("snap_same_id");
      expect(store.listSnapshots()).toHaveLength(1);
      expect(store.getSnapshotResources("snap_same_id")).toHaveLength(1);
      expect(store.getSnapshotResources("snap_same_id")[0]?.id).toBe("machine:test");
    } finally {
      store.close();
    }
  });

  test("a second store saving the same content returns the existing snapshot as duplicate", () => {
    const path = dbPath();
    const first = new SnapshotStore({ path });
    const second = new SnapshotStore({ path });
    try {
      const a = first.saveSnapshot([machineResource()], { id: "snap_two_stores", createdAt: "2026-06-19T00:00:00.000Z" });
      const b = second.saveSnapshot([machineResource()], { id: "snap_two_stores", createdAt: "2026-06-19T00:00:00.000Z" });

      expect(b.duplicateOf).toBe(a.id);
      expect(first.listSnapshots()).toHaveLength(1);
    } finally {
      first.close();
      second.close();
    }
  });
});

describe("SnapshotStore capture lease", () => {
  test("acquires, blocks a second holder, and releases", () => {
    const path = dbPath();
    const a = new SnapshotStore({ path });
    const b = new SnapshotStore({ path });
    try {
      expect(a.acquireCaptureLease({ waitMs: 0 })).toBe(true);
      expect(b.acquireCaptureLease({ waitMs: 0 })).toBe(false);
      a.releaseCaptureLease();
      expect(b.acquireCaptureLease({ waitMs: 0 })).toBe(true);
      b.releaseCaptureLease();
    } finally {
      a.close();
      b.close();
    }
  });

  test("only the holder can release the lease", () => {
    const path = dbPath();
    const a = new SnapshotStore({ path });
    const b = new SnapshotStore({ path });
    try {
      expect(a.acquireCaptureLease({ waitMs: 0 })).toBe(true);
      b.releaseCaptureLease(); // not the holder: must be a no-op
      expect(b.acquireCaptureLease({ waitMs: 0 })).toBe(false);
      a.releaseCaptureLease();
      expect(b.acquireCaptureLease({ waitMs: 0 })).toBe(true);
      b.releaseCaptureLease();
    } finally {
      a.close();
      b.close();
    }
  });

  test("reclaims expired leases left by a crashed holder", () => {
    const path = dbPath();
    const a = new SnapshotStore({ path });
    const b = new SnapshotStore({ path });
    try {
      expect(a.acquireCaptureLease({ waitMs: 0, ttlMs: 30 })).toBe(true);
      expect(b.acquireCaptureLease({ waitMs: 0, ttlMs: 30 })).toBe(false); // still live
      Bun.sleepSync(60); // holder "dies" without releasing
      expect(b.acquireCaptureLease({ waitMs: 0, ttlMs: 30 })).toBe(true); // expired row reclaimed
      b.releaseCaptureLease();
    } finally {
      a.close();
      b.close();
    }
  });

  test("waits for a live lease holder within the wait window", () => {
    const path = dbPath();
    const a = new SnapshotStore({ path });
    const b = new SnapshotStore({ path });
    try {
      expect(a.acquireCaptureLease({ waitMs: 0, ttlMs: 60_000 })).toBe(true);
      const started = Date.now();
      expect(b.acquireCaptureLease({ waitMs: 300, ttlMs: 60_000 })).toBe(false); // holder holds through the wait
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);
      a.releaseCaptureLease();
      expect(b.acquireCaptureLease({ waitMs: 300, ttlMs: 60_000 })).toBe(true);
      b.releaseCaptureLease();
    } finally {
      a.close();
      b.close();
    }
  });
});
