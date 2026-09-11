import type { Loop, LoopRun, LoopStatus, RunStatus } from "../types.js";
import type { LoopStore } from "./store/index.js";
import { ApiStore } from "./store/index.js";
import { HostedResponseShapeError } from "./hosted-errors.js";
import { hostedLoop, hostedRun, uniqueHostedRows } from "./hosted-records.js";
import {
  buildHealthScan,
  buildHealthReport,
  classifyRunFailure,
  expectationForLoop,
  RESTART_INTERRUPTED_RUN_PREFIX,
  type BuildHealthScanOptions,
  type HealthSource,
  type LoopExpectationResult,
  type LoopsHealthReport,
  type LoopsHealthScan,
} from "./health.js";
import type { DoctorCheck, DoctorReport } from "./doctor.js";

/**
 * Hosted-mode `loops health` and `loops doctor` (task e3b6f1d4).
 *
 * Before this, both verbs refused outright whenever the client selected
 * the hosted API — the CLI's only two diagnostics were unavailable in the one
 * configuration this fleet runs, and therefore unavailable during a scheduler
 * incident. The refusal's advice (unset the HASNA_LOOPS_* variables) pointed the
 * diagnostic at the LOCAL runtime, which is not where the loops live, so
 * following it produced a confident report about the wrong runtime.
 *
 * The rule this module holds to: never print a summary without saying which
 * runtime produced it and what was not inspected. Every report carries
 * `backend` and a non-empty `unchecked` list.
 */

export interface HostedBackend {
  transport: "api";
  /** Base URL of the hosted control plane. Never carries the API key. */
  apiUrl?: string;
}

export interface UncheckedItem {
  id: string;
  reason: string;
}

export interface HostedHealthResult {
  backend: HostedBackend;
  report: LoopsHealthReport;
  executionTruth: HostedExecutionTruth[];
  unchecked: UncheckedItem[];
}

export interface HostedHealthScanResult {
  backend: HostedBackend;
  scan: LoopsHealthScan;
  unchecked: UncheckedItem[];
}

export interface HostedExecutionTruth {
  loopId: string;
  state: "healthy" | "dead_cadence" | "unproven";
  finishedRuns: number;
  acceptedRuns: number;
  failedRuns: number;
  windowLimit: number;
}

export interface HostedDoctorResult {
  backend: HostedBackend;
  report: DoctorReport;
  unchecked: UncheckedItem[];
}

/** Bounded fetch window for the global run counts the hosted store cannot count server-side. */
const RUN_SCAN_LIMIT = 500;
const DEFAULT_LOOP_LIMIT = 200;
const EXECUTION_TRUTH_RUN_LIMIT = 10;
const MIN_EXECUTION_TRUTH_FINISHED_RUNS = 3;

export function hostedBackend(store: LoopStore): HostedBackend {
  return { transport: "api", apiUrl: store instanceof ApiStore ? store.baseUrl : undefined };
}

/**
 * An in-memory {@link HealthSource} over loops and runs already fetched from the
 * hosted API.
 *
 * `listRuns` for a loop that was never fetched does NOT return an empty array —
 * that would read as "this loop has no runs" and silently skip a check. It
 * records the miss so the caller can fetch it and re-run, and anything still
 * unresolved is reported in `unchecked`.
 */
class HostedSnapshot implements HealthSource {
  readonly misses = new Set<string>();

  constructor(
    private readonly loops: Loop[],
    private readonly runs: Map<string, LoopRun[]>,
  ) {}

  listLoops(opts: { status?: LoopStatus; includeArchived?: boolean; limit?: number } = {}): Loop[] {
    return this.loops
      .filter((loop) => (opts.status ? loop.status === opts.status : true))
      .filter((loop) => (opts.includeArchived ? true : !loop.archivedAt))
      .slice(0, opts.limit ?? DEFAULT_LOOP_LIMIT);
  }

  listRuns(opts: { loopId?: string; status?: RunStatus; limit?: number } = {}): LoopRun[] {
    if (!opts.loopId) return [];
    const known = this.runs.get(opts.loopId);
    if (!known) {
      this.misses.add(opts.loopId);
      return [];
    }
    return known
      .filter((run) => (opts.status ? run.status === opts.status : true))
      .slice(0, opts.limit ?? known.length);
  }
}

