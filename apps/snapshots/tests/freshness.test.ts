import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureSnapshot, freshness, listCaptureRuns } from "../src/runtime.js";
import { SnapshotStore } from "../src/storage.js";

function dbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "snapshots-freshness-")), "snapshots.sqlite");
}

// Regression for todos 27f3d817: the deployed freshness alarm keyed off the age of
// the newest UNIQUE snapshot (`snapshots list --limit 1`), but `snapshots capture`
// dedups identical state by design and only mints a new snapshot when state changes.
// On a stable machine the newest unique snapshot ages past the threshold while the
// capture cron is alive, producing a false INCIDENT every 5 minutes.
//
// The fix: freshness keys off capture-RUN recency. Every capture attempt (dedup or
// new) records a capture run, so an alive-but-deduping cron stays green and a
// genuinely dead/stalled cron (no recent run) alerts.

describe("snapshots freshness", () => {
  test("stays GREEN when capture is alive-but-deduping and the newest unique snapshot is old", async () => {
    const path = dbPath();
    const t0 = "2026-08-24T08:00:00.000Z"; // first capture mints a snapshot
    const t1 = "2026-08-24T08:05:00.000Z"; // second capture dedups identical state
    const now = "2026-08-24T08:05:30.000Z"; // the freshness check runs 30s after t1

    const first = await captureSnapshot({ dbPath: path, include: [], now: t0, name: "t0" });
    const second = await captureSnapshot({ dbPath: path, include: [], now: t1, name: "t1" });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const store = new SnapshotStore({ path });
    try {
      // The newest UNIQUE snapshot is t0 (330s old relative to `now`) ...
      expect(store.listSnapshots()).toHaveLength(1);
      expect(store.listSnapshots(1)[0]?.createdAt).toBe(t0);
      // ... but the latest capture RUN is t1 (30s old relative to `now`).
      const runs = store.listCaptureRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0]?.createdAt).toBe(t1);
      expect(runs[0]?.status).toBe("duplicate");
      expect(runs[0]?.duplicateOf).toBe(first.snapshot.id);
      expect(store.latestCaptureRun()?.createdAt).toBe(t1);
    } finally {
      store.close();
    }

    const status = freshness({ dbPath: path, now, threshold: 900 });
    expect(status.ok).toBe(true);
    expect(status.reason).toBe("fresh");
    expect(status.last_capture_run_age_seconds).toBe(30);
    expect(status.newest_snapshot_age_seconds).toBe(330);
  });

  test("ALERTS when no capture run is recent (genuinely dead or stalled capture)", async () => {
    const path = dbPath();
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:00:00.000Z" });
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:05:00.000Z" });

    // 55 minutes since the last run: the */5 cron has not fired in that window.
    const status = freshness({ dbPath: path, now: "2026-08-24T09:00:00.000Z", threshold: 900 });
    expect(status.ok).toBe(false);
    expect(status.reason).toBe("capture-run-stale");
    expect(status.last_capture_run_age_seconds).toBe(3300);
  });

  test("ALERTS when no capture run has ever been recorded (capture never ran)", () => {
    const path = dbPath();
    const status = freshness({ dbPath: path, now: "2026-08-24T09:00:00.000Z", threshold: 900 });
    expect(status.ok).toBe(false);
    expect(status.reason).toBe("no-capture-runs");
    expect(status.last_capture_run_at).toBeNull();
  });

  test("threshold is honored: a run inside the threshold is fresh, outside is stale", async () => {
    const path = dbPath();
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:00:00.000Z" });
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:14:30.000Z" });

    // 8:14:30 run is 120s before the 8:16:30 check -> within a 900s threshold.
    expect(freshness({ dbPath: path, now: "2026-08-24T08:16:30.000Z", threshold: 900 }).ok).toBe(true);
    // A 60s threshold makes the same run stale.
    const tight = freshness({ dbPath: path, now: "2026-08-24T08:16:30.000Z", threshold: 60 });
    expect(tight.ok).toBe(false);
    expect(tight.reason).toBe("capture-run-stale");
  });

  test("listCaptureRuns returns the most recent run first and exposes dedup state", async () => {
    const path = dbPath();
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:00:00.000Z" });
    await captureSnapshot({ dbPath: path, include: [], now: "2026-08-24T08:05:00.000Z" });

    const runs = listCaptureRuns({ dbPath: path, limit: 10 });
    expect(runs).toHaveLength(2);
    expect(runs[0]?.createdAt).toBe("2026-08-24T08:05:00.000Z");
    expect(runs[0]?.status).toBe("duplicate");
    expect(runs[1]?.createdAt).toBe("2026-08-24T08:00:00.000Z");
    expect(runs[1]?.status).toBe("created");
    expect(runs[0]?.snapshotId).toBe(runs[1]?.snapshotId); // dedup points at the existing snapshot
    expect(runs[0]?.resourceCount).toBe(0);
  });
});
