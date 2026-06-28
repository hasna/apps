import type { CreateLoopInput, Goal, GoalRun, Loop, LoopRun, OpenAutomationsRuntimeBinding } from "../types.js";
import { advanceLoop, executeClaimedRun, manualRunScheduledFor, shouldAdvanceManualRun, tick } from "../lib/scheduler.js";
import { Store } from "../lib/store.js";
export { runGoal } from "../lib/goal/runner.js";

export interface LoopsClientOptions {
  store?: Store;
  runnerId?: string;
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

  list(): Loop[] {
    return this.store.listLoops();
  }

  get(idOrName: string): Loop {
    return this.store.requireLoop(idOrName);
  }

  pause(idOrName: string): Loop {
    const loop = this.get(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; unarchive it before pausing: ${idOrName}`);
    return this.store.updateLoop(loop.id, { status: "paused" });
  }

  resume(idOrName: string): Loop {
    const loop = this.get(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; unarchive it before resuming: ${idOrName}`);
    return this.store.updateLoop(loop.id, { status: "active" });
  }

  stop(idOrName: string): Loop {
    const loop = this.get(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; unarchive it before stopping: ${idOrName}`);
    return this.store.updateLoop(loop.id, { status: "stopped", nextRunAt: undefined });
  }

  archive(idOrName: string): Loop {
    return this.store.archiveLoop(idOrName);
  }

  unarchive(idOrName: string): Loop {
    return this.store.unarchiveLoop(idOrName);
  }

  delete(idOrName: string): boolean {
    return this.store.deleteLoop(idOrName);
  }

  runs(loopId?: string): LoopRun[] {
    return this.store.listRuns({ loopId });
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
    const loop = this.get(idOrName);
    if (loop.archivedAt) throw new Error(`loop is archived; unarchive it before running: ${idOrName}`);
    const now = new Date();
    let scheduledFor = manualRunScheduledFor(loop, now);
    let shouldAdvance = shouldAdvanceManualRun(loop, scheduledFor, now);
    let claim = this.store.claimRun(loop, scheduledFor, this.runnerId, now);
    if (!claim && shouldAdvance) {
      const existing = this.store.getRunBySlot(loop.id, scheduledFor);
      if (existing && existing.status !== "running") {
        scheduledFor = now.toISOString();
        shouldAdvance = false;
        claim = this.store.claimRun(loop, scheduledFor, this.runnerId, now);
      }
    }
    if (!claim) throw new Error(`could not claim manual run for ${idOrName}`);
    const run = await executeClaimedRun({ store: this.store, runnerId: this.runnerId, loop: claim.loop, run: claim.run });
    if (shouldAdvance) {
      advanceLoop(this.store, claim.loop, run, new Date(run.finishedAt ?? new Date()), run.status === "succeeded");
    }
    return run;
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
      handlerCommand: "loops events handle generic",
      pipeExample: "automations --json webhooks event <route> --body-json '<json>' | loops --json events handle generic",
      boundary: "Use only for explicit event-envelope workflow handoff. OpenAutomations still owns deterministic automation materialization and queue state; OpenLoops owns workflow invocation.",
    },
    requiredEnvironment: ["HASNA_AUTOMATIONS_DIR"],
    guarantees: [
      "OpenAutomations owns automation specs, run materialization, queue state, DLQ, replay, idempotency, and approvals.",
      "OpenLoops may execute claimed actions through explicit command or SDK handoff only.",
      "OpenLoops may consume exported event envelopes only through explicit events handle commands.",
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