async function latestRunsFor(store: LoopStore, loopIds: string[], into: Map<string, LoopRun[]>): Promise<string[]> {
  const failed: string[] = [];
  const concurrency = 8;
  for (let offset = 0; offset < loopIds.length; offset += concurrency) {
    await Promise.all(loopIds.slice(offset, offset + concurrency).map(async (loopId) => {
      try {
        const runs = (await store.listRuns({ loopId, limit: EXECUTION_TRUTH_RUN_LIMIT }))
          .map((run) => hostedRun(run, { loopId }));
        into.set(loopId, uniqueHostedRows(runs, `recent runs for ${loopId}`));
      } catch (error) {
        if (error instanceof HostedResponseShapeError) throw error;
        failed.push(loopId);
      }
    }));
  }
  return failed;
}

function executionTruthFor(loop: Loop, runs: LoopRun[]): HostedExecutionTruth {
  // Only producer-terminal outcomes prove an execution attempt completed.
  // `abandoned` means the scheduler gave up ownership without observing an
  // outcome, so counting it as finished would turn unreclaimed leases and
  // similarly interrupted attempts into false evidence about execution.
  const finished = runs.filter((run) =>
    run.status === "succeeded"
    || run.status === "failed"
    || run.status === "timed_out"
    || run.status === "skipped"
  );
  // Run status is the producer-owned truth. A provider contract may accept a
  // non-zero exit (measured exit 1); when it does, the stored run status is
  // `succeeded`, so re-deriving success from exitCode would manufacture a
  // failure. The policy-backed overlap skip (75) is accepted for the same
  // reason existing health treats it as a warning rather than a failed run.
  const accepted = finished.filter((run) =>
    run.status === "succeeded" || (run.status === "skipped" && run.exitCode === 75)
  );
  const state = finished.length < MIN_EXECUTION_TRUTH_FINISHED_RUNS
    ? "unproven"
    : accepted.length === 0
      ? "dead_cadence"
      : "healthy";
  return {
    loopId: loop.id,
    state,
    finishedRuns: finished.length,
    acceptedRuns: accepted.length,
    failedRuns: finished.length - accepted.length,
    windowLimit: EXECUTION_TRUTH_RUN_LIMIT,
  };
}

function applyExecutionTruth(
  report: LoopsHealthReport,
  executionTruth: HostedExecutionTruth[],
): LoopsHealthReport {
  const truthByLoop = new Map(executionTruth.map((entry) => [entry.loopId, entry]));
  const expectations = report.expectations.map((expectation) => {
    const truth = truthByLoop.get(expectation.loop.id);
    if (!truth || truth.state === "healthy") return expectation;
    if (truth.state === "dead_cadence") {
      return {
        ...expectation,
        ok: false,
        check: {
          id: "latest-run-succeeded" as const,
          status: "fail" as const,
          message:
            `${truth.finishedRuns} terminal run(s) in the bounded history window and zero accepted outcomes; ` +
            "advancing nextRunAt is not execution success",
        },
      };
    }
    return {
      ...expectation,
      ok: false,
      check: {
        id: "latest-run-succeeded" as const,
        status: "warn" as const,
        message:
          `execution health UNPROVEN: ${truth.finishedRuns}/${MIN_EXECUTION_TRUTH_FINISHED_RUNS} required ` +
          "terminal runs are available",
      },
    };
  });
  const unhealthy = expectations.filter((expectation) => !expectation.ok).length;
  const warnings = expectations.filter((expectation) => expectation.check.status === "warn").length;
  return {
    ...report,
    ok: unhealthy === 0,
    summary: {
      ...report.summary,
      healthy: expectations.length - unhealthy,
      unhealthy,
      warnings,
    },
    expectations,
  };
}

export class HostedInventoryChangedError extends Error {
  readonly code = "HOSTED_INVENTORY_CHANGED";
  constructor(scope: string) {
    super(`hosted Loops ${scope} changed while its bounded pages were being read; retry the read`);
    this.name = "HostedInventoryChangedError";
  }
}

