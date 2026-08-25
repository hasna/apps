/**
 * Regression tests for the three-table store (slice B): runs, run_nodes, memos.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type WorkflowsStore } from "./store.js";

let dir: string;
let store: WorkflowsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-store-"));
  store = openStore(dir);
});

afterEach(() => {
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
    const a = store.createRun({ graphName: "g", graphVersion: "1" });
    const b = store.createRun({ graphName: "g", graphVersion: "1" });
    const runs = store.listRuns();
    expect(runs.map((r) => r.id)).toEqual([b.id, a.id]);
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
