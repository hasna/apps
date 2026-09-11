import type { Loop, LoopRun, WorkflowSpec } from "../types.js";
import { ValidationError } from "./errors.js";
import type { HostedBackend, UncheckedItem } from "./hosted-diagnostics.js";
import { hostedBackend } from "./hosted-diagnostics.js";
import {
  buildImportMigrationPlan,
  type ImportLoopsMigrationOptions,
  type LoopsMigrationBundle,
  type LoopsMigrationPlan,
  type MigrationDestination,
} from "./migration.js";
import { ApiStore, type LoopStore } from "./store/index.js";

/**
 * `loops import` against the hosted control plane.
 *
 * Before this, `import` opened the on-box sqlite file unconditionally — so on a
 * station flipped to the hosted API it planned against, and wrote into, a local
 * island nothing reads, while `POST /v1/import` (the id-preserving bulk route
 * the server has carried since the control-plane work) went unused.
 *
 * Two halves, kept separate on purpose:
 *  - the PLAN is computed client-side by the same {@link buildImportMigrationPlan}
 *    the local path uses, fed from prefetched `/v1` reads instead of sqlite, so
 *    a hosted preview and a local preview classify a bundle identically;
 *  - the APPLY is one `POST /v1/import`, because row-by-row client writes could
 *    half-apply a bundle and the server route already enforces FK order and the
 *    backfill safety rules.
 *
 * What a hosted plan cannot check is named in `unchecked` rather than silently
 * passed: the destination table census is a sqlite sweep, and the run-slot and
 * active-workflow lookups are bounded windows.
 */

/** Page size for the bounded hosted prefetches. Matches the CLI's list ceiling. */
const HOSTED_LIST_LIMIT = 1000;
/** Runs fetched per referenced loop when checking scheduled-slot collisions. */
const HOSTED_RUN_SLOT_LIMIT = 500;
/** Concurrent hosted reads; enough to be quick, low enough not to hammer the API. */
const FETCH_CONCURRENCY = 8;

export interface HostedImportPlanResult {
  backend: HostedBackend;
  plan: LoopsMigrationPlan;
  unchecked: UncheckedItem[];
}

export interface HostedImportApplyResult {
  backend: HostedBackend;
  plan: LoopsMigrationPlan;
  imported: { workflows: number; loops: number; runs: number };
  skippedRunning: number;
  /** What `POST /v1/import` does to the rows it accepts, stated rather than assumed. */
  backfillSafety: { workflowsArchived: boolean; loopsPausedAndUnscheduled: boolean };
  unchecked: UncheckedItem[];
}

async function mapConcurrent<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let index = 0; index < items.length; index += FETCH_CONCURRENCY) {
    out.push(...(await Promise.all(items.slice(index, index + FETCH_CONCURRENCY).map(fn))));
  }
  return out;
}

/**
 * A {@link MigrationDestination} over rows already fetched from `/v1`.
 *
 * `exportMigrationRows` is deliberately absent (the interface makes it
 * optional): the destination census counts sqlite tables, and answering it with
 * an empty check set would report an unswept destination as clean.
 */
class HostedDestination implements MigrationDestination {
  constructor(
    private readonly workflows: Map<string, WorkflowSpec>,
    private readonly loops: Map<string, Loop>,
    private readonly runs: Map<string, LoopRun>,
    private readonly slots: Map<string, LoopRun>,
    private readonly activeWorkflows: WorkflowSpec[],
  ) {}

  listWorkflows(opts: { status?: WorkflowSpec["status"] } = {}): WorkflowSpec[] {
    // Only the active-name-collision query is prefetched. Answering any other
    // query from this snapshot would return a partial list that reads as
    // complete, so it fails instead.
    if (opts.status !== "active") {
      throw new Error(`hosted import plan only prefetched active workflows; refusing to answer listWorkflows(status=${String(opts.status)})`);
    }
    return this.activeWorkflows.filter((workflow) => workflow.status === "active");
  }
  getWorkflow(id: string): WorkflowSpec | undefined {
    return this.workflows.get(id);
  }
  getLoop(id: string): Loop | undefined {
    return this.loops.get(id);
  }
  getRun(id: string): LoopRun | undefined {
    return this.runs.get(id);
  }
  getRunBySlot(loopId: string, scheduledFor: string): LoopRun | undefined {
    return this.slots.get(`${loopId}\u0000${scheduledFor}`);
  }
}

function requireApiStore(store: LoopStore): ApiStore {
  if (!(store instanceof ApiStore)) {
    throw new ValidationError("hosted import requires the hosted Loops API connection");
  }
  return store;
}

