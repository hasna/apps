/**
 * The daemon (slice D): claims/leases/reaper + the graph run engine.
 *
 * A worker claims a run (fencing-tokened, expiring lease, WAL-recorded),
 * heartbeats to extend it, and releases it on completion. The reaper
 * expires stale leases, repairs torn runs (see session.ts), dispatches
 * pending runs, and advances every claimed run ONE step per cycle — every
 * cycle is bounded (maxDispatchPerCycle, maxStepsPerCycle) and the run
 * engine itself is bounded (retries per step, maxIterations per while,
 * maxCycles per runGraphToCompletion), per the SOL finite-budget verdict.
 *
 * The secrets write-gate (secrets.ts) refuses to persist credential-shaped
 * node outputs, run results, or contexts.
 */
import { createHash } from "node:crypto";import { evaluateExpr, ExprEvalError, ExprSyntaxError } from "./expr.js";
import { findNode, type GraphNode, type WorkflowGraph, validateGraph } from "./graph.js";
import { assertNoSecrets } from "./secrets.js";
import { recordMemo, repairTornRuns, tryMemoHit } from "./session.js";
import type { RunRow, WorkflowsStore } from "./store.js";
import { SessionWAL } from "./wal.js";

import { LANE_KINDS, type LaneJob, type LaneKind, type LaneResult } from "./lanes/types.js";

export type { LaneJob, LaneKind, LaneResult } from "./lanes/types.js";
export { LANE_KINDS } from "./lanes/types.js";

export type LaneRunner = (job: LaneJob) => Promise<LaneResult>;

export interface Lease {
  runId: string;
  worker: string;
  expiresAtMs: number;
  fencing: number;
}

export interface DaemonOptions {
  worker?: string;
  leaseTtlMs?: number;
  maxAttempts?: number;
  maxDispatchPerCycle?: number;
  maxStepsPerCycle?: number;
  time?: () => number;
  laneRunner?: LaneRunner;
  env?: Record<string, string>;
}

export interface ReapReport {
  expired: number;
  interrupted: number;
  requeued: number;
  failed: number;
  dispatched: number;
  advanced: number;
  completed: number;
}

export type StepOutcome =
  | { kind: "advanced"; nodeId: string }
  | { kind: "completed" }
  | { kind: "failed"; error: string }
  | { kind: "noop" }
  | { kind: "blocked" };

const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_MAX_DISPATCH = 4;
const DEFAULT_MAX_STEPS = 25;
const DEFAULT_TIMEOUT_MS = 120_000;

function nowIso(): string {
  return new Date().toISOString();
}

/** The user-visible run input: context minus the engine's own state. */
function stripRunState(context: Record<string, unknown>): Record<string, unknown> {
  const { __wf: _wf, steps: _steps, ...user } = context;
  return user;
}

