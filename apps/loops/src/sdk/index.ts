import type {
  CreateLoopInput,
  Goal,
  GoalRun,
  Loop,
  LoopRun,
  LoopStatus,
  OpenAutomationsRuntimeBinding,
  RunReceipt,
  RunStatus,
  WriteRunReceiptInput,
} from "../types.js";
import { daemonStatus } from "../daemon/control.js";
import { runDoctor, type DoctorReport } from "../lib/doctor.js";
import { LoopNotFoundError, ValidationError } from "../lib/errors.js";
import type { LoopMutationAction, LoopMutationEnvelope, PublicLoopMutationResult } from "../lib/operation-contract.js";
import { buildHealthReport, buildHealthScan, type BuildHealthScanOptions, type LoopsHealthReport, type LoopsHealthScan } from "../lib/health.js";
import {
  applyImportMigrationBundle,
  buildControlPlaneMigrationPlan,
  buildImportMigrationPlan,
  exportLoopsMigrationBundle,
  type ApplyLoopsMigrationResult,
  type ControlPlanePlanOptions,
  type ExportLoopsMigrationOptions,
  type ImportLoopsMigrationOptions,
  type LoopsMigrationBundle,
  type LoopsMigrationPlan,
} from "../lib/migration.js";
import { initialNextRun } from "../lib/recurrence.js";
import { runLoopNow, tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
import { LocalStore, getStore, type LoopStore } from "../lib/store/index.js";
import { mergeLoopLabels, normalizeLoopLabels, removeLoopLabels } from "../lib/labels.js";
export { runGoal } from "../lib/goal/runner.js";
export {
  LOOPS_MIGRATION_SCHEMA,
  applyImportMigrationBundle,
  buildControlPlaneMigrationPlan,
  buildImportMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  validateLoopsMigrationBundle,
} from "../lib/migration.js";
export type {
  ApplyLoopsMigrationResult,
  ControlPlanePlanOptions,
  ExportLoopsMigrationOptions,
  ImportLoopsMigrationOptions,
  LoopsMigrationAction,
  LoopsMigrationBundle,
  LoopsMigrationPlan,
  LoopsMigrationPlanRow,
  LoopsMigrationPlanSummary,
  LoopsMigrationResource,
} from "../lib/migration.js";

export interface LoopsClientOptions {
  /**
   * Inject an on-box sqlite {@link Store} (mainly for tests and in-process local
   * runtimes). When provided, both data and local-runtime operations run against
   * it. When omitted, the data store is resolved from the connection env via
   * {@link getStore} — the hosted `/v1` API when HASNA_LOOPS_API_URL and
   * HASNA_LOOPS_API_KEY are set, or the local sqlite store when
   * HASNA_LOOPS_CONNECTION=file is set explicitly. With neither, construction
   * fails closed (no silent local fallback). Every data method routes through
   * the one Store abstraction.
   */
  store?: Store;
  /**
   * Claim owner id for inline runs. Keep the `<surface>:<pid>` shape (see
   * INLINE_RUNNER_ID_PATTERN in lib/scheduler.ts; default `sdk:<pid>`) so a
   * starting daemon can see the owner process is still alive and will not
   * reap the run's process group out from under it.
   */
  runnerId?: string;
}

export interface ListLoopsFilters {
  status?: LoopStatus;
  labels?: string[];
  limit?: number;
  /** include archived loops alongside live ones */
  includeArchived?: boolean;
  /** return only archived loops */
  archivedOnly?: boolean;
}

export interface ListRunsFilters {
  status?: RunStatus;
  labels?: string[];
  limit?: number;
}

export interface ListRunReceiptsFilters {
  loopId?: string;
  repo?: string;
  taskId?: string;
  knowledgeId?: string;
  status?: string;
  limit?: number;
}

export interface LoopMutationOptions {
  operationId: string;
  stepId: string;
  expectedRevision: string;
  approvedPlanDigest: string;
  manifestDigest: string;
  descriptorRef: string;
  descriptorDigest: string;
  dryRun?: boolean;
}

export class LoopsClient {
  /**
   * The resolved data store: an on-box {@link LocalStore} (sqlite) or the hosted
   * {@link ApiStore} (`/v1` + bearer key). EVERY data method routes through here,
   * so nothing silently touches the on-box island while connected to the hosted API.
   */
  readonly store: LoopStore;
  private readonly ownStore: boolean;
  private readonly runnerId: string;

  constructor(opts: LoopsClientOptions = {}) {
    this.store = opts.store ? new LocalStore(opts.store) : getStore();
    this.ownStore = !opts.store;
    this.runnerId = opts.runnerId ?? `sdk:${process.pid}`;
  }

  /**
   * The raw on-box sqlite {@link Store} for local-runtime operations that cannot
   * route over HTTP — the scheduler (tick / inline run-now), migration
   * export/import, and local diagnostics (doctor/health). These act on THIS
   * machine's runtime and database, so they fail loudly instead of silently
   * hitting the on-box island when the client is flipped to the hosted API.
   */
  private localRuntime(operation: string): Store {
    if (this.store.transport !== "file") {
      throw new Error(
        `loops SDK ${operation} operates on this machine's local runtime and is not available while connected to the hosted Loops API. ` +
          `Unset HASNA_LOOPS_API_URL and HASNA_LOOPS_API_KEY to run it here.`,
      );
    }
    return (this.store as LocalStore).raw;
  }

  create(input: CreateLoopInput): Promise<Loop> {
    return this.store.createLoop(input);
  }

  list(filters: ListLoopsFilters = {}): Promise<Loop[]> {
    return this.store.listLoops({
      status: filters.status,
      labels: normalizeLoopLabels(filters.labels),
      limit: filters.limit,
      includeArchived: filters.includeArchived,
      archived: filters.archivedOnly,
    });
  }

  get(idOrName: string): Promise<Loop> {
    return this.store.requireLoop(idOrName);
  }

  // pause/resume/stop rely on the store's archived-loop guard: updateLoop
  // throws a coded LoopArchivedError, so all surfaces share one behavior.
  // These mutation paths use requireUniqueLoop so an ambiguous name errors
  // instead of silently mutating the newest same-named loop.
  private async mutateStatus(
    targetId: string,
    action: LoopMutationAction,
    options?: LoopMutationOptions,
  ): Promise<PublicLoopMutationResult | Loop> {
    if (!options) {
      if (this.store.transport !== "file") {
        throw new ValidationError("hosted loop mutation options are required");
      }
      const loop = await this.store.requireUniqueLoop(targetId);
      if (action === "pause") return this.store.updateLoop(loop.id, { status: "paused" });
      if (action === "stop") return this.store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined });
      let nextRunAt = loop.nextRunAt;
      if (!nextRunAt) {
        // initialNextRun (not computeNextAfter) so schedule.type "once" binds
        // schedule.at instead of undefined: computeNextAfter returns undefined
        // for "once", which stored next_run_at NULL and left the resumed loop
        // active but permanently dormant (dueLoops requires IS NOT NULL).
        // Converges with the CLI and contract mutateLoop resume paths.
        nextRunAt = initialNextRun(loop.schedule, new Date());
      }
      return this.store.updateLoop(loop.id, { status: "active", nextRunAt });
    }
    const envelope: LoopMutationEnvelope = {
      schema: "openloops.loop_mutation.v1",
      targetId,
      action,
      ...options,
    };
    return this.store.mutateLoop(envelope);
  }

  async pause(idOrName: string, options?: LoopMutationOptions): Promise<Loop> {
    const result = await this.mutateStatus(idOrName, "pause", options);
    return "loop" in result ? result.loop : result;
  }

  async resume(idOrName: string, options?: LoopMutationOptions): Promise<Loop> {
    const result = await this.mutateStatus(idOrName, "resume", options);
    return "loop" in result ? result.loop : result;
  }

  async stop(idOrName: string, options?: LoopMutationOptions): Promise<Loop> {
    const result = await this.mutateStatus(idOrName, "stop", options);
    return "loop" in result ? result.loop : result;
  }

  async setLabels(idOrName: string, labels: string[]): Promise<Loop> {
    const loop = await this.store.requireUniqueLoop(idOrName);
    return this.store.updateLoop(loop.id, { labels: normalizeLoopLabels(labels) });
  }

  async addLabels(idOrName: string, labels: string[]): Promise<Loop> {
    const loop = await this.store.requireUniqueLoop(idOrName);
    return this.store.updateLoop(loop.id, { labels: mergeLoopLabels(loop.labels, labels) });
  }

  async removeLabels(idOrName: string, labels: string[]): Promise<Loop> {
    const loop = await this.store.requireUniqueLoop(idOrName);
    return this.store.updateLoop(loop.id, { labels: removeLoopLabels(loop.labels, labels) });
  }

  archive(idOrName: string): Promise<Loop> {
    return this.store.archiveLoop(idOrName);
  }

  unarchive(idOrName: string): Promise<Loop> {
    return this.store.unarchiveLoop(idOrName);
  }

  async delete(idOrName: string): Promise<boolean> {
    const loop = await this.store.requireUniqueLoop(idOrName);
    return this.store.deleteLoop(loop.id);
  }

  async runs(idOrName?: string, filters: ListRunsFilters = {}): Promise<LoopRun[]> {
    // Lenient by design (v0.3.x compat): consumers poll runs for loops that
    // another process may have deleted, so an unknown/stale id returns []
    // instead of throwing LoopNotFoundError like get()/pause()/resume() do.
    let loopId: string | undefined;
    if (idOrName) {
      try {
        loopId = (await this.get(idOrName)).id;
      } catch (error) {
        if (error instanceof LoopNotFoundError) return [];
        throw error;
      }
    }
    return this.store.listRuns({
      loopId,
      status: filters.status,
      labels: normalizeLoopLabels(filters.labels),
      limit: filters.limit,
    });
  }

  writeReceipt(input: WriteRunReceiptInput): Promise<RunReceipt> {
    return this.store.writeRunReceipt(input);
  }

  receipt(runId: string): Promise<RunReceipt | undefined> {
    return this.store.getRunReceipt(runId);
  }

  receipts(filters: ListRunReceiptsFilters = {}): Promise<RunReceipt[]> {
    return this.store.listRunReceipts(filters);
  }

  async goal(idOrName: string): Promise<{ goal?: Goal; runs: GoalRun[] }> {
    const goal =
      (await this.store.getGoal(idOrName)) ??
      (await this.store.findGoalByLoop(idOrName)) ??
      (await this.store.findGoalByRunId(idOrName));
    return {
      goal,
      runs: goal ? await this.store.listGoalRuns({ goalId: goal.goalId }) : [],
    };
  }

  // ── Local-runtime helpers (on-box sqlite + scheduler only) ───────────────────
  // doctor/health/tick/run-now/migration act on this machine's runtime and are
  // meaningless over the hosted API, so they route through localRuntime() which
  // fails loudly when connected to the hosted API rather than touching a local island.

  doctor(): DoctorReport {
    return runDoctor(this.localRuntime("doctor()"));
  }

  health(opts: { includeArchived?: boolean; includeInactive?: boolean; limit?: number } = {}): LoopsHealthReport {
    return buildHealthReport(this.localRuntime("health()"), opts);
  }

  healthScan(opts: Omit<BuildHealthScanOptions, "doctor" | "daemon" | "selfHeals"> & { doctor?: boolean; daemon?: boolean } = {}): LoopsHealthScan {
    const store = this.localRuntime("healthScan()");
    return buildHealthScan(store, {
      ...opts,
      doctor: opts.doctor ? runDoctor(store) : undefined,
      daemon: opts.daemon ? daemonStatus(store) : undefined,
    });
  }

  async tick(): Promise<Awaited<ReturnType<typeof tick>>> {
    return tick({ store: this.localRuntime("tick()"), runnerId: this.runnerId });
  }

  async runNow(idOrName: string): Promise<LoopRun> {
    const store = this.localRuntime("runNow()");
    const result = await runLoopNow({ store, idOrName: store.requireUniqueLoop(idOrName).id, runnerId: this.runnerId });
    return result.run;
  }

  exportBundle(opts: ExportLoopsMigrationOptions = {}): LoopsMigrationBundle {
    return exportLoopsMigrationBundle(this.localRuntime("exportBundle()"), opts);
  }

  planImport(bundle: LoopsMigrationBundle, opts: ImportLoopsMigrationOptions = {}): LoopsMigrationPlan {
    return buildImportMigrationPlan(this.localRuntime("planImport()"), bundle, opts);
  }

  importBundle(bundle: LoopsMigrationBundle, opts: ImportLoopsMigrationOptions = {}): ApplyLoopsMigrationResult {
    return applyImportMigrationBundle(this.localRuntime("importBundle()"), bundle, opts);
  }

  planControlPlaneMigration(opts: Omit<ControlPlanePlanOptions, "operation"> & { operation?: ControlPlanePlanOptions["operation"] } = {}): Promise<LoopsMigrationPlan> {
    return buildControlPlaneMigrationPlan(this.localRuntime("planControlPlaneMigration()"), { ...opts, operation: opts.operation ?? "migrate" });
  }

  async close(): Promise<void> {
    if (this.ownStore) await this.store.close();
  }
}