async function hostedLoopInventoryPass(
  store: LoopStore,
  statuses: LoopStatus[],
  limit: number,
  includeArchived: boolean | undefined,
): Promise<{ loops: Loop[]; total: number; truncated: boolean }> {
  const counts = await Promise.all(
    statuses.map((status) => store.countLoops(status, { includeArchived })),
  );
  const total = counts.reduce((sum, count) => sum + count, 0);
  const loops: Loop[] = [];
  for (let index = 0; index < statuses.length && loops.length < limit; index += 1) {
    const status = statuses[index]!;
    const expected = Math.min(counts[index]!, limit - loops.length);
    if (expected === 0) continue;
    const page = (await store.listLoops({ status, limit: expected, includeArchived }))
      .map((loop) => hostedLoop(loop));
    if (page.length !== expected || page.some((loop) => loop.status !== status)) {
      throw new HostedResponseShapeError(
        `status=${status} loop page to contain ${expected} matching rows from declared total ${counts[index]}`,
      );
    }
    loops.push(...page);
  }
  uniqueHostedRows(loops, "hosted loop inventory");
  const afterCounts = await Promise.all(
    statuses.map((status) => store.countLoops(status, { includeArchived })),
  );
  if (afterCounts.some((count, index) => count !== counts[index])) {
    throw new HostedInventoryChangedError("loop inventory");
  }
  return { loops, total, truncated: total > loops.length };
}

async function boundedHostedLoopInventory(
  store: LoopStore,
  statuses: LoopStatus[],
  limit: number,
  includeArchived: boolean | undefined,
): Promise<{ loops: Loop[]; total: number; truncated: boolean }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const first = await hostedLoopInventoryPass(store, statuses, limit, includeArchived);
      const second = await hostedLoopInventoryPass(store, statuses, limit, includeArchived);
      const identity = (inventory: { loops: Loop[]; total: number }) => JSON.stringify({
        total: inventory.total,
        loops: inventory.loops.map((loop) => ({
          id: loop.id,
          status: loop.status,
          archivedAt: loop.archivedAt ?? null,
          updatedAt: loop.updatedAt,
        })),
      });
      if (identity(first) === identity(second)) return second;
    } catch (error) {
      if (!(error instanceof HostedInventoryChangedError)) throw error;
    }
  }
  throw new HostedInventoryChangedError("loop inventory");
}

/**
 * Build the health report against the hosted control plane.
 *
 * Two resolution rounds: the classifier only ever reaches one level past the
 * loops it was given (a route-drain loop's child loop), so one follow-up fetch
 * converges. Whatever is still unresolved is named in `unchecked` rather than
 * being folded into a clean summary.
 */
