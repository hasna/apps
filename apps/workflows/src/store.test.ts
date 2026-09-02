/**
 * Regression tests for the three-table store (slice B): runs, run_nodes, memos.
 */
import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { openStore, type WorkflowsStore } from "./store.js";

let dir: string;
let store: WorkflowsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-store-"));
  store = openStore(dir);
});

afterEach(() => {
  setSystemTime();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("three-table schema", () => {
  test("creates exactly three tables (runs, run_nodes, memos)", () => {
    const tables = store.listTables();
    expect(tables.sort()).toEqual(["memos", "run_nodes", "runs"]);
  });
});

describe("runs", () => {
  test("creates a pending run and reads it back", () => {
    const run = store.createRun({ graphName: "demo", graphVersion: "1.0.0", context: { input: 1 } });
    expect(run.status).toBe("pending");
    expect(run.graphName).toBe("demo");
    expect(run.attempts).toBe(0);
    const read = store.getRun(run.id);
    expect(read?.id).toBe(run.id);
    expect(JSON.parse(read!.contextJson)).toEqual({ input: 1 });
  });

  test("lists runs newest-first", () => {
    setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const a = store.createRun({ graphName: "g", graphVersion: "1" });
    setSystemTime(new Date("2026-08-01T12:00:00.001Z"));
    const b = store.createRun({ graphName: "g", graphVersion: "1" });
    expect(b.createdAt > a.createdAt).toBe(true);
    const runs = store.listRuns();
    expect(runs.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  test("breaks equal creation timestamps by descending id", () => {
    setSystemTime(new Date("2026-08-01T12:00:00.000Z"));
    const a = store.createRun({ graphName: "g", graphVersion: "1" });
    const b = store.createRun({ graphName: "g", graphVersion: "1" });
    expect(b.createdAt).toBe(a.createdAt);
    const expected = [a.id, b.id].sort().reverse();
    expect(store.listRuns().map((r) => r.id)).toEqual(expected);
    expect(store.listRuns({ status: "pending" }).map((r) => r.id)).toEqual(expected);
  });

  test("filters runs by status", () => {
    const a = store.createRun({ graphName: "g", graphVersion: "1" });
    store.setRunStatus(a.id, "completed");
    store.createRun({ graphName: "g", graphVersion: "1" });
    const completed = store.listRuns({ status: "completed" });
    expect(completed.map((r) => r.id)).toEqual([a.id]);
  });

  test("transitions a run through running -> completed with result", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    store.setRunStatus(run.id, "running");
    store.setRunStatus(run.id, "completed", { result: { ok: true } });
    const read = store.getRun(run.id);
    expect(read?.status).toBe("completed");
    expect(JSON.parse(read!.resultJson!)).toEqual({ ok: true });
    expect(read?.finishedAt).toBeTruthy();
  });

  test("records failure with error and increments attempts", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    store.bumpAttempts(run.id);
    store.setRunStatus(run.id, "failed", { error: "lane exploded" });
    const read = store.getRun(run.id);
    expect(read?.status).toBe("failed");
    expect(read?.error).toBe("lane exploded");
    expect(read?.attempts).toBe(1);
  });

  test("getRun returns undefined for a missing id", () => {
    expect(store.getRun("nope")).toBeUndefined();
  });

  test("setRunContext persists durable execution state", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1", context: { input: 1 } });
    store.setRunContext(run.id, { input: 1, __wf: { cursor: "build", loops: {} } });
    const read = store.getRun(run.id);
    expect(JSON.parse(read!.contextJson).__wf.cursor).toBe("build");
  });
});

describe("run_nodes", () => {
  test("creates pending nodes for a run and lists them in insertion order", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const n1 = store.createRunNode({ runId: run.id, nodeId: "build", lane: "claude" });
    const n2 = store.createRunNode({ runId: run.id, nodeId: "check" });
    const nodes = store.listRunNodes(run.id);
    expect(nodes.map((n) => n.nodeId)).toEqual(["build", "check"]);
    expect(n1.status).toBe("pending");
    expect(n2.lane).toBeNull();
  });

  test("marks a node running then completed with output and exit code", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const node = store.createRunNode({ runId: run.id, nodeId: "build", lane: "claude" });
    store.setRunNodeStatus(node.id, "running");
    store.setRunNodeStatus(node.id, "completed", { exitCode: 0, output: { summary: "ok" } });
    const read = store.getRunNode(node.id);
    expect(read?.status).toBe("completed");
    expect(read?.exitCode).toBe(0);
    expect(JSON.parse(read!.outputJson!)).toEqual({ summary: "ok" });
    expect(read?.startedAt).toBeTruthy();
    expect(read?.finishedAt).toBeTruthy();
  });

  test("records node failure with error", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const node = store.createRunNode({ runId: run.id, nodeId: "build" });
    store.setRunNodeStatus(node.id, "failed", { error: "exit 1" });
    const read = store.getRunNode(node.id);
    expect(read?.status).toBe("failed");
    expect(read?.error).toBe("exit 1");
  });

  test("bumps attempts on a node", () => {
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const node = store.createRunNode({ runId: run.id, nodeId: "build" });
    store.bumpAttemptsNode(node.id);
    store.bumpAttemptsNode(node.id);
    expect(store.getRunNode(node.id)?.attempts).toBe(2);
  });

  test("getLatestRunNode returns the newest row for a (run, node) pair", () => {
    // per-iteration rows (stress v4 P3): loop-body steps keep one row per
    // completed iteration, so "the node row" is ambiguous — the latest one is
    // what `nodes show` and the engine's row-reuse decision need.
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const first = store.createRunNode({ runId: run.id, nodeId: "step" });
    const second = store.createRunNode({ runId: run.id, nodeId: "step" });
    expect(store.getLatestRunNode(run.id, "step")?.id).toBe(second.id);
    expect(store.getLatestRunNode(run.id, "nope")).toBeUndefined();
    expect(store.getLatestRunNode(run.id, "step")!.id).not.toBe(first.id);
  });

  test("openStore exposes the data dir it was opened on", () => {
    expect(store.dataDir).toBe(dir);
  });
});

