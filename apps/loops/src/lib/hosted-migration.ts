import type { Loop, LoopRun, WorkflowSpec } from "../types.js";
import { ValidationError } from "./errors.js";
import type { HostedBackend, UncheckedItem } from "./hosted-diagnostics.js";
import { hostedBackend } from "./hosted-diagnostics.js";
import { hostedLoop, hostedRun, hostedWorkflow, uniqueHostedRows } from "./hosted-records.js";
import {
  buildImportMigrationPlan,
  type ImportLoopsMigrationOptions,
  type LoopsMigrationBundle,
  type LoopsMigrationPlan,
  type MigrationDestination,
} from "./migration.js";
import {
  ApiStore,
  type LoopStore,
} from "./store/index.js";
import { HostedResponseShapeError } from "./hosted-errors.js";
import { ImportOperationReconciliationRequiredError, type ImportReceiptV2 } from "./import-contract.js";

/** The hosted planner is intentionally finite: larger migrations use the server-owned migration lane. */
export const HOSTED_IMPORT_MAX_ROWS = 500;
export const HOSTED_IMPORT_ACTIVE_WORKFLOW_MAX = 10_000;
export const HOSTED_IMPORT_RUN_SLOT_MAX = 500;
const HOSTED_PAGE_SIZE = 500;
const HOSTED_IMPORT_REQUEST_MAX_BYTES = 32 * 1024 * 1024 - 1_024;
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
  receipt?: ImportReceiptV2;
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

function assertBundleBounds(bundle: LoopsMigrationBundle, includeRuns: boolean): void {
  const expected = {
    workflows: bundle.data.workflows.length,
    loops: bundle.data.loops.length,
    runs: bundle.data.runs.length,
  };
  for (const key of ["workflows", "loops", "runs"] as const) {
    if (!Number.isSafeInteger(bundle.counts[key]) || bundle.counts[key] !== expected[key]) {
      throw new ValidationError(`migration bundle counts.${key} must equal data.${key}.length`);
    }
  }
  const selectedRows = expected.workflows + expected.loops + (includeRuns ? expected.runs : 0);
  if (selectedRows > HOSTED_IMPORT_MAX_ROWS) {
    throw new ValidationError(
      `hosted import accepts at most ${HOSTED_IMPORT_MAX_ROWS} selected rows per bounded operation; bundle selects ${selectedRows}`,
    );
  }
  const assertUnique = (rows: Array<{ id: string }>, label: string) => {
    const ids = new Set<string>();
    for (const row of rows) {
      if (typeof row.id !== "string" || row.id.trim().length === 0) {
        throw new ValidationError(`${label} rows require non-empty ids`);
      }
      if (ids.has(row.id)) throw new ValidationError(`${label} contains duplicate id ${row.id}`);
      ids.add(row.id);
    }
  };
  assertUnique(bundle.data.workflows, "migration workflows");
  assertUnique(bundle.data.loops, "migration loops");
  if (includeRuns) assertUnique(bundle.data.runs, "migration runs");
  bundle.data.workflows.forEach((workflow) => hostedWorkflow(workflow, workflow.id));
  bundle.data.loops.forEach((loop) => hostedLoop(loop, loop.id));
  if (includeRuns) bundle.data.runs.forEach((run) => hostedRun(run, { id: run.id, loopId: run.loopId }));

  const activeWorkflowNames = new Set<string>();
  for (const workflow of bundle.data.workflows.filter((entry) => entry.status === "active")) {
    if (activeWorkflowNames.has(workflow.name)) {
      throw new ValidationError(`migration workflows contain duplicate active name ${workflow.name}`);
    }
    activeWorkflowNames.add(workflow.name);
  }
  if (includeRuns) {
    const slots = new Set<string>();
    for (const run of bundle.data.runs) {
      const slot = `${run.loopId}\u0000${run.scheduledFor}`;
      if (slots.has(slot)) {
        throw new ValidationError(`migration runs contain duplicate scheduled slot for loop ${run.loopId}`);
      }
      slots.add(slot);
    }
  }
}

class HostedDestination implements MigrationDestination {
  readonly comparison = "representation" as const;
  readonly normalizesWorkflowActivation = true;

  constructor(
    private readonly workflows: Map<string, WorkflowSpec>,
    private readonly loops: Map<string, Loop>,
    private readonly runs: Map<string, LoopRun>,
    private readonly slots: Map<string, LoopRun>,
    private readonly activeWorkflows: WorkflowSpec[],
  ) {}