export async function buildHostedHealthReport(
  store: LoopStore,
  opts: { limit?: number; includeInactive?: boolean; includeArchived?: boolean; now?: Date } = {},
): Promise<HostedHealthResult> {
  const limit = opts.limit ?? DEFAULT_LOOP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_LOOP_LIMIT) {
    throw new HostedResponseShapeError(`hosted health limit to be a safe integer from 1 to ${DEFAULT_LOOP_LIMIT}`);
  }
  const statuses: LoopStatus[] = opts.includeInactive
    ? ["active", "paused", "stopped", "expired"]
    : ["active", "paused"];
  const inventory = await boundedHostedLoopInventory(store, statuses, limit, opts.includeArchived);
  const loops = inventory.loops;
  const runs = new Map<string, LoopRun[]>();
  const unreachable = await latestRunsFor(store, loops.map((loop) => loop.id), runs);

  const snapshot = new HostedSnapshot(loops, runs);
  const reportOptions = {
    limit,
    includeInactive: opts.includeInactive,
    includeArchived: opts.includeArchived,
    now: opts.now,
  };
  let report = buildHealthReport(snapshot, reportOptions);
  if (snapshot.misses.size > 0) {
    const pending = [...snapshot.misses];
    snapshot.misses.clear();
    unreachable.push(...(await latestRunsFor(store, pending, runs)));
    report = buildHealthReport(snapshot, reportOptions);
  }
  const executionTruth = loops.map((loop) => executionTruthFor(loop, runs.get(loop.id) ?? []));
  report = applyExecutionTruth(report, executionTruth);

  const unchecked: UncheckedItem[] = [
    ...(inventory.truncated
      ? [{
          id: "loop-inventory-window",
          reason: `the hosted health report returned ${loops.length} of ${inventory.total} matching loops under its ${limit}-row bound.`,
        }]
      : []),
    {
      id: "runner-liveness",
      reason:
        "the hosted /v1 contract exposes runner activity only as POST /v1/runners/{poll,claim}, which would claim work; " +
        "there is no read-only runner heartbeat to query, so this report cannot prove a runner is claiming. " +
        `summary.overdue (${report.summary.overdue}) is the available proxy: it counts active loops whose scheduled slot ` +
        "passed with no run recorded for it. A slot whose run is still in flight is NOT counted, so this proxy cannot " +
        "distinguish a runner that is claiming normally from one that claimed and then died mid-run.",
    },
    {
      id: "local-runtime",
      reason:
        "provider binaries, the data directory, and this machine's daemon are not inspected by 'health'; run 'loops doctor' for those.",
    },
    {
      id: "run-history-depth",
      reason:
        `execution truth uses at most ${EXECUTION_TRUTH_RUN_LIMIT} recent runs per loop and requires ` +
        `${MIN_EXECUTION_TRUTH_FINISHED_RUNS} terminal runs; a full-history failure rate beyond that window is not claimed.`,
    },
  ];
  for (const loopId of new Set([...unreachable, ...snapshot.misses])) {
    unchecked.push({
      id: `runs:${loopId}`,
      reason: "runs for this loop could not be read from the hosted API; any check depending on them was skipped.",
    });
  }

  if (inventory.truncated || unchecked.some((entry) => entry.id.startsWith("runs:"))) {
    report = {
      ...report,
      ok: false,
      summary: { ...report.summary, warnings: report.summary.warnings + 1 },
    };
  }
  return { backend: hostedBackend(store), report, executionTruth, unchecked };
}

/**
 * Build the bounded health scan from a hosted snapshot. The classifier is
 * shared with local SQLite through {@link HealthSource}; only snapshot
 * population differs by transport.
 *
 * Failed per-loop reads remain visible in `unchecked` and degrade the scan,
 * rather than becoming an empty history that looks like a clean fleet.
 */
export async function buildHostedHealthScan(
  store: LoopStore,
  opts: BuildHealthScanOptions = {},
): Promise<HostedHealthScanResult> {
  const limit = opts.limit ?? DEFAULT_LOOP_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_LOOP_LIMIT) {
    throw new HostedResponseShapeError(`hosted health scan limit to be a safe integer from 1 to ${DEFAULT_LOOP_LIMIT}`);
  }
  const statuses = opts.includeStatuses?.length
    ? [...new Set(opts.includeStatuses)]
    : (["active", "paused"] as LoopStatus[]);
  const inventory = await boundedHostedLoopInventory(store, statuses, limit, opts.includeArchived);
  const loops = inventory.loops;
  const total = inventory.total;
  const inventoryTruncated = inventory.truncated;
  const runs = new Map<string, LoopRun[]>();
  const unreachable = await latestRunsFor(store, loops.map((loop) => loop.id), runs);
  const snapshot = new HostedSnapshot(loops, runs);
  let scan = buildHealthScan(snapshot, opts);

  if (snapshot.misses.size > 0) {
    const pending = [...snapshot.misses];
    snapshot.misses.clear();
    unreachable.push(...(await latestRunsFor(store, pending, runs)));
    scan = buildHealthScan(snapshot, opts);
  }

  const unchecked: UncheckedItem[] = inventoryTruncated
    ? [{
        id: "loop-inventory-window",
        reason: `the hosted health scan returned ${loops.length} of ${total} matching loops under its ${limit}-row bound.`,
      }]
    : [];
  for (const loopId of new Set([...unreachable, ...snapshot.misses])) {
    unchecked.push({
      id: `runs:${loopId}`,
      reason: "runs for this loop could not be read from the hosted API; any check depending on them was skipped.",
    });
  }
  if (unchecked.length > 0 && scan.status === "ok") {
    scan = { ...scan, ok: false, status: "degraded" };
  }

  return { backend: hostedBackend(store), scan, unchecked };
}

