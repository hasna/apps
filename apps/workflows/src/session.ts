/**
 * Session-level concerns (slice C): torn-run repair and memoization.
 *
 * repairTornRuns runs at daemon start and via the CLI repair command: a run
 * whose status is running but whose WAL shows no live claim is a torn run
 * (its worker died mid-flight). It is marked interrupted (attempts + 1) up
 * to maxAttempts, then failed. Running nodes of a repaired run return to
 * pending so the run can resume from its last durable checkpoint — either
 * via the daemon (which dispatches interrupted runs) or via top-level
 * `resume`, whose restoreInterruptedRun guard requires status "interrupted".
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { SessionWAL } from "./wal.js";
import type { RunRow, WorkflowsStore } from "./store.js";
import type { WorkflowGraph } from "./graph.js";

export interface RepairResult {
  /** runs found running with no live claim */
  interrupted: number;
  /** torn runs marked interrupted (restorable via resume or the daemon) */
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
      // Mark the run `interrupted`, not `pending`: the status is the truth
      // (a worker died mid-flight), and restoreInterruptedRun's guard requires
      // it, so top-level `resume <run-id>` can restore the run from its
      // durable cursor, reusing memoized node outputs. The daemon dispatches
      // interrupted runs too, so the repair+daemon auto-continue path is
      // unchanged.
      store.setRunStatus(run.id, "interrupted", {
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

/** One watched file's fingerprint entry (mtime + sha256). */
export interface MemoWatchEntry {
  /** The pattern as declared on the graph. */
  pattern: string;
  /** The resolved absolute path (or the glob-relative file path). */
  path: string;
  missing: boolean;
  mtimeMs: number | null;
  size: number | null;
  sha256: string | null;
}

/**
 * Fingerprint of the graph's memoWatch files: mtimes + content hashes.
 * Stress V3/V4 F2 (measured 2026-08-30): a memoized node reading
 * $WORKFLOWS_DATA_DIR/scratch/wf2.cnt served a stale cached "0" while the
 * file said "2" — the memo key covered only {command, prompt, context}. The
 * fingerprint joins the memo input, so a changed watched file invalidates the
 * cache exactly when the command's live result can differ. Exact paths and
 * glob patterns are supported (relative to `dataDir` or absolute); a missing
 * exact path keeps a stable `missing` entry so its later appearance (or a
 * re-creation with different content) still changes the fingerprint.
 */
export function memoWatchFingerprint(graph: WorkflowGraph, dataDir: string): MemoWatchEntry[] | undefined {
  if (!graph.memoWatch || graph.memoWatch.length === 0) return undefined;
  const entries: MemoWatchEntry[] = [];
  for (const pattern of graph.memoWatch) {
    if (hasGlobMagic(pattern)) {
      const matches = [...new Bun.Glob(pattern).scanSync({ cwd: dataDir, onlyFiles: true })].sort();
      for (const match of matches) {
        // Preserve absolute matches as-is: joining them to dataDir would
        // mangle the path (release-review P1, 0.1.4) and fingerprint an
        // existing watched file as missing — its changes would never
        // invalidate memoized results and stale output stayed reachable.
        const path = isAbsolute(match) ? match : join(dataDir, match);
        entries.push(fingerprintFile(pattern, path));
      }
      continue;
    }
    const path = isAbsolute(pattern) ? pattern : join(dataDir, pattern);
    entries.push(fingerprintFile(pattern, path));
  }
  return entries;
}

function hasGlobMagic(pattern: string): boolean {
  return /[*?[\]{}]/.test(pattern);
}

function fingerprintFile(pattern: string, path: string): MemoWatchEntry {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) {
      // non-file paths (directories etc.) stay out of the fingerprint — the
      // command arguably reads them, but mtime/hash of a directory is not a
      // stable signal; treat as missing so nothing stale can be served.
      return { pattern, path, missing: true, mtimeMs: null, size: null, sha256: null };
    }
    const content = readFileSync(path);
    return {
      pattern,
      path,
      missing: false,
      mtimeMs: stat.mtimeMs,
      size: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  } catch {
    return { pattern, path, missing: true, mtimeMs: null, size: null, sha256: null };
  }
}

/** Requeue a cancelled run's in-flight nodes (used by cancel + resume). */
export function resetRunNodes(store: WorkflowsStore, run: RunRow): void {
  for (const node of store.listRunNodes(run.id)) {
    if (node.status === "running") {
      store.setRunNodeStatus(node.id, "pending", { error: undefined });
    }
  }
}

export interface RestoreResult {
  runId: string;
  status: string;
  /** running/pending node rows returned to pending so the run can continue. */
  nodesRestored: number;
  /** completed node rows whose persisted output the restore reuses (memoized). */
  memoizedNodes: number;
  attempts: number;
}

/**
 * Top-level `resume` — restore an INTERRUPTED run from its durable cursor.
 *
 * Distinct from `runs resume` (which requeues cancelled/failed runs): an
 * interrupted run is one whose worker died mid-flight; its durable context
 * (__wf cursor + steps) and completed node outputs are already persisted, so
 * restore reuses them (memoization) and only running/pending nodes return to
 * pending. The daemon then continues from the last durable checkpoint.
 */
export function restoreInterruptedRun(store: WorkflowsStore, runId: string): RestoreResult {
  const run = store.getRun(runId);
  if (!run) throw new Error(`no such run ${runId}`);
  if (run.status !== "interrupted") {
    throw new Error(
      `run ${runId} is ${run.status}; top-level resume restores interrupted runs — use 'runs resume' for cancelled/failed runs`,
    );
  }
  const nodes = store.listRunNodes(runId);
  let nodesRestored = 0;
  let memoizedNodes = 0;
  for (const node of nodes) {
    if (node.status === "completed" && node.outputJson !== null) {
      memoizedNodes++;
    } else if (node.status === "running" || node.status === "pending") {
      store.setRunNodeStatus(node.id, "pending", { error: undefined });
      nodesRestored++;
    }
  }
  store.setRunStatus(runId, "pending", { error: null });
  return { runId, status: "pending", nodesRestored, memoizedNodes, attempts: run.attempts };
}

/**
 * Idempotent run lookup: the run whose context carries the given idempotency
 * key, if any. The three-table law forbids an extra column, so the key lives
 * in the reserved __wf namespace of context_json; the scan is bounded by the
 * store's own listRuns cap (1000 rows).
 */
export function findRunByIdempotencyKey(store: WorkflowsStore, key: string): RunRow | undefined {
  const runs = store.listRuns({ limit: 1000 });
  for (const run of runs) {
    try {
      const context = JSON.parse(run.contextJson) as { __wf?: { idempotencyKey?: unknown } };
      if (context?.__wf?.idempotencyKey === key) return run;
    } catch {
      // an unparseable context row cannot carry the key; skip it
    }
  }
  return undefined;
}