  listWorkflows(opts: { status?: WorkflowSpec["status"] } = {}): WorkflowSpec[] {
    if (opts.status !== "active") {
      throw new HostedResponseShapeError(`the hosted import snapshot to answer only listWorkflows(status=active), not status=${String(opts.status)}`);
    }
    return this.activeWorkflows;
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
    throw new ValidationError("hosted import requires the authoritative Loops API transport");
  }
  return store;
}

async function activeWorkflowSnapshotPass(store: LoopStore): Promise<WorkflowSpec[]> {
  const before = await store.countWorkflows({ status: "active" });
  if (before > HOSTED_IMPORT_ACTIVE_WORKFLOW_MAX) {
    throw new ValidationError(
      `hosted import refuses to plan against ${before} active workflows; bounded ceiling is ${HOSTED_IMPORT_ACTIVE_WORKFLOW_MAX}`,
    );
  }
  const rows: WorkflowSpec[] = [];
  for (let offset = 0; offset < before; offset += HOSTED_PAGE_SIZE) {
    const expected = Math.min(HOSTED_PAGE_SIZE, before - offset);
    const page = (await store.listWorkflows({ status: "active", limit: expected, offset }))
      .map((workflow) => hostedWorkflow(workflow));
    if (page.length !== expected) {
      throw new HostedResponseShapeError(
        `active workflow page offset ${offset} to contain ${expected} rows from the declared total ${before}`,
      );
    }
    if (page.some((workflow) => workflow.status !== "active")) {
      throw new HostedResponseShapeError("active workflow pages to contain only status=active rows");
    }
    rows.push(...page);
  }
  uniqueHostedRows(rows, "active workflow");
  const after = await store.countWorkflows({ status: "active" });
  if (after !== before) {
    throw new HostedResponseShapeError(`active workflow total to remain stable during import planning (before=${before}, after=${after})`);
  }
  return rows;
}

async function activeWorkflowSnapshot(store: LoopStore): Promise<WorkflowSpec[]> {
  const first = await activeWorkflowSnapshotPass(store);
  const second = await activeWorkflowSnapshotPass(store);
  const identity = (rows: WorkflowSpec[]) => JSON.stringify(
    rows.map((row) => ({ id: row.id, name: row.name, status: row.status, updatedAt: row.updatedAt })),
  );
  if (identity(first) !== identity(second)) {
    throw new ValidationError("hosted active workflow inventory changed during import planning; retry the preview");
  }
  return second;
}

async function prefetch(
  store: LoopStore,
  bundle: LoopsMigrationBundle,
  includeRuns: boolean,
): Promise<{ destination: HostedDestination; unchecked: UncheckedItem[] }> {
  assertBundleBounds(bundle, includeRuns);
  const unchecked: UncheckedItem[] = [{
    id: "destination-table-census",
    reason:
      "the destination census (unsupported/volatile table row counts) is a local SQLite sweep with no /v1 equivalent; " +
      "the hosted plan does not claim that check.",
  }];

  const workflowIds = new Set<string>(bundle.data.workflows.map((workflow) => workflow.id));
  for (const loop of bundle.data.loops) {
    if (loop.target.type === "workflow") workflowIds.add(loop.target.workflowId);
  }
  const loopIds = new Set<string>(bundle.data.loops.map((loop) => loop.id));
  const selectedRuns = includeRuns ? bundle.data.runs : [];
  for (const run of selectedRuns) loopIds.add(run.loopId);

  const activeWorkflows = await activeWorkflowSnapshot(store);

  const workflows = new Map<string, WorkflowSpec>();
  await mapConcurrent([...workflowIds], async (id) => {
    const workflow = await store.getWorkflow(id);
    if (workflow) workflows.set(id, hostedWorkflow(workflow, id));
  });

  const loops = new Map<string, Loop>();
  await mapConcurrent([...loopIds], async (id) => {
    const loop = await store.getLoop(id);
    if (loop) loops.set(id, hostedLoop(loop, id));
  });

  const existingRuns = new Map<string, LoopRun>();
  await mapConcurrent(selectedRuns.map((run) => run.id), async (id) => {
    const run = await store.getRun(id);
    if (run) existingRuns.set(id, hostedRun(run, { id }));
  });

  const slots = new Map<string, LoopRun>();
  const slotLoopIds = [...new Set(selectedRuns.map((run) => run.loopId))];
  await mapConcurrent(slotLoopIds, async (loopId) => {
    const total = await store.countRuns({ loopId });
    const limit = Math.min(total, HOSTED_IMPORT_RUN_SLOT_MAX);
    const loopRuns = (await store.listRuns({ loopId, limit: Math.max(1, limit), offset: 0 }))
      .map((run) => hostedRun(run, { loopId }));
    if (total === 0 && loopRuns.length !== 0) {
      throw new HostedResponseShapeError(`run-slot page for ${loopId} to be empty when count is zero`);
    }
    if (total > 0 && loopRuns.length !== limit) {
      throw new HostedResponseShapeError(`run-slot page for ${loopId} to contain ${limit} rows from declared total ${total}`);
    }
    const afterTotal = await store.countRuns({ loopId });
    if (afterTotal !== total) {
      throw new ValidationError(`hosted run inventory for ${loopId} changed during import planning; retry the preview`);
    }
    uniqueHostedRows(loopRuns, `run-slot page for ${loopId}`);
    for (const run of loopRuns) slots.set(`${run.loopId}\u0000${run.scheduledFor}`, run);
    if (total > HOSTED_IMPORT_RUN_SLOT_MAX) {
      unchecked.push({
        id: `run-slots:${loopId}`,
        reason:
          `scheduled-slot collision checking is incomplete: ${total} hosted runs exist for this loop, above the ` +
          `${HOSTED_IMPORT_RUN_SLOT_MAX}-row safety ceiling. Preview is informational; apply will refuse.`,
      });
    }
  });

  return {
    destination: new HostedDestination(workflows, loops, existingRuns, slots, activeWorkflows),
    unchecked,
  };
}