/** Bounded count of runs in a status, with the cap made visible rather than implied. */
async function boundedRunCount(
  store: LoopStore,
  status: RunStatus,
  filter?: (run: LoopRun) => boolean,
): Promise<{ count: number; capped: boolean } | undefined> {
  try {
    const runs = (await store.listRuns({ status, limit: RUN_SCAN_LIMIT }))
      .map((run) => hostedRun(run));
    if (runs.some((run) => run.status !== status)) {
      throw new HostedResponseShapeError(`status=${status} run pages to contain only matching rows`);
    }
    uniqueHostedRows(runs, `status=${status} runs`);
    const matched = filter ? runs.filter(filter) : runs;
    return { count: matched.length, capped: runs.length >= RUN_SCAN_LIMIT };
  } catch (error) {
    if (error instanceof HostedResponseShapeError) throw error;
    return undefined;
  }
}

/**
 * Doctor against the hosted control plane.
 *
 * Hosted doctor is deliberately control-plane-only. Machine runtime, daemon,
 * provider, profile, and account checks are named in `unchecked` and never
 * spawned with hosted credentials.
 */
export async function buildHostedDoctorReport(store: LoopStore): Promise<HostedDoctorResult> {
  const checks: DoctorCheck[] = [];
  const unchecked: UncheckedItem[] = [
    {
      id: "machine-runtime",
      reason:
        "hosted doctor does not inspect or spawn this machine's provider binaries, daemon, data directory, profiles, or account tooling; " +
        "run doctor under explicit HASNA_LOOPS_LOCAL=1 on the executing machine for those checks.",
    },
    {
      id: "runner-liveness",
      reason:
        "no read-only runner heartbeat exists on the hosted /v1 contract; poll/claim would mutate ownership, so this diagnostic does not call them.",
    },
    {
      id: "control-plane-host",
      reason: "the hosted server's own disk, process, and database host are outside this client-facing contract.",
    },
  ];

  let loops: Loop[] = [];
  try {
    loops = uniqueHostedRows(
      (await store.listLoops({ limit: DEFAULT_LOOP_LIMIT })).map((loop) => hostedLoop(loop)),
      "doctor loop",
    );
    checks.push({
      id: "control-plane",
      scope: "control-plane",
      status: "ok",
      message: `hosted control plane reachable (${loops.length} loop(s) read)`,
      detail: store instanceof ApiStore ? store.baseUrl : undefined,
    });
    if (loops.length >= DEFAULT_LOOP_LIMIT) {
      unchecked.push({
        id: "loop-inventory-window",
        reason: `doctor inspected the first ${DEFAULT_LOOP_LIMIT} hosted loops; completeness beyond that bound is not asserted.`,
      });
    }
  } catch (error) {
    if (error instanceof HostedResponseShapeError) throw error;
    checks.push({
      id: "control-plane",
      scope: "control-plane",
      status: "fail",
      message: "hosted control plane is not reachable",
      detail: error instanceof Error ? error.message : String(error),
    });
    return { backend: hostedBackend(store), report: { ok: false, checks }, unchecked };
  }

  const failed = await boundedRunCount(store, "failed");
  checks.push(
    failed === undefined
      ? { id: "loop-runs", scope: "control-plane", status: "warn", message: "failed run count could not be read from the hosted API" }
      : failed.count === 0
        ? { id: "loop-runs", scope: "control-plane", status: "ok", message: "no failed loop runs in the scanned window" }
        : {
            id: "loop-runs",
            scope: "control-plane",
            status: "warn",
            message: `${failed.capped ? `at least ${failed.count}` : `${failed.count}`} failed loop run(s) recorded`,
            detail: `scanned at most ${RUN_SCAN_LIMIT} failed run(s)${failed.capped ? "; the window was full, so the true total is higher" : ""}`,
          },
  );

  const interrupted = await boundedRunCount(
    store,
    "skipped",
    (run) => Boolean(run.error?.startsWith(RESTART_INTERRUPTED_RUN_PREFIX)),
  );
  if (interrupted && interrupted.count > 0) {
    checks.push({
      id: "loop-runs:restart-interrupted",
      scope: "control-plane",
      status: "warn",
      message: `${interrupted.capped ? `at least ${interrupted.count}` : `${interrupted.count}`} restart-interrupted loop run(s) recorded`,
    });
  } else if (!interrupted) {
    unchecked.push({
      id: "restart-interrupted-runs",
      reason: "skipped-run history could not be read from the hosted API, so restart-interrupted runs were not counted.",
    });
  } else if (interrupted.capped) {
    unchecked.push({
      id: "restart-interrupted-runs",
      reason:
        `the newest ${RUN_SCAN_LIMIT} skipped runs contained no restart-interrupted marker; older skipped history was not inspected.`,
    });
  }

  return {
    backend: hostedBackend(store),
    report: { ok: checks.every((check) => check.status !== "fail"), checks },
    unchecked,
  };
}

