/**
 * Regression tests for torn-run repair and memoization (slice C).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type WorkflowsStore } from "./store.js";
import { SessionWAL } from "./wal.js";
import type { WorkflowGraph } from "./graph.js";
import { inputHash, memoKey, memoWatchFingerprint, recordMemo, repairTornRuns, restoreInterruptedRun, tryMemoHit } from "./session.js";

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
    expect(read?.status).toBe("interrupted");
    expect(read?.attempts).toBe(1);
    expect(read?.error).toContain("torn");
    expect(store.getRunNode(node.id)?.status).toBe("pending");
  });

  test("a repaired torn run is restorable by top-level resume (live-verify closure)", () => {
    // Live-verify 2026-08-25: kill-a-run-mid-node then `workflows repair`
    // requeued the torn run to `pending`, and restoreInterruptedRun's guard
    // rejected it — top-level resume was unreachable ("use 'runs resume' for
    // cancelled/failed runs"). Repair must mark the run `interrupted` so
    // resume restores it with its memoized (completed) node outputs reused.
    const run = store.createRun({ graphName: "g", graphVersion: "1", context: { n: 1 } });
    store.setRunStatus(run.id, "running");
    const done = store.createRunNode({ runId: run.id, nodeId: "built" });
    store.setRunNodeStatus(done.id, "completed", { output: { ok: true } });
    const inFlight = store.createRunNode({ runId: run.id, nodeId: "deploy" });
    store.setRunNodeStatus(inFlight.id, "running");

    const report = repairTornRuns(store, wal, { maxAttempts: 3 });
    expect(report.interrupted).toBe(1);
    expect(report.requeued).toBe(1);
    expect(store.getRun(run.id)?.status).toBe("interrupted");

    const restored = restoreInterruptedRun(store, run.id);
    expect(restored.status).toBe("pending");
    expect(restored.memoizedNodes).toBe(1);
    expect(restored.nodesRestored).toBe(1);
    expect(store.getRun(run.id)?.status).toBe("pending");
    expect(store.getRunNode(inFlight.id)?.status).toBe("pending");
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

describe("memo watch fingerprint", () => {
  // Stress V3/V4 F2 (measured 2026-08-30): a memoized node reading a file
  // under the data dir served a stale cached "0" while the file said "2" —
  // the memo key covered only {command, prompt, context}, none of which is
  // the external state the command reads. The graph-level memoWatch list
  // joins file fingerprints (mtimes + sha256) into the memo input.
  const watchedGraph = (memoWatch: string[]): WorkflowGraph => ({
    name: "wf",
    version: "1.0.0",
    memoWatch,
    nodes: [
      { id: "start", type: "start", next: "collect" },
      { id: "collect", type: "step", command: "cat scratch/wf2.cnt", memo: true, next: "done" },
      { id: "done", type: "end" },
    ],
  });

  test("returns undefined when the graph declares no memoWatch", () => {
    const graph: WorkflowGraph = { name: "wf", version: "1.0.0", nodes: [] };
    expect(memoWatchFingerprint(graph, dir)).toBeUndefined();
  });

  test("a missing watched file is a stable fingerprint entry", () => {
    const a = memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir);
    expect(a).toEqual([
      { pattern: "scratch/wf2.cnt", path: join(dir, "scratch", "wf2.cnt"), missing: true, mtimeMs: null, size: null, sha256: null },
    ]);
    expect(memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir)).toEqual(a);
  });

  test("a content change changes the fingerprint", () => {
    mkdirSync(join(dir, "scratch"), { recursive: true });
    writeFileSync(join(dir, "scratch", "wf2.cnt"), "1", "utf8");
    const before = memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir);
    writeFileSync(join(dir, "scratch", "wf2.cnt"), "2", "utf8");
    const after = memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir);
    expect(before).not.toEqual(after);
    expect(before![0].sha256).not.toBe(after![0].sha256);
  });

  test("an mtime-only touch changes the fingerprint", () => {
    mkdirSync(join(dir, "scratch"), { recursive: true });
    const file = join(dir, "scratch", "wf2.cnt");
    writeFileSync(file, "2", "utf8");
    const before = memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir);
    const stat = statSync(file);
    utimesSync(file, stat.atime, new Date(stat.mtimeMs + 5_000));
    const after = memoWatchFingerprint(watchedGraph(["scratch/wf2.cnt"]), dir);
    expect(before).not.toEqual(after);
    expect(before![0].sha256).toBe(after![0].sha256); // content unchanged
    expect(before![0].mtimeMs).not.toBe(after![0].mtimeMs);
  });

  test("a glob pattern fingerprints every matched file, sorted", () => {
    mkdirSync(join(dir, "scratch"), { recursive: true });
    writeFileSync(join(dir, "scratch", "b.cnt"), "2", "utf8");
    writeFileSync(join(dir, "scratch", "a.cnt"), "1", "utf8");
    const fp = memoWatchFingerprint(watchedGraph(["scratch/*.cnt"]), dir);
    expect(fp).toHaveLength(2);
    expect(fp!.map((e) => e.path)).toEqual([join(dir, "scratch", "a.cnt"), join(dir, "scratch", "b.cnt")]);
  });

  test("an absolute glob pattern fingerprints matched files at their absolute paths (release-review P1)", () => {
    // 0.1.4 release review P1: absolute memoWatch globs were joined to
    // dataDir, so every absolute match fingerprinted as missing and a change
    // never invalidated the memo — stale memoized output stayed reachable.
    const scratch = join(dir, "scratch");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "a.cnt"), "1", "utf8");
    const pattern = join(scratch, "*.cnt");
    const fp = memoWatchFingerprint(watchedGraph([pattern]), dir);
    expect(fp).toHaveLength(1);
    expect(fp![0].path).toBe(join(scratch, "a.cnt"));
    expect(fp![0].missing).toBe(false);
    expect(fp![0].sha256).not.toBeNull();
    // a content change must invalidate the fingerprint
    writeFileSync(join(scratch, "a.cnt"), "2", "utf8");
    const after = memoWatchFingerprint(watchedGraph([pattern]), dir);
    expect(after).not.toEqual(fp);
    expect(after![0].sha256).not.toBe(fp![0].sha256);
  });
});