export async function requireHostedImportV2(store: LoopStore): Promise<void> {
  await requireApiStore(store).requireImportV2();
}

export async function buildHostedImportPlan(
  store: LoopStore,
  bundle: LoopsMigrationBundle,
  opts: ImportLoopsMigrationOptions = {},
): Promise<HostedImportPlanResult> {
  requireApiStore(store);
  const includeRuns = opts.includeRuns ?? true;
  const { destination, unchecked } = await prefetch(store, bundle, includeRuns);
  const plan = buildImportMigrationPlan(destination, bundle, { ...opts, includeRuns });
  return { backend: hostedBackend(store), plan, unchecked };
}

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
  const incompleteSafetyChecks = unchecked.filter((entry) => entry.id.startsWith("run-slots:"));
  if (incompleteSafetyChecks.length > 0) {
    throw new ValidationError(
      `refusing hosted import because ${incompleteSafetyChecks.length} scheduled-slot check(s) exceeded the bounded safety window`,
    );
  }
  if (plan.summary.blocked > 0 || plan.summary.conflict > 0 || !plan.importable) {
    throw new ValidationError(
      `refusing to import unsafe bundle: blocked=${plan.summary.blocked} conflict=${plan.summary.conflict}`,
    );
  }
  const wanted = (resource: "workflow" | "loop" | "run", id: string): boolean => {
    const row = plan.rows.find((entry) => entry.resource === resource && entry.id === id);
    return row?.action === "insert" || row?.action === "update";
  };
  const request = {
    workflows: bundle.data.workflows.filter((workflow) => wanted("workflow", workflow.id)),
    loops: bundle.data.loops.filter((loop) => wanted("loop", loop.id)),
    runs: includeRuns ? bundle.data.runs.filter((run) => wanted("run", run.id)) : [],
    replace: opts.replace ?? false,
  };
  const selectedCount = request.workflows.length + request.loops.length + request.runs.length;
  const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8") + 128;
  if (requestBytes > HOSTED_IMPORT_REQUEST_MAX_BYTES) {
    throw new ValidationError(
      `hosted import request is ${requestBytes} bytes, above the ${HOSTED_IMPORT_REQUEST_MAX_BYTES}-byte dispatch limit`,
    );
  }
  if (selectedCount === 0) {
    return {
      backend,
      plan,
      imported: { workflows: 0, loops: 0, runs: 0 },
      skippedRunning: 0,
      receipt: undefined,
      backfillSafety: { workflowsArchived: true, loopsPausedAndUnscheduled: true },
      unchecked,
    };
  }
  let result: Awaited<ReturnType<ApiStore["importMigration"]>>;
  try {
    result = await api.importMigration(request);
  } catch (error) {
    if (error instanceof ImportOperationReconciliationRequiredError) throw error;
    const status = error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
      ? `HTTP ${(error as { status: number }).status}`
      : error instanceof Error
        ? error.name
        : "unknown transport failure";
    throw new ImportOperationReconciliationRequiredError(
      `POST /v1/import ended with ${status} after dispatch, so partial or committed state is possible`,
    );
  }
  return {
    backend,
    plan,
    imported: result.imported,
    skippedRunning: result.skippedRunning,
    receipt: result.receipt,
    backfillSafety: { workflowsArchived: true, loopsPausedAndUnscheduled: true },
    unchecked,
  };
}