async function prefetch(
  store: LoopStore,
  bundle: LoopsMigrationBundle,
  includeRuns: boolean,
): Promise<{ destination: HostedDestination; unchecked: UncheckedItem[] }> {
  const unchecked: UncheckedItem[] = [
    {
      id: "destination-table-census",
      reason:
        "the destination census (unsupported/volatile table row counts) is a sqlite-local sweep with no /v1 equivalent, " +
        "so destination-side blockers of that kind are not claimed by a hosted plan.",
    },
  ];

  const workflowIds = new Set<string>(bundle.data.workflows.map((workflow) => workflow.id));
  for (const loop of bundle.data.loops) {
    if (loop.target.type === "workflow") workflowIds.add(loop.target.workflowId);
  }
  const loopIds = new Set<string>(bundle.data.loops.map((loop) => loop.id));
  const runs = includeRuns ? bundle.data.runs : [];
  for (const run of runs) loopIds.add(run.loopId);

  const activeWorkflows = await store.listWorkflows({ status: "active", limit: HOSTED_LIST_LIMIT });
  if (activeWorkflows.length >= HOSTED_LIST_LIMIT) {
    unchecked.push({
      id: "active-workflow-name-collisions",
      reason: `active-workflow name collision checking read the first ${HOSTED_LIST_LIMIT} active workflows; a collision beyond that window was not checked.`,
    });
  }

  const workflows = new Map<string, WorkflowSpec>();
  await mapConcurrent([...workflowIds], async (id) => {
    const workflow = await store.getWorkflow(id);
    if (workflow) workflows.set(id, workflow);
  });

  const loops = new Map<string, Loop>();
  await mapConcurrent([...loopIds], async (id) => {
    const loop = await store.getLoop(id);
    if (loop) loops.set(id, loop);
  });

  const existingRuns = new Map<string, LoopRun>();
  await mapConcurrent(runs.map((run) => run.id), async (id) => {
    const run = await store.getRun(id);
    if (run) existingRuns.set(id, run);
  });

  // Scheduled-slot collisions: the hosted contract has no "run by slot" read, so
  // the referenced loops' recent runs are listed and matched client-side, the
  // same way ApiStore resolves names.
  const slots = new Map<string, LoopRun>();
  const slotLoopIds = [...new Set(runs.map((run) => run.loopId))];
  await mapConcurrent(slotLoopIds, async (loopId) => {
    const loopRuns = await store.listRuns({ loopId, limit: HOSTED_RUN_SLOT_LIMIT });
    for (const run of loopRuns) slots.set(`${run.loopId}\u0000${run.scheduledFor}`, run);
    if (loopRuns.length >= HOSTED_RUN_SLOT_LIMIT) {
      unchecked.push({
        id: `run-slots:${loopId}`,
        reason: `scheduled-slot collisions were checked against the ${HOSTED_RUN_SLOT_LIMIT} most recent hosted runs of this loop; an older slot collision was not checked.`,
      });
    }
  });

  return {
    destination: new HostedDestination(workflows, loops, existingRuns, slots, activeWorkflows),
    unchecked,
  };
}

/** Hosted dry-run: the same plan the local path builds, over `/v1` reads. */
export async function buildHostedImportPlan(
  store: LoopStore,
  bundle: LoopsMigrationBundle,
  opts: ImportLoopsMigrationOptions = {},
): Promise<HostedImportPlanResult> {
  const includeRuns = opts.includeRuns ?? true;
  const { destination, unchecked } = await prefetch(store, bundle, includeRuns);
  const plan = buildImportMigrationPlan(destination, bundle, { ...opts, includeRuns });
  return { backend: hostedBackend(store), plan, unchecked };
}

/**
 * Hosted apply: gate on the same plan, then hand the whole bundle to
 * `POST /v1/import` in one request.
 */
export async function applyHostedImport(
  store: LoopStore,
  bundle: LoopsMigrationBundle,
  opts: ImportLoopsMigrationOptions = {},
): Promise<HostedImportApplyResult> {
  const api = requireApiStore(store);
  const includeRuns = opts.includeRuns ?? true;
  const { plan, unchecked, backend } = await buildHostedImportPlan(store, bundle, {
    ...opts,
    includeRuns,
    dryRun: false,
  });
  if (plan.summary.blocked > 0 || plan.summary.conflict > 0 || !plan.importable) {
    throw new ValidationError(
      `refusing to import unsafe bundle: blocked=${plan.summary.blocked} conflict=${plan.summary.conflict}`,
    );
  }
  // Send only what the plan actually decided to write. The local apply skips
  // rows whose hash already matches; posting them anyway would re-upsert live
  // hosted rows and make `imported` count work that was not done.
  const wanted = (resource: "workflow" | "loop" | "run", id: string): boolean => {
    const row = plan.rows.find((entry) => entry.resource === resource && entry.id === id);
    return row?.action === "insert" || row?.action === "update";
  };
  const result = await api.importMigration({
    workflows: bundle.data.workflows.filter((workflow) => wanted("workflow", workflow.id)),
    loops: bundle.data.loops.filter((loop) => wanted("loop", loop.id)),
    runs: includeRuns ? bundle.data.runs.filter((run) => wanted("run", run.id)) : [],
    replace: opts.replace ?? false,
    // No preserve flags: the route's backfill safety (workflows land archived,
    // loops land paused with scheduling pointers cleared) is the contract of
    // `POST /v1/import`, and quietly overriding it would let an import hand a
    // live hosted runner work the operator never resumed. The CLI states the
    // effect in its output instead of hiding it.
  });
  return {
    backend,
    plan,
    imported: result.imported,
    skippedRunning: result.skippedRunning,
    backfillSafety: { workflowsArchived: true, loopsPausedAndUnscheduled: true },
    unchecked,
  };
}
