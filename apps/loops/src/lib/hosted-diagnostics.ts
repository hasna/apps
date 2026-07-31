import type { Loop, LoopRun, LoopStatus, RunStatus } from "../types.js";
import { isDaemonRunning } from "../daemon/control.js";
import type { LoopStore } from "./store/index.js";
import { ApiStore } from "./store/index.js";
import {
  buildHealthReport,
  RESTART_INTERRUPTED_RUN_PREFIX,
  type HealthSource,
  type LoopsHealthReport,
} from "./health.js";
import { localRuntimeChecks, type DoctorCheck, type DoctorReport } from "./doctor.js";
import { preflightTarget } from "./executor.js";
import { workflowExecutionOrder } from "./workflow-spec.js";
import { buildDeploymentStatus } from "./mode.js";

/**
 * Hosted-mode `loops health` and `loops doctor` (task e3b6f1d4).
 *
 * Before this, both verbs refused outright whenever the client was flipped to
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
  transport: "cloud-http";
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
  unchecked: UncheckedItem[];
}

export interface HostedDoctorResult {
  backend: HostedBackend;
  report: DoctorReport;
  unchecked: UncheckedItem[];
}

/** Bounded fetch window for the global run counts the hosted store cannot count server-side. */
const RUN_SCAN_LIMIT = 500;
const DEFAULT_LOOP_LIMIT = 200;

export function hostedBackend(store: LoopStore): HostedBackend {
  return { transport: "cloud-http", apiUrl: store instanceof ApiStore ? store.baseUrl : undefined };
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
  for (const loopId of loopIds) {
    try {
      into.set(loopId, await store.listRuns({ loopId, limit: 1 }));
    } catch {
      failed.push(loopId);
    }
  }
  return failed;
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
  const loops = await store.listLoops({ limit, includeArchived: opts.includeArchived });
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

  const unchecked: UncheckedItem[] = [
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
      reason: `only the latest run of each loop was fetched (limit 1 per loop, ${loops.length} loop(s) at limit ${limit}); older failures in the same loop are not classified.`,
    },
  ];
  for (const loopId of new Set([...unreachable, ...snapshot.misses])) {
    unchecked.push({
      id: `runs:${loopId}`,
      reason: "runs for this loop could not be read from the hosted API; any check depending on them was skipped.",
    });
  }

  return { backend: hostedBackend(store), report, unchecked };
}

/** Bounded count of runs in a status, with the cap made visible rather than implied. */
async function boundedRunCount(
  store: LoopStore,
  status: RunStatus,
  filter?: (run: LoopRun) => boolean,
): Promise<{ count: number; capped: boolean } | undefined> {
  try {
    const runs = await store.listRuns({ status, limit: RUN_SCAN_LIMIT });
    const matched = filter ? runs.filter(filter) : runs;
    return { count: matched.length, capped: runs.length >= RUN_SCAN_LIMIT };
  } catch {
    return undefined;
  }
}

/**
 * Doctor against the hosted control plane.
 *
 * Split deliberately in two: the machine-scoped checks answer "can a loop
 * execute here", the control-plane-scoped ones answer "what does the scheduler
 * hold". Neither substitutes for the other, and mixing them unlabelled is how
 * an operator reads a green local toolchain as a green scheduler.
 */
export async function buildHostedDoctorReport(store: LoopStore): Promise<HostedDoctorResult> {
  const checks: DoctorCheck[] = localRuntimeChecks().map((check) => ({ ...check, scope: "machine" as const }));

  // The local daemon is NOT the hosted scheduler. Report it as a machine fact
  // and say so, rather than letting "daemon is not running" read as an incident.
  const daemon = isDaemonRunning();
  checks.push({
    id: "daemon:local",
    scope: "machine",
    status: daemon.stale ? "warn" : "ok",
    message: daemon.running
      ? `local daemon is running pid=${daemon.pid}`
      : daemon.stale
        ? "local daemon pid file is stale"
        : "local daemon is not running",
    detail: "this is this machine's daemon, not the hosted scheduler; hosted run claiming is not observable from the client",
  });

  const deployment = buildDeploymentStatus();
  checks.push({
    id: "scheduler-state",
    scope: "machine",
    status: deployment.controlPlane.configured ? "ok" : "warn",
    message: `scheduler state authority=${deployment.schedulerState.authority} control_plane=${deployment.controlPlane.kind}`,
    detail: deployment.controlPlane.apiUrl ? `api_url=${deployment.controlPlane.apiUrl}` : undefined,
  });

  const unchecked: UncheckedItem[] = [
    {
      id: "runner-liveness",
      reason:
        "no read-only runner heartbeat exists on the hosted /v1 contract (poll/claim are POST and would claim work), " +
        "so this report cannot prove the hosted scheduler is claiming; use 'loops health' and read summary.overdue, " +
        "which counts slots that passed with no run recorded and excludes slots whose run is still in flight.",
    },
    {
      id: "control-plane-host",
      reason: "the hosted server's own data dir, database, disk, and process health are not visible to this client.",
    },
  ];

  let loops: Loop[] = [];
  try {
    loops = await store.listLoops({ limit: DEFAULT_LOOP_LIMIT });
    checks.push({
      id: "control-plane",
      scope: "control-plane",
      status: "ok",
      message: `hosted control plane reachable (${loops.length} loop(s) read)`,
      detail: store instanceof ApiStore ? store.baseUrl : undefined,
    });
  } catch (error) {
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
            detail: `scanned the most recent ${RUN_SCAN_LIMIT} failed run(s)${failed.capped ? "; the window was full, so the true total is higher" : ""}`,
          },
  );

  const interrupted = await boundedRunCount(store, "skipped", (run) => Boolean(run.error?.startsWith(RESTART_INTERRUPTED_RUN_PREFIX)));
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
  }

  // Target preflight asks whether a target can run HERE. For a loop pinned to
  // another machine that question is either wrong or would reach out over the
  // network, so it is declined and named rather than answered misleadingly.
  const remote: string[] = [];
  for (const loop of loops.filter((entry) => entry.status === "active")) {
    if (loop.machine) {
      remote.push(loop.name);
      continue;
    }
    try {
      if (loop.target.type === "workflow") {
        const workflow = await store.requireWorkflow(loop.target.workflowId);
        for (const step of workflowExecutionOrder(workflow)) {
          preflightTarget(
            {
              ...step.target,
              account: step.account ?? step.target.account,
              timeoutMs: step.timeoutMs !== undefined ? step.timeoutMs : step.target.timeoutMs,
            },
            { loopId: loop.id, loopName: loop.name, workflowId: workflow.id, workflowName: workflow.name, workflowStepId: step.id },
          );
        }
      } else {
        preflightTarget(loop.target, { loopId: loop.id, loopName: loop.name });
      }
      checks.push({
        id: `loop:${loop.id}:preflight`,
        scope: "machine",
        status: "ok",
        message: `active loop target is ready on this machine: ${loop.name}`,
      });
    } catch (error) {
      checks.push({
        id: `loop:${loop.id}:preflight`,
        scope: "machine",
        status: "fail",
        message: `active loop target preflight failed on this machine: ${loop.name}`,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (remote.length > 0) {
    unchecked.push({
      id: "preflight:machine-assigned-loops",
      reason: `${remote.length} active loop(s) are pinned to another machine and were not preflighted from here: ${remote.slice(0, 10).join(", ")}${remote.length > 10 ? ", …" : ""}`,
    });
  }

  return {
    backend: hostedBackend(store),
    report: { ok: checks.every((check) => check.status !== "fail"), checks },
    unchecked,
  };
}