/** Execute a shell command with a bounded timeout (the built-in step executor). */
export function runCommand(job: LaneJob): LaneResult {
  if (!job.command) {
    return { ok: false, exitCode: 2, output: "", durationMs: 0, error: "no command" };
  }
  const started = Date.now();
  const timeoutMs = job.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const proc = Bun.spawnSync({
    cmd: ["/bin/sh", "-c", job.command],
    cwd: job.cwd,
    env: { ...process.env, ...(job.env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
    timeout: timeoutMs,
  });
  const durationMs = Date.now() - started;
  const stdout = proc.stdout ? new TextDecoder().decode(proc.stdout) : "";
  const stderr = proc.stderr ? new TextDecoder().decode(proc.stderr) : "";
  const output = stderr ? `${stdout}\n${stderr}`.trim() : stdout.trim();
  const exitCode = proc.exitCode ?? (proc.signalCode ? 1 : 1);
  return { ok: exitCode === 0, exitCode, output, durationMs };
}

export class WorkflowsDaemon {
  readonly worker: string;
  private readonly leaseTtlMs: number;
  private readonly maxAttempts: number;
  private readonly maxDispatchPerCycle: number;
  private readonly maxStepsPerCycle: number;
  private readonly time: () => number;
  private readonly laneRunner: LaneRunner;
  private readonly env: Record<string, string>;
  private readonly leases = new Map<string, Lease>();
  private readonly fencingCounter = new Map<string, number>();
  private graphCache = new Map<string, WorkflowGraph>();

  constructor(
    private readonly store: WorkflowsStore,
    private readonly wal: SessionWAL,
    options: DaemonOptions = {},
  ) {
    this.worker = options.worker ?? "local";
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxDispatchPerCycle = options.maxDispatchPerCycle ?? DEFAULT_MAX_DISPATCH;
    this.maxStepsPerCycle = options.maxStepsPerCycle ?? DEFAULT_MAX_STEPS;
    this.time = options.time ?? Date.now;
    this.env = options.env ?? {};
    this.laneRunner = options.laneRunner ?? defaultLaneRunner;
    this.replayRegisteredGraphs();
  }

  /**
   * Recover graph definitions from the WAL. A replacement daemon (crash
   * recovery) must be able to advance runs whose graphs were registered by
   * the previous instance — the in-memory cache alone made `runs resume` and
   * torn-run repair dead paths across processes (measured live 2026-08-25:
   * "graph ... not found in daemon graph cache"). The latest registration of
   * a name wins.
   */
  private replayRegisteredGraphs(): void {
    const entries = this.wal.replay().entries;
    for (const entry of entries) {
      const op = entry.op;
      if (op.op === "graph_registered") {
        this.graphCache.set(op.name, op.graph);
      }
    }
  }

  liveLeases(): ReadonlyMap<string, Lease> {
    const now = this.time();
    for (const [runId, lease] of this.leases) {
      if (lease.expiresAtMs <= now) this.leases.delete(runId);
    }
    return this.leases;
  }

  /** Acquire (or refresh) the lease on a run. Returns null while another
   * worker's lease is live. */
  claim(runId: string): Lease | null {
    const now = this.time();
    const existing = this.leases.get(runId);
    if (existing && existing.worker !== this.worker && existing.expiresAtMs > now) {
      return null;
    }
    // cross-instance exclusion: a live WAL claim by another worker refuses
    const liveClaims = this.wal.replay().liveClaims(now);
    const foreign = liveClaims.get(runId);
    if (foreign && foreign.worker !== this.worker && foreign.expiresAtMs > now) {
      return null;
    }
    const fencing = (this.fencingCounter.get(runId) ?? 0) + 1;
    this.fencingCounter.set(runId, fencing);
    const lease: Lease = { runId, worker: this.worker, expiresAtMs: now + this.leaseTtlMs, fencing };
    this.leases.set(runId, lease);
    this.wal.append({
      op: "claim_acquired",
      runId,
      worker: this.worker,
      expiresAt: new Date(lease.expiresAtMs).toISOString(),
      fencing,
      at: nowIso(),
    });
    return lease;
  }

  /** Extend a lease. Only the fencing-holding worker may. */
  heartbeat(runId: string, fencing: number): boolean {
    const lease = this.leases.get(runId);
    if (!lease || lease.fencing !== fencing) return false;
    lease.expiresAtMs = this.time() + this.leaseTtlMs;
    return true;
  }

  /** Release a lease. Only the fencing-holding worker may. */
  release(runId: string, fencing: number): boolean {
    const lease = this.leases.get(runId);
    if (!lease || lease.fencing !== fencing) return false;
    this.leases.delete(runId);
    this.wal.append({ op: "claim_released", runId, fencing, at: nowIso() });
    return true;
  }

  /** One bounded cycle: expire leases -> repair torn runs -> dispatch pending
   * runs -> advance every claimed run one step. */
  async reap(): Promise<ReapReport> {
    const report: ReapReport = { expired: 0, interrupted: 0, requeued: 0, failed: 0, dispatched: 0, advanced: 0, completed: 0 };
    const now = this.time();

    for (const [runId, lease] of this.leases) {
      if (lease.expiresAtMs <= now) {
        this.leases.delete(runId);
        report.expired++;
      }
    }

    const repair = repairTornRuns(this.store, this.wal, { maxAttempts: this.maxAttempts, now });
    report.interrupted += repair.interrupted;
    report.requeued += repair.requeued;
    report.failed += repair.failed;

    // dispatch oldest pending runs first, bounded
    const pending = this.store.listRuns({ status: "pending", limit: this.maxDispatchPerCycle });
    for (const run of pending) {
      const lease = this.claim(run.id);
      if (!lease) continue;
      this.store.setRunStatus(run.id, "running");
      this.wal.append({ op: "run_started", runId: run.id, at: nowIso() });
      report.dispatched++;
    }

    // advance each running run one step, bounded in total
    const running = this.store.listRuns({ status: "running", limit: this.maxStepsPerCycle });
    let steps = 0;
    for (const run of running) {
      if (steps >= this.maxStepsPerCycle) break;
      const outcome = await this.advanceRun(run.id);
      steps++;
      if (outcome.kind === "completed") report.completed++;
      if (outcome.kind === "failed") report.failed++;
      if (outcome.kind === "advanced") report.advanced++;
    }
    return report;
  }

  /** Validate + persist a new run. Returns the pending run row. */
  startRun(graph: WorkflowGraph, context: unknown): RunRow {
    const validation = validateGraph(graph);
    if (!validation.ok) {
      throw new Error(`graph validation failed: ${validation.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    }
    assertNoSecrets(context, "run context");
    const existing = this.graphCache.get(graph.name);
    const serialized = JSON.stringify(graph);
    if (!existing || JSON.stringify(existing) !== serialized) {
      // Persist the graph definition into the WAL so a replacement daemon
      // (crash recovery, `runs resume`, torn-run repair) can re-execute it.
      // Identical re-registrations are deduped to bound WAL growth.
      this.graphCache.set(graph.name, graph);
      this.wal.append({ op: "graph_registered", name: graph.name, version: graph.version, graph, at: nowIso() });
    } else {
      this.graphCache.set(graph.name, existing);
    }
    return this.store.createRun({ graphName: graph.name, graphVersion: graph.version, context: context ?? {} });
  }

  /** Execute ONE step of the graph for a claimed run. */
  async advanceRun(runId: string): Promise<StepOutcome> {
    const run = this.store.getRun(runId);
    if (!run || run.status !== "running") return { kind: "noop" };
    const lease = this.leases.get(runId);
    if (!lease || lease.expiresAtMs <= this.time()) return { kind: "blocked" };

    const graph = this.loadGraph(run.graphName);
    if (!graph) {
      this.failRun(run, `graph ${run.graphName} not found in daemon graph cache`);
      return { kind: "failed", error: "graph not found" };
    }

    const context = JSON.parse(run.contextJson) as Record<string, unknown>;
    const wf = (context.__wf ?? { cursor: undefined, loops: {}, completedLoops: {} }) as {
      cursor?: string;
      loops: Record<string, number>;
      completedLoops: Record<string, number>;
    };

    try {
      const cursor = wf.cursor;
      const node = cursor === undefined ? graph.nodes.find((n) => n.type === "start") : findNode(graph, cursor);
      if (!node) {
        this.failRun(run, `cursor ${cursor ?? "<start>"} resolves to no node`);
        return { kind: "failed", error: "no node at cursor" };
      }

      switch (node.type) {
        case "start": {
          wf.cursor = node.next;
          this.persistContext(run, context, wf);
          return { kind: "advanced", nodeId: node.id };
        }
        case "step": {
          return await this.executeStep(run, graph, context, wf, node);
        }
        case "decision": {
          const value = evaluateExpr(node.condition, this.conditionScope(context));
          const next = value ? node.then : node.else;
          if (!next) {
            this.failRun(run, `decision ${node.id} evaluated ${value} but no ${value ? "then" : "else"} edge`);
            return { kind: "failed", error: "missing decision edge" };
          }
          wf.cursor = next;
          this.persistContext(run, context, wf);
          return { kind: "advanced", nodeId: node.id };
        }
        case "while": {
          return this.executeWhile(run, graph, context, wf, node);
        }
        case "end": {
          this.completeRun(run, context);
          return { kind: "completed" };
        }
      }
    } catch (err) {
      if (err instanceof ExprEvalError || err instanceof ExprSyntaxError) {
        this.failRun(run, `condition error at ${wf.cursor ?? "<start>"}: ${err.message}`);
        return { kind: "failed", error: err.message };
      }
      throw err;
    }
  }

  // -- engine internals ---------------------------------------------------

  private loadGraph(name: string): WorkflowGraph | undefined {
    return this.graphCache.get(name);
  }

  /** The condition scope: user context + steps + loop counter (i). */
  private conditionScope(context: Record<string, unknown>): Record<string, unknown> {
    return { ...context, steps: context.steps ?? {} };
  }

  private persistContext(
    run: RunRow,
    context: Record<string, unknown>,
    wf: { cursor?: string; loops: Record<string, number>; completedLoops: Record<string, number> },
  ): void {
    context.__wf = wf;
    this.store.setRunContext(run.id, context);
  }

  private async executeStep(
    run: RunRow,
    graph: WorkflowGraph,
    context: Record<string, unknown>,
    wf: { cursor?: string; loops: Record<string, number>; completedLoops: Record<string, number> },
    node: Extract<GraphNode, { type: "step" }>,
  ): Promise<StepOutcome> {
    const nodeId = node.id;
    const existing = this.store.listRunNodes(run.id).find((n) => n.nodeId === nodeId);
    const nodeRow = existing ?? this.store.createRunNode({ runId: run.id, nodeId, lane: node.lane ?? "claude" });

    // memoization: same input -> reuse the cached output without executing.
    // the run state (__wf cursor/loops, accumulated steps) is stripped from
    // the memo input so identical user context + command hash identically
    // across iterations and runs
    if (node.memo) {
      const memoInput = { command: node.command, prompt: node.prompt, context: stripRunState(context) };
      const hit = tryMemoHit(this.store, run.graphName, nodeId, memoInput);
      if (hit) {
        const cached = JSON.parse(hit.outputJson) as Record<string, unknown>;
        this.store.setRunNodeStatus(nodeRow.id, "completed", { exitCode: Number(cached.exitCode ?? 0), output: { ...cached, memoHit: true } });
        this.wal.append({ op: "node_finished", runId: run.id, nodeId, status: "completed", at: nowIso() });
        this.recordStepResult(context, nodeId, { ...cached, memoHit: true });
        return this.afterNode(run, context, wf, node.next);
      }
    }

    if (nodeRow.status !== "running") {
      this.store.setRunNodeStatus(nodeRow.id, "running");
      this.wal.append({ op: "node_started", runId: run.id, nodeId, at: nowIso() });
    }

    const job: LaneJob = {
      lane: node.lane ?? "claude",
      prompt: node.prompt,
      command: node.command,
      timeoutMs: node.timeoutMs,
      env: this.env,
    };
    let result: LaneResult;
    try {
      result = await this.laneRunner(job);
    } catch (err) {
      result = { ok: false, exitCode: 1, output: "", durationMs: 0, error: String(err instanceof Error ? err.message : err) };
    }

    const output = { ok: result.ok, exitCode: result.exitCode, output: result.output, durationMs: result.durationMs };
    if (!result.ok) {
      const retriesLeft = (node.maxRetries ?? 0) + 1 - nodeRow.attempts;
      if (retriesLeft > 0) {
        this.store.bumpAttemptsNode(nodeRow.id);
        this.store.setRunNodeStatus(nodeRow.id, "pending", { error: result.error ?? `exit ${result.exitCode}` });
        return { kind: "advanced", nodeId }; // cursor unchanged -> retried next cycle
      }
      const error = result.error ?? `step ${nodeId} failed with exit ${result.exitCode}`;
      this.store.setRunNodeStatus(nodeRow.id, "failed", { exitCode: result.exitCode, error });
      this.wal.append({ op: "node_finished", runId: run.id, nodeId, status: "failed", at: nowIso() });
      this.failRun(run, error);
      return { kind: "failed", error };
    }

    // secrets write-gate: never persist a credential-shaped output
    try {
      assertNoSecrets(output, `node ${nodeId} output`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.store.setRunNodeStatus(nodeRow.id, "failed", { error: message });
      this.wal.append({ op: "node_finished", runId: run.id, nodeId, status: "failed", at: nowIso() });
      this.failRun(run, message);
      return { kind: "failed", error: message };
    }

    this.store.setRunNodeStatus(nodeRow.id, "completed", { exitCode: result.exitCode, output });
    this.wal.append({ op: "node_finished", runId: run.id, nodeId, status: "completed", at: nowIso() });
    if (node.memo) {
      recordMemo(this.store, run.graphName, nodeId, { command: node.command, prompt: node.prompt, context: stripRunState(context) }, output);
      this.wal.append({ op: "memo_set", key: `${run.graphName}:${nodeId}:${createHash("sha256").update(JSON.stringify({ command: node.command, prompt: node.prompt, context: stripRunState(context) })).digest("hex")}`, at: nowIso() });
    }
    this.recordStepResult(context, nodeId, output);
    return this.afterNode(run, context, wf, node.next);
  }

  /** Advance past a finished step node. Inside a while body with no next,
   * the iteration completes and the while node re-enters. */
  private afterNode(
    run: RunRow,
    context: Record<string, unknown>,
    wf: { cursor?: string; loops: Record<string, number>; completedLoops: Record<string, number> },
    next: string | undefined,
  ): StepOutcome {
    if (next) {
      wf.cursor = next;
      this.persistContext(run, context, wf);
      return { kind: "advanced", nodeId: wf.cursor };
    }
    // find the enclosing while whose body contains the previous node
    const cursor = wf.cursor;
    const graph = this.loadGraph(run.graphName)!;
    const whileNode = graph.nodes.find(
      (n): n is Extract<GraphNode, { type: "while" }> => n.type === "while" && n.body.includes(cursor ?? ""),
    );
    if (whileNode) {
      const index = whileNode.body.indexOf(cursor ?? "");
      if (index >= 0 && index < whileNode.body.length - 1) {
        // advance to the next body member; the iteration continues
        wf.cursor = whileNode.body[index + 1];
        this.persistContext(run, context, wf);
        return { kind: "advanced", nodeId: wf.cursor };
      }
      // last body member: the iteration completes and the while re-enters
      wf.loops[whileNode.id] = (wf.loops[whileNode.id] ?? 0) + 1;
      wf.cursor = whileNode.id;
      this.persistContext(run, context, wf);
      return { kind: "advanced", nodeId: whileNode.id };
    }
    // no next and no enclosing while: the graph ran off the end
    this.completeRun(run, context);
    return { kind: "completed" };
  }

  private executeWhile(
    run: RunRow,
    graph: WorkflowGraph,
    context: Record<string, unknown>,
    wf: { cursor?: string; loops: Record<string, number>; completedLoops: Record<string, number> },
    node: Extract<GraphNode, { type: "while" }>,
  ): StepOutcome {
    const iteration = wf.loops[node.id] ?? 0;
    if (iteration >= node.maxIterations) {
      const error = `while node ${node.id} exceeded maxIterations (${node.maxIterations})`;
      this.failRun(run, error);
      return { kind: "failed", error };
    }
    const scope = { ...this.conditionScope(context), i: iteration };
    const keepGoing = evaluateExpr(node.condition, scope);
    if (!keepGoing) {
      wf.completedLoops[node.id] = iteration; // durable count of completed iterations
      delete wf.loops[node.id];
      wf.cursor = node.next;
      this.persistContext(run, context, wf);
      return { kind: "advanced", nodeId: node.id };
    }
    wf.cursor = node.body[0];
    this.persistContext(run, context, wf);
    return { kind: "advanced", nodeId: node.id };
  }

  private recordStepResult(context: Record<string, unknown>, nodeId: string, output: unknown): void {
    const steps = (context.steps ?? {}) as Record<string, unknown>;
    steps[nodeId] = output;
    context.steps = steps;
  }

  private completeRun(run: RunRow, context: Record<string, unknown>): void {
    const result = {
      steps: context.steps ?? {},
      iterations: (context.__wf as { completedLoops: Record<string, number> } | undefined)?.completedLoops ?? {},
    };
    try {
      assertNoSecrets(result, "run result");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.failRun(run, message);
      return;
    }
    // error: null clears the transient torn-run repair note — a completed run
    // must not carry "torn run interrupted after claim loss" as its error.
    this.store.setRunStatus(run.id, "completed", { result, finishedAt: nowIso(), error: null });
    this.wal.append({ op: "run_finished", runId: run.id, status: "completed", at: nowIso() });
    const lease = this.leases.get(run.id);
    if (lease) this.release(run.id, lease.fencing);
  }

  private failRun(run: RunRow, error: string): void {
    this.store.setRunStatus(run.id, "failed", { error, finishedAt: nowIso() });
    this.wal.append({ op: "run_finished", runId: run.id, status: "failed", at: nowIso() });
    const lease = this.leases.get(run.id);
    if (lease) this.release(run.id, lease.fencing);
  }
}

/** The default lane runner: command steps run via the shell; lane-prompt
 * steps dispatch to the lane adapters (slice E) — resolved lazily so the
 * daemon works without the SDKs installed. */
const defaultLaneRunner: LaneRunner = async (job) => {
  if (job.command) return runCommand(job);
  const { runLaneJob } = await import("./lanes/index.js");
  return runLaneJob(job);
};

export interface RunToCompletionOptions {
  laneRunner?: LaneRunner;
  time?: () => number;
  env?: Record<string, string>;
  maxCycles?: number;
}

/** Drive a run to a terminal state with bounded cycles. Returns the final row. */
export async function runGraphToCompletion(
  store: WorkflowsStore,
  wal: SessionWAL,
  graph: WorkflowGraph,
  context: unknown,
  options: RunToCompletionOptions = {},
): Promise<RunRow> {
  const daemon = new WorkflowsDaemon(store, wal, {
    worker: "local",
    laneRunner: options.laneRunner,
    time: options.time,
    env: options.env,
  });
  const run = daemon.startRun(graph, context);
  const maxCycles = options.maxCycles ?? 500;
  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const report = await daemon.reap();
    const current = store.getRun(run.id)!;
    if (current.status !== "running") return current;
    if (report.advanced === 0 && report.dispatched === 0) {
      // no progress: stop rather than spin
      return store.getRun(run.id)!;
    }
  }
  return store.getRun(run.id)!;
}
