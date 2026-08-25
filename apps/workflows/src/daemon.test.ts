/**
 * Regression tests for the daemon (slice D): claims/leases/reaper + the
 * graph run engine (start/step/decision/while/end, retries, memoization,
 * secrets write-gate).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore, type WorkflowsStore } from "./store.js";
import { SessionWAL } from "./wal.js";
import type { WorkflowGraph } from "./graph.js";
import { WorkflowsDaemon, runGraphToCompletion, type LaneJob, type LaneResult } from "./daemon.js";

let dir: string;
let store: WorkflowsStore;
let wal: SessionWAL;
let clock: { now: number };
let calls: string[];

function fakeLane(job: LaneJob): Promise<LaneResult> {
  calls.push(`lane:${job.lane}:${job.prompt ?? job.command ?? ""}`);
  return Promise.resolve({ ok: true, exitCode: 0, output: `done by ${job.lane}`, durationMs: 1 });
}

function makeDaemon(overrides: Record<string, unknown> = {}) {
  return new WorkflowsDaemon(store, wal, {
    worker: "test-worker",
    time: () => clock.now,
    laneRunner: fakeLane,
    ...overrides,
  });
}

function simpleGraph(): WorkflowGraph {
  return {
    name: "demo",
    version: "1.0.0",
    nodes: [
      { id: "start", type: "start", next: "build" },
      { id: "build", type: "step", lane: "claude", prompt: "build it", next: "done" },
      { id: "done", type: "end" },
    ],
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "workflows-daemon-"));
  store = openStore(dir);
  wal = SessionWAL.open(dir);
  clock = { now: Date.now() };
  calls = [];
});

afterEach(() => {
  wal.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("claims and leases", () => {
  test("claim acquires a lease with fencing; a second worker is refused while it is live", async () => {
    const daemon = makeDaemon();
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const lease = daemon.claim(run.id);
    expect(lease).not.toBeNull();
    expect(lease!.fencing).toBe(1);

    const other = new WorkflowsDaemon(store, wal, { worker: "other", time: () => clock.now, laneRunner: fakeLane });
    expect(other.claim(run.id)).toBeNull();
  });

  test("an expired lease can be claimed by another worker", async () => {
    const daemon = makeDaemon({ leaseTtlMs: 1000 });
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    daemon.claim(run.id);
    clock.now += 2000;
    const other = new WorkflowsDaemon(store, wal, { worker: "other", time: () => clock.now, laneRunner: fakeLane });
    expect(other.claim(run.id)).not.toBeNull();
  });

  test("heartbeat extends the lease; a stale fencing token is rejected", async () => {
    const daemon = makeDaemon({ leaseTtlMs: 1000 });
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const lease = daemon.claim(run.id)!;
    clock.now += 500;
    expect(daemon.heartbeat(run.id, lease.fencing)).toBe(true);
    clock.now += 900;
    expect(daemon.liveLeases().has(run.id)).toBe(true);
    expect(daemon.heartbeat(run.id, 999)).toBe(false);
  });

  test("release requires the matching fencing token", async () => {
    const daemon = makeDaemon();
    const run = store.createRun({ graphName: "g", graphVersion: "1" });
    const lease = daemon.claim(run.id)!;
    expect(daemon.release(run.id, 999)).toBe(false);
    expect(daemon.liveLeases().has(run.id)).toBe(true);
    expect(daemon.release(run.id, lease.fencing)).toBe(true);
    expect(daemon.liveLeases().has(run.id)).toBe(false);
  });
});

describe("reaper", () => {
  test("reap expires stale leases, requeues torn runs, and dispatches pending ones", async () => {
    const daemon = makeDaemon({ leaseTtlMs: 1000 });
    const graph = simpleGraph();
    const torn = daemon.startRun(graph, {});
    daemon.claim(torn.id);
    store.setRunStatus(torn.id, "running");
    clock.now += 5000;

    const pending = daemon.startRun(graph, {});

    const report = await daemon.reap();
    expect(report.expired).toBe(1);
    expect(report.requeued).toBe(1);
    expect(report.dispatched).toBe(2); // the requeued torn run + the new pending run
    // the torn run got a fresh attempt and was re-dispatched in the same cycle
    expect(store.getRun(torn.id)?.attempts).toBe(1);
    expect(store.getRun(pending.id)?.status).toBe("running");
  });

  test("a fresh daemon instance replays registered graphs from the WAL (crash recovery)", async () => {
    // Regression (measured live 2026-08-25): a run started by one process
    // could not be advanced by a replacement daemon — "graph demo not found
    // in daemon graph cache" — because the graph cache was in-memory only and
    // the WAL never carried the graph. `runs resume` and torn-run repair were
    // dead paths across processes. startRun must persist the graph into the
    // WAL and a fresh instance must replay it.
    const first = makeDaemon({ leaseTtlMs: 1000 });
    const run = first.startRun(simpleGraph(), {});
    first.claim(run.id);
    store.setRunStatus(run.id, "running");
    await first.reap(); // advances the start node under the first instance

    clock.now += 5000; // the first instance's claim expires; it is now dead

    const second = makeDaemon({ worker: "replacement-worker", leaseTtlMs: 1000 });
    const report = await second.reap();
    expect(report.requeued).toBe(1); // torn run repaired
    expect(report.advanced).toBeGreaterThan(0); // and advanced by the replacement

    // the replacement drives the run to a terminal state (bounded reaps)
    let after = store.getRun(run.id);
    for (let i = 0; i < 10 && after?.status === "running"; i++) {
      await second.reap();
      after = store.getRun(run.id);
    }
    expect(after?.status).toBe("completed"); // not "graph not found in daemon graph cache"
    expect(after?.error).toBeNull();
  });

  test("reap advances one step per dispatched run (bounded)", async () => {
    const daemon = makeDaemon();
    const run = daemon.startRun(simpleGraph(), {});
    const first = await daemon.reap();
    expect(first.dispatched).toBe(1);
    expect(first.advanced).toBe(1); // the start node advanced
    const second = await daemon.reap();
    expect(second.advanced).toBe(1); // the build step ran via the fake lane
    expect(calls).toContain("lane:claude:build it");
    const nodes = store.listRunNodes(run.id);
    expect(nodes.map((n) => n.nodeId)).toContain("build");
  });
});

describe("run engine", () => {
  test("runs a linear graph to completion with lane results in the run result", async () => {
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, simpleGraph(), {}, { laneRunner: fakeLane, time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    expect(result.steps.build.exitCode).toBe(0);
    expect(result.steps.build.output).toBe("done by claude");
  });

  test("executes command steps via the shell", async () => {
    const graph: WorkflowGraph = {
      name: "cmd",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "run" },
        { id: "run", type: "step", command: "printf hello", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    expect(result.steps.run.exitCode).toBe(0);
    expect(result.steps.run.output).toContain("hello");
  });

  test("a failed command fails the run with the error recorded", async () => {
    const graph: WorkflowGraph = {
      name: "cmd-fail",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "run" },
        { id: "run", type: "step", command: "exit 3", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("failed");
    expect(final.error).toContain("exit 3");
  });

  test("a decision routes to then/else by the condition", async () => {
    const graph: WorkflowGraph = {
      name: "decision",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "probe" },
        { id: "probe", type: "step", command: "exit 0", next: "pick" },
        { id: "pick", type: "decision", condition: "steps.probe.exitCode == 0", then: "good", else: "bad" },
        { id: "good", type: "step", command: "printf good", next: "done" },
        { id: "bad", type: "step", command: "printf bad", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    expect(result.steps.good.output).toContain("good");
    expect(result.steps.bad).toBeUndefined();
  });

  test("a while node loops until its condition fails, bounded by maxIterations", async () => {
    const graph: WorkflowGraph = {
      name: "loop",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "i < 3", body: ["tick"], maxIterations: 10, next: "done" },
        { id: "tick", type: "step", command: "printf tick", next: undefined },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    // i went 0,1,2 -> three iterations, condition i < 3 fails at i=3;
    // later iterations overwrite the same node key; the loop count is durable
    expect(result.steps.tick).toBeTruthy();
    expect(result.steps.tick.output).toContain("tick");
    expect(result.iterations.w).toBe(3);
  });

  test("a while body with multiple nodes sequences them in order per iteration", async () => {
    const graph: WorkflowGraph = {
      name: "seq",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "i < 2", body: ["a", "b"], maxIterations: 5, next: "done" },
        { id: "a", type: "step", command: "printf step-a" },
        { id: "b", type: "step", command: "printf step-b" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    expect(result.steps.a.output).toContain("step-a");
    expect(result.steps.b.output).toContain("step-b");
    expect(result.iterations.w).toBe(2);
    const rows = store.listRunNodes(final.id);
    expect(rows.some((n) => n.nodeId === "a" && n.status === "completed")).toBe(true);
    expect(rows.some((n) => n.nodeId === "b" && n.status === "completed")).toBe(true);
  });

  test("memoized steps inside a while loop hit the cache across iterations", async () => {
    const graph: WorkflowGraph = {
      name: "memo-loop",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "i < 2", body: ["expensive"], maxIterations: 5, next: "done" },
        { id: "expensive", type: "step", command: "printf expensive", memo: true },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("completed");
    const result = JSON.parse(final.resultJson!);
    // the second iteration reused the first iteration's cached output
    expect(result.steps.expensive.memoHit).toBe(true);
    // exactly ONE memo row: the run state did not pollute the input hash
    expect(store.memoList().length).toBe(1);
  });

  test("a while node fails the run when maxIterations is exhausted", async () => {
    const graph: WorkflowGraph = {
      name: "runaway",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "w" },
        { id: "w", type: "while", condition: "true", body: ["tick"], maxIterations: 2, next: "done" },
        { id: "tick", type: "step", command: "printf tick" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("failed");
    expect(final.error).toContain("maxIterations");
  });

  test("a step retries up to maxRetries then fails the run", async () => {
    const graph: WorkflowGraph = {
      name: "retry",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "flaky" },
        { id: "flaky", type: "step", command: "exit 1", maxRetries: 2, next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const final = await runGraphToCompletion(store, wal, graph, {}, { time: () => clock.now });
    expect(final.status).toBe("failed");
    const node = store.listRunNodes(final.id).find((n) => n.nodeId === "flaky")!;
    expect(node.attempts).toBe(3); // 1 initial + 2 retries
  });

  test("memoized steps reuse cached output across runs without re-execution", async () => {
    const graph: WorkflowGraph = {
      name: "memo",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "expensive" },
        { id: "expensive", type: "step", command: "printf fresh", memo: true, next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    const first = await runGraphToCompletion(store, wal, graph, { repo: "a" }, { time: () => clock.now });
    expect(first.status).toBe("completed");
    const second = await runGraphToCompletion(store, wal, graph, { repo: "a" }, { time: () => clock.now });
    expect(second.status).toBe("completed");
    const result = JSON.parse(second.resultJson!);
    expect(result.steps.expensive.output).toBe("fresh"); // cached, not re-run (same output either way)
    expect(result.steps.expensive.memoHit).toBe(true);
    expect(store.memoGet(`memo:expensive:${""}`)).toBeUndefined(); // key is input-hashed, not blank
    expect(store.memoList().length).toBe(1);
  });

  test("the secrets write-gate refuses to persist credential-shaped outputs", async () => {
    const graph: WorkflowGraph = {
      name: "leaky",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "leak" },
        { id: "leak", type: "step", command: "printf \"$VALUE\"", next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    // the value travels in the command environment only — never in the context,
    // which the gate would refuse before the run even starts
    const final = await runGraphToCompletion(store, wal, graph, {}, {
      time: () => clock.now,
      env: { VALUE: `${["sk", "ant"].join("-")}-abcdef1234567890` },
    });
    expect(final.status).toBe("failed");
    expect(final.error).toContain("write-gate");
    // nothing persisted carries the value
    const blob = JSON.stringify(store.getRun(final.id));
    expect(blob).not.toContain("abcdef1234567890");
  });

  test("startRun validates the graph before creating a run", async () => {
    const daemon = makeDaemon();
    const bad = { name: "bad", version: "1.0.0", nodes: [{ id: "solo", type: "step", prompt: "x" }] } as WorkflowGraph;
    let threw: unknown = null;
    try {
      daemon.startRun(bad, {});
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw)).toContain("start");
  });

  test("the WAL graph_registered record is gated: a credential-shaped graph definition never lands in the WAL", async () => {
    // the credential-shaped value is built from fragments so the test source
    // itself is not a credential literal
    const cred = ["Bearer", " ", "abcdefghij", "klmnopqrst", "uvwxyz123456"].join("");
    const graph: WorkflowGraph = {
      name: "leaky-graph",
      version: "1.0.0",
      nodes: [
        { id: "start", type: "start", next: "call" },
        { id: "call", type: "step", command: `curl -s -H 'Authorization: ${cred}' https://example.invalid/api`, next: "done" },
        { id: "done", type: "end" },
      ],
    };
    const daemon = makeDaemon();
    let threw: unknown = null;
    try {
      daemon.startRun(graph, {});
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw)).toContain("write-gate");
    // no graph_registered record carrying the definition may exist in the WAL
    const replay = wal.replay();
    expect(replay.entries.some((e) => e.op.op === "graph_registered")).toBe(false);
    // and no run was created for the refused graph
    expect(store.listRuns({ limit: 100 }).some((r) => r.graphName === "leaky-graph")).toBe(false);
  });
});