describe("SQLITE_BUSY containment", () => {
  // Stress V1 F1 (measured 2026-08-30): 3 concurrent CLI processes on one
  // data dir — 2/3 died rc=1 with stderr exactly "database is locked" and
  // 0-byte -j stdout. SQLite must wait for a concurrent writer within a
  // bounded window instead of failing immediately.
  test("a writer in another process waits for a held write lock instead of failing with SQLITE_BUSY", async () => {
    const raw = new Database(join(dir, "workflows.db"));
    raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("BEGIN IMMEDIATE"); // hold the write lock
    const script = [
      'import { openStore } from "./src/store.ts";',
      "const s = openStore(process.env.WFTEST_DIR);",
      "try {",
      '  s.createRun({ graphName: "g", graphVersion: "1" });',
      '  console.log("WRITE_OK");',
      "} catch (e) {",
      '  console.log("WRITE_FAIL:" + (e instanceof Error ? e.message : String(e)));',
      "} finally {",
      "  s.close();",
      "}",
    ].join("\n");
    const worker = Bun.spawn(["bun", "-e", script], {
      cwd: join(import.meta.dir, ".."), // app root: src/store.test.ts -> apps/workflows
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, WFTEST_DIR: dir },
    });
    await Bun.sleep(500); // pre-fix: the worker has already failed; post-fix: it is waiting
    raw.exec("COMMIT"); // release the lock
    const stdout = await new Response(worker.stdout).text();
    const exitCode = await worker.exited;
    const rows = raw.query("SELECT COUNT(*) AS n FROM runs").get() as { n: number };
    raw.close();
    expect(exitCode, `worker stdout=${JSON.stringify(stdout)}`).toBe(0);
    expect(stdout).toContain("WRITE_OK"); // pre-fix: WRITE_FAIL:database is locked
    expect(stdout).not.toContain("WRITE_FAIL");
    expect(rows.n).toBe(1);
  });
});

describe("memos", () => {
  test("put and get a memo by key", () => {
    store.memoPut("demo:build:abc123", "demo", "build", "abc123", JSON.stringify({ out: 1 }));
    const memo = store.memoGet("demo:build:abc123");
    expect(memo).toBeTruthy();
    expect(JSON.parse(memo!.outputJson)).toEqual({ out: 1 });
    expect(memo?.hitCount).toBe(0);
  });

  test("memoGet returns undefined for a miss", () => {
    expect(store.memoGet("demo:build:miss")).toBeUndefined();
  });

  test("a hit increments hitCount", () => {
    store.memoPut("k", "g", "n", "h", "{}");
    store.memoHit("k");
    store.memoHit("k");
    expect(store.memoGet("k")?.hitCount).toBe(2);
  });

  test("lists and clears memos", () => {
    store.memoPut("a", "g", "n", "h1", "{}");
    store.memoPut("b", "g", "n", "h2", "{}");
    expect(store.memoList().length).toBe(2);
    store.memoClear();
    expect(store.memoList().length).toBe(0);
  });
});
