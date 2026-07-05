import type { CreateLoopInput, Goal, GoalRun, Loop, LoopRun, LoopStatus, OpenAutomationsRuntimeBinding, RunStatus } from "../types.js";
import { daemonStatus } from "../daemon/control.js";
import { runDoctor, type DoctorReport } from "../lib/doctor.js";
import { LoopNotFoundError } from "../lib/errors.js";
import { buildHealthReport, buildHealthScan, type BuildHealthScanOptions, type LoopsHealthReport, type LoopsHealthScan } from "../lib/health.js";
import {
  applyImportMigrationBundle,
  buildImportMigrationPlan,
  buildSelfHostedMigrationPlan,
  exportLoopsMigrationBundle,
  type ApplyLoopsMigrationResult,
  type ExportLoopsMigrationOptions,
  type ImportLoopsMigrationOptions,
  type LoopsMigrationBundle,
  type LoopsMigrationPlan,
  type SelfHostedPlanOptions,
} from "../lib/migration.js";
import { computeNextAfter } from "../lib/recurrence.js";
import { runLoopNow, tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
export { runGoal } from "../lib/goal/runner.js";
export {
  LOOPS_MIGRATION_SCHEMA,
  applyImportMigrationBundle,
  buildImportMigrationPlan,
  buildSelfHostedMigrationPlan,
  exportLoopsMigrationBundle,
  migrationHash,
  registerSelfHostedRunner,
  validateLoopsMigrationBundle,
} from "../lib/migration.js";
export type {
  ApplyLoopsMigrationResult,
  ExportLoopsMigrationOptions,
  ImportLoopsMigrationOptions,
  LoopsMigrationAction,
  LoopsMigrationBundle,
  LoopsMigrationPlan,
  LoopsMigrationPlanRow,
  LoopsMigrationPlanSummary,
  LoopsMigrationResource,
  RunnerRegistrationOptions,
  RunnerRegistrationResult,
  SelfHostedPlanOptions,
} from "../lib/migration.js";

export interface LoopsClientOptions {
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
  limit?: number;
  /** include archived loops alongside live ones */
  includeArchived?: boolean;
  /** return only archived loops */
  archivedOnly?: boolean;
}

export interface ListRunsFilters {
  status?: RunStatus;
  limit?: number;
}

export class LoopsClient {
  readonly store: Store;
  private readonly ownStore: boolean;
  private readonly runnerId: string;

  constructor(opts: LoopsClientOptions = {}) {
    this.store = opts.store ?? new Store();
    this.ownStore = !opts.store;
    this.runnerId = opts.runnerId ?? `sdk:${process.pid}`;
  }

  create(input: CreateLoopInput): Loop {
    return this.store.createLoop(input);
  }

  list(filters: ListLoopsFilters = {}): Loop[] {
    return this.store.listLoops({
      status: filters.status,
      limit: filters.limit,
      includeArchived: filters.includeArchived,
      archived: filters.archivedOnly,
    });
  }

  get(idOrName: string): Loop {
    return this.store.requireLoop(idOrName);
  }

  // pause/resume/stop rely on the store's archived-loop guard: updateLoop
  // throws a coded LoopArchivedError, so all surfaces share one behavior.
  // These mutation paths use requireUniqueLoop so an ambiguous name errors
  // instead of silently mutating the newest same-named loop.
  pause(idOrName: string): Loop {
    return this.store.updateLoop(this.store.requireUniqueLoop(idOrName).id, { status: "paused" });
  }

  resume(idOrName: string): Loop {
    const loop = this.store.requireUniqueLoop(idOrName);
    // A stopped loop has next_run_at NULL; dueLoops requires it IS NOT NULL, so
    // resuming without recomputing leaves the loop active but permanently
    // dormant. Recompute the next slot from now when it is missing.
    let nextRunAt = loop.nextRunAt;
    if (!nextRunAt) {
      const now = new Date();
      nextRunAt = computeNextAfter(loop.schedule, now, now);
    }
    return this.store.updateLoop(loop.id, { status: "active", nextRunAt });
  }

  stop(idOrName: string): Loop {
    return this.store.updateLoop(this.store.requireUniqueLoop(idOrName).id, { status: "stopped", nextRunAt: undefined });
  }

  archive(idOrName: string): Loop {
    return this.store.archiveLoop(idOrName);
  }

  unarchive(idOrName: string): Loop {
    return this.store.unarchiveLoop(idOrName);
  }

  delete(idOrName: string): boolean {
    return this.store.deleteLoop(this.store.requireUniqueLoop(idOrName).id);
  }

  runs(idOrName?: string, filters: ListRunsFilters = {}): LoopRun[] {
    // Lenient by design (v0.3.x compat): consumers poll runs for loops that
    // another process may have deleted, so an unknown/stale id returns []
    // instead of throwing LoopNotFoundError like get()/pause()/resume() do.
    let loopId: string | undefined;
    if (idOrName) {
      try {
        loopId = this.get(idOrName).id;
      } catch (error) {
        if (error instanceof LoopNotFoundError) return [];
        throw error;
      }
    }
    return this.store.listRuns({ loopId, status: filters.status, limit: filters.limit });
  }

  doctor(): DoctorReport {
    return runDoctor(this.store);
  }

  health(opts: { includeArchived?: boolean; includeInactive?: boolean; limit?: number } = {}): LoopsHealthReport {
    return buildHealthReport(this.store, opts);
  }

  healthScan(opts: Omit<BuildHealthScanOptions, "doctor" | "daemon" | "selfHeals"> & { doctor?: boolean; daemon?: boolean } = {}): LoopsHealthScan {
    return buildHealthScan(this.store, {
      ...opts,
      doctor: opts.doctor ? runDoctor(this.store) : undefined,
      daemon: opts.daemon ? daemonStatus(this.store) : undefined,
    });
  }

  goal(idOrName: string): { goal?: Goal; runs: GoalRun[] } {
    const goal = this.store.getGoal(idOrName) ?? this.store.findGoalByLoop(idOrName) ?? this.store.findGoalByRunId(idOrName);
    return {
      goal,
      runs: goal ? this.store.listGoalRuns({ goalId: goal.goalId }) : [],
    };
  }

  async tick(): Promise<Awaited<ReturnType<typeof tick>>> {
    return tick({ store: this.store, runnerId: this.runnerId });
  }

  async runNow(idOrName: string): Promise<LoopRun> {
    const result = await runLoopNow({ store: this.store, idOrName: this.store.requireUniqueLoop(idOrName).id, runnerId: this.runnerId });
    return result.run;
  }

  exportBundle(opts: ExportLoopsMigrationOptions = {}): LoopsMigrationBundle {
    return exportLoopsMigrationBundle(this.store, opts);
  }

  planImport(bundle: LoopsMigrationBundle, opts: ImportLoopsMigrationOptions = {}): LoopsMigrationPlan {
    return buildImportMigrationPlan(this.store, bundle, opts);
  }

  importBundle(bundle: LoopsMigrationBundle, opts: ImportLoopsMigrationOptions = {}): ApplyLoopsMigrationResult {
    return applyImportMigrationBundle(this.store, bundle, opts);
  }

  planSelfHostedMigration(opts: Omit<SelfHostedPlanOptions, "operation"> & { operation?: SelfHostedPlanOptions["operation"] } = {}): Promise<LoopsMigrationPlan> {
    return buildSelfHostedMigrationPlan(this.store, { ...opts, operation: opts.operation ?? "self-hosted-migrate" });
  }

  close(): void {
    if (this.ownStore) this.store.close();
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
      boundary: "Use only for explicit event-envelope workflow handoff. OpenAutomations still owns deterministic automation materialization and queue state; OpenLoops owns workflow invocation.",
    },
    requiredEnvironment: ["HASNA_AUTOMATIONS_DIR"],
    guarantees: [
      "OpenAutomations owns automation specs, run materialization, queue state, DLQ, replay, idempotency, and approvals.",
      "OpenLoops may execute claimed actions through explicit command or SDK handoff only.",
      "OpenLoops may consume exported event envelopes only through explicit routes create commands.",
      "Workers must complete or fail actions by action id and runner id so OpenAutomations can enforce queue leases.",
    ],
    nonGoals: [
      "OpenLoops must not become the OpenAutomations product surface.",
      "OpenLoops must not store automation specs or replace the OpenAutomations queue.",
      "OpenLoops must not infer automation trigger semantics from event transport alone.",
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