export function loops(opts: LoopsClientOptions = {}): LoopsClient {
  return new LoopsClient(opts);
}

export function openAutomationsRuntimeBinding(
  overrides: Partial<OpenAutomationsRuntimeBinding> = {},
): OpenAutomationsRuntimeBinding {
  const defaults: OpenAutomationsRuntimeBinding = {
    integration: "open-automations",
    role: "runtime",
    handoff: "claim-queue",
    queueOwner: "open-automations",
    runtimeOwner: "open-loops",
    statusCommand: "automations status",
    claimCommand: "automations queue claim",
    completeCommand: "automations queue complete",
    failCommand: "automations queue fail",
    eventHandoff: {
      envelopeCommand: "automations webhooks event",
      handlerCommand: "loops routes create generic",
      pipeExample: "automations --json webhooks event <route> --body-json '<json>' | loops --json routes create generic",
      boundary: "Use only for explicit event-envelope workflow handoff. OpenAutomations still owns deterministic automation materialization and queue state; Loops owns workflow invocation.",
    },
    requiredEnvironment: ["HASNA_AUTOMATIONS_DIR"],
    guarantees: [
      "OpenAutomations owns automation specs, run materialization, queue state, DLQ, replay, idempotency, and approvals.",
      "Loops may execute claimed actions through explicit command or SDK handoff only.",
      "Loops may consume exported event envelopes only through explicit routes create commands.",
      "Workers must complete or fail actions by action id and runner id so OpenAutomations can enforce queue leases.",
    ],
    nonGoals: [
      "Loops must not become the OpenAutomations product surface.",
      "Loops must not store automation specs or replace the OpenAutomations queue.",
      "Loops must not infer automation trigger semantics from event transport alone.",
    ],
  };
  return {
    ...defaults,
    ...overrides,
    eventHandoff: overrides.eventHandoff ?? defaults.eventHandoff,
    requiredEnvironment: overrides.requiredEnvironment ?? defaults.requiredEnvironment,
    guarantees: overrides.guarantees ?? defaults.guarantees,
    nonGoals: overrides.nonGoals ?? defaults.nonGoals,
  };
}