export interface HostedLoopDiagnosis {
  backend: HostedBackend;
  loop: Loop;
  expectation: LoopExpectationResult;
  recentRuns: Array<{ run: LoopRun; failure: ReturnType<typeof classifyRunFailure> }>;
  unchecked: UncheckedItem[];
}

/**
 * Per-loop diagnosis against the hosted control plane: the same expectation
 * classifier the local tool uses, fed from `/v1` reads instead of sqlite.
 *
 * The expectation classifier is synchronous over a {@link HealthSource}, so the
 * runs it needs are fetched first and served from an in-memory snapshot — the
 * same shape `buildHostedHealthReport` uses. `runLimit` bounds the classified
 * window and the bound is reported in `unchecked` rather than implied, because
 * "no failures in the last N runs" is not "no failures".
 */
export async function buildHostedLoopDiagnosis(
  store: LoopStore,
  idOrName: string,
  opts: { runLimit?: number; now?: Date } = {},
): Promise<HostedLoopDiagnosis> {
  const runLimit = opts.runLimit ?? 5;
  if (!Number.isSafeInteger(runLimit) || runLimit < 1 || runLimit > 50) {
    throw new HostedResponseShapeError("diagnosis runLimit to be a safe integer from 1 to 50");
  }
  const loop = hostedLoop(await store.requireUniqueLoop(idOrName));
  if (loop.id !== idOrName && loop.name !== idOrName) {
    throw new HostedResponseShapeError(`diagnosed loop identity to match requested id or exact name '${idOrName}'`);
  }
  const runs = uniqueHostedRows(
    (await store.listRuns({ loopId: loop.id, limit: runLimit })).map((run) => hostedRun(run, { loopId: loop.id })),
    `diagnosis runs for ${loop.id}`,
  );
  const runMap = new Map([[loop.id, runs]]);
  const snapshot = new HostedSnapshot([loop], runMap);
  let expectation = expectationForLoop(snapshot, loop, { now: opts.now });
  const unreachable: string[] = [];
  if (snapshot.misses.size > 0) {
    const pending = [...snapshot.misses];
    snapshot.misses.clear();
    unreachable.push(...(await latestRunsFor(store, pending, runMap)));
    expectation = expectationForLoop(snapshot, loop, { now: opts.now });
  }
  const unresolved = [...new Set([...unreachable, ...snapshot.misses])];
  if (unresolved.length > 0 && expectation.ok) {
    expectation = {
      ...expectation,
      ok: false,
      check: {
        id: "latest-run-succeeded",
        status: "warn",
        message: "diagnosis is incomplete because referenced child-loop run evidence could not be read",
      },
    };
  }
  return {
    backend: hostedBackend(store),
    loop,
    expectation,
    recentRuns: runs.map((run) => ({ run, failure: classifyRunFailure(run) })),
    unchecked: [
      {
        id: "run-history-depth",
        reason: `only the ${runs.length} most recent run(s) (limit ${runLimit}) were classified; older failures are not claimed either way.`,
      },
      ...unresolved.map((loopId) => ({
        id: `runs:${loopId}`,
        reason: "referenced child-loop runs could not be read from the hosted API; the diagnosis is incomplete.",
      })),
      {
        id: "local-runtime",
        reason:
          "provider binaries, this machine's data directory and its daemon are not inspected by a hosted diagnose; run local doctor on the executing machine for those.",
      },
    ],
  };
}
