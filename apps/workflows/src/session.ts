/**
 * Session-level concerns (slice C): torn-run repair and memoization.
 *
 * repairTornRuns runs at daemon start and via the CLI repair command: a run
 * whose status is running but whose WAL shows no live claim is a torn run
 * (its worker died mid-flight). It is requeued to pending (attempts + 1) up
 * to maxAttempts, then failed. Running nodes of a requeued run return to
 * pending so the run can resume from its last durable checkpoint.
 */
import { createHash } from "node:crypto";
import { SessionWAL } from "./wal.js";
import type { RunRow, WorkflowsStore } from "./store.js";

export interface RepairResult {
  /** runs found running with no live claim */
  interrupted: number;
  /** torn runs requeued to pending */
  requeued: number;
  /** torn runs failed after exhausting attempts */
  failed: number;
}

export const DEFAULT_MAX_ATTEMPTS = 3;

export function repairTornRuns(
  store: WorkflowsStore,
  wal: SessionWAL,
  opts: { maxAttempts?: number; now?: number } = {},
): RepairResult {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const replay = wal.replay();
  const liveClaims = replay.liveClaims(opts.now);
  const report: RepairResult = { interrupted: 0, requeued: 0, failed: 0 };

  const running = store.listRuns({ status: "running", limit: 1000 });
  for (const run of running) {
    if (liveClaims.has(run.id)) continue; // a live worker owns it
    report.interrupted++;
    const nodes = store.listRunNodes(run.id);
    if (run.attempts < maxAttempts) {
      store.bumpAttempts(run.id);
      store.setRunStatus(run.id, "pending", {
        error: `torn run interrupted after claim loss (attempt ${run.attempts + 1}/${maxAttempts})`,
      });
      for (const node of nodes) {
        if (node.status === "running") {
          store.setRunNodeStatus(node.id, "pending", { error: undefined });
        }
      }
      report.requeued++;
    } else {
      store.setRunStatus(run.id, "failed", {
        error: `torn run failed after ${maxAttempts} interrupted attempts`,
      });
      for (const node of nodes) {
        if (node.status === "running") {
          store.setRunNodeStatus(node.id, "failed", { error: "run interrupted beyond retry budget" });
        }
      }
      report.failed++;
    }
  }
  return report;
}

/** Stable hash of a JSON-serializable payload. */
export function inputHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Memo key: graphName:nodeId:<inputHash>. */
export function memoKey(graphName: string, nodeId: string, input: unknown): string {
  return `${graphName}:${nodeId}:${inputHash(input)}`;
}

/** Look up a memo by input; a hit increments hitCount and returns the row. */
export function tryMemoHit(store: WorkflowsStore, graphName: string, nodeId: string, input: unknown) {
  const key = memoKey(graphName, nodeId, input);
  const memo = store.memoGet(key);
  if (!memo) return undefined;
  store.memoHit(key);
  return memo;
}

/** Persist a node output for future runs with the same input. */
export function recordMemo(store: WorkflowsStore, graphName: string, nodeId: string, input: unknown, output: unknown): void {
  const key = memoKey(graphName, nodeId, input);
  store.memoPut(key, graphName, nodeId, inputHash(input), JSON.stringify(output));
}

/** Requeue a cancelled run's in-flight nodes (used by cancel + resume). */
export function resetRunNodes(store: WorkflowsStore, run: RunRow): void {
  for (const node of store.listRunNodes(run.id)) {
    if (node.status === "running") {
      store.setRunNodeStatus(node.id, "pending", { error: undefined });
    }
  }
}
