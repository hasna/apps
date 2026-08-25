/**
 * Regression tests for torn-run repair and memoization (slice C).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type WorkflowsStore } from "./store.js";
import { SessionWAL } from "./wal.js";
import { inputHash, memoKey, recordMemo, repairTornRuns, tryMemoHit } from "./session.js";

let dir: string;
let store: WorkflowsStore;
let wal: SessionWAL;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-session-"));
  store = openStore(dir);
  wal = SessionWAL.open(dir);
});

afterEach(() => {
  wal.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function liveClaim(runId: string): void {
  wal.append({ op: "claim_acquired", runId, worker: "w1", expiresAt: new Date(Date.now() + 60000).toISOString(), fencing: 1, at: new Date().toISOString() });
}

describe("torn-run repair", () => {
  test("requeues a running run with no live claim (attempts under the max)", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    store.setRunStatus(run.id, "running");
    const node = store.createRunNode({ runId: run.id, nodeId: "build" });
    store.setRunNodeStatus(node.id, "running");

    const report = repairTornRuns(store, wal, { maxAttempts: 3 });
    expect(report.interrupted).toBe(1);
    expect(report.requeued).toBe(1);
    expect(report.failed).toBe(0);

    const read = store.getRun(run.id);
    expect(read?.status).toBe("pending");
    expect(read?.attempts).toBe(1);
    expect(read?.error).toContain("torn");
    expect(store.getRunNode(node.id)?.status).toBe("pending");
  });

  test("fails a torn run that exhausted its attempts", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    store.bumpAttempts(run.id);
    store.bumpAttempts(run.id);
    store.setRunStatus(run.id, "running");

    const report = repairTornRuns(store, wal, { maxAttempts: 2 });
    expect(report.requeued).toBe(0);
    expect(report.failed).toBe(1);
    expect(store.getRun(run.id)?.status).toBe("failed");
  });

  test("leaves a run with a live claim alone", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    store.setRunStatus(run.id, "running");
    liveClaim(run.id);

    const report = repairTornRuns(store, wal, { maxAttempts: 3 });
    expect(report.interrupted).toBe(0);
    expect(store.getRun(run.id)?.status).toBe("running");
  });

  test("ignores completed and pending runs", () => {
    const done = store.createRun({ graphName: "g", graphVersion: "1" });
    store.setRunStatus(done.id, "completed");
    store.createRun({ graphName: "g", graphVersion: "1" });
    const report = repairTornRuns(store, wal, { maxAttempts: 3 });
    expect(report.interrupted).toBe(0);
    expect(report.requeued).toBe(0);
    expect(report.failed).toBe(0);
  });
});

describe("memoization", () => {
  test("inputHash is stable and sensitive to input", () => {
    const a = inputHash({ x: 1, y: [1, 2] });
    const b = inputHash({ x: 1, y: [1, 2] });
    const c = inputHash({ x: 1, y: [1, 3] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("memoKey namespaces by graph, node, and input hash", () => {
    expect(memoKey("g", "build", { a: 1 })).toMatch(/^g:build:[0-9a-f]{64}$/);
    expect(memoKey("g", "build", { a: 1 })).toBe(memoKey("g", "build", { a: 1 }));
    expect(memoKey("g", "build", { a: 1 })).not.toBe(memoKey("g", "test", { a: 1 }));
  });

  test("a memo miss returns undefined and a hit returns the stored output", () => {
    const input = { repo: "x", sha: "abc" };
    expect(tryMemoHit(store, "g", "build", input)).toBeUndefined();

    recordMemo(store, "g", "build", input, { ok: true, output: "built" });
    const hit = tryMemoHit(store, "g", "build", input);
    expect(hit).toBeTruthy();
    expect(JSON.parse(hit!.outputJson)).toEqual({ ok: true, output: "built" });
    // a second hit increments the counter
    tryMemoHit(store, "g", "build", input);
    expect(store.memoGet(memoKey("g", "build", input))?.hitCount).toBe(2);
  });

  test("different input misses despite a stored memo", () => {
    recordMemo(store, "g", "build", { sha: "abc" }, { ok: true });
    expect(tryMemoHit(store, "g", "build", { sha: "def" })).toBeUndefined();
  });
});
